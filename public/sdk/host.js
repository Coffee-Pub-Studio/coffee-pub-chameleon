/*
 * the host module SDK. A module includes this from its own pages:
 *
 *   <script src="/sdk/host.js"></script>
 *
 * A module runs either in a sandboxed frame, with no access to the host's pages, cookies or network, or
 * (when the admin has chosen that for it, and for the modules that ship with this server) in the page itself,
 * in a container of its own. Either way everything it can do goes through the calls here; the page
 * hosting it (public/module-host.js) makes the real requests on its behalf and the server checks every
 * one. A module in the page is not confined: it could bypass this. See documentation/api/api-module-sdk.md.
 *
 * The API is built by createHost(env): in a frame this file boots it over postMessage; the page host
 * calls it directly for a module running in the page.
 *
 * Every call returns a promise. host.ready() resolves once the host has
 * answered, with who is looking, where the module is showing, and the theme.
 */
(function (global) {
  'use strict';
  const SDK_SCRIPT_SRC = (document.currentScript && document.currentScript.src) || ''; // where this file was loaded from; empty when the app placed it inline

  // The drag data type a pointer to a module's object travels under (see host.objects).
  const OBJECT_MIME = 'application/x-host-object';

  // The phase timeline rule, public/phases.js, as `Phases` (plan-one-bar.md, step 2): the one copy the server runs
  // too, loaded from the server this SDK came from, once per window (a frame's own, or the page that hosts modules in
  // it). host.ready() waits for it; host.util.phaseTimeline says so when it could not be loaded.
  let phaseRuleLoading = null;
  function loadPhaseRule() {
    if (global.Phases) return Promise.resolve();
    if (phaseRuleLoading) return phaseRuleLoading;
    phaseRuleLoading = new Promise((resolve) => {
      try {
        const s = document.createElement('script');
        s.src = new URL('/phases.js', global.location.href).href;
        s.onload = () => resolve();
        s.onerror = () => resolve();
        (document.head || document.documentElement).appendChild(s);
      } catch (err) {
        resolve();
      }
    });
    return phaseRuleLoading;
  }
  const phaseRule = () => {
    if (!global.Phases) throw new Error('the phase rule (phases.js) did not load');
    return global.Phases;
  };

  // A person's colour (plan-module-live.md, decision 4): one of the eight tints, picked from their key (a person's key,
  // or a guest's id) by one fixed rule, so a person has the same colour in every module and on every page. The rule:
  // the 32-bit FNV-1a hash of the key's UTF-16 code units, taken modulo 8, indexes this list. Draw it with
  // var(--tint-<name>). Never change the list's order or the rule: everyone's colour would change with it.
  const PERSON_TINTS = Object.freeze(['blue', 'green', 'teal', 'purple', 'orange', 'pink', 'gold', 'red']);
  function personTint(key) {
    const s = String(key == null ? '' : key);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return PERSON_TINTS[h % PERSON_TINTS.length];
  }
  // Live messages' names (the bridge in public/module-live.js checks them again).
  const LIVE_TOPIC = /^[a-z0-9._-]{1,40}$/;
  const LIVE_PERSON = /^(?:[a-z0-9]{4,16}|guest-[A-Za-z0-9_-]{4,40})$/;
  const LIVE_GAP_MS = 50; // the SDK sends at most 20 a second for a module (MODULE_LIVE_PER_SECOND's default)
  function liveHasProto(value) {
    const stack = [value];
    while (stack.length) {
      const v = stack.pop();
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) { for (const x of v) stack.push(x); continue; }
      for (const k of Object.keys(v)) {
        if (k === '__proto__') return true;
        stack.push(v[k]);
      }
    }
    return false;
  }

  // A pointer checked for shape, or null. Says nothing about whether the viewer may see the object.
  function cleanRef(ref) {
    const ok = ref && typeof ref.module === 'string' && typeof ref.kind === 'string' && typeof ref.id === 'string'
      && /^[a-z][a-z0-9-]{1,31}$/.test(ref.module) && /^[a-z][a-z0-9-]{0,23}$/.test(ref.kind) && /^[A-Za-z0-9_-]{1,64}$/.test(ref.id)
      && (ref.scope === 'environment' || ref.scope === 'person' || (ref.scope === 'space' && typeof ref.space === 'string' && ref.space.length <= 64));
    return ok ? { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.scope === 'space' ? { space: ref.space } : {}) } : null;
  }

  // What a drag carries, as one shape: { ref, summary }. Takes what dropTarget hands a module, or a bare pointer.
  function normalizeDragged(dragged) {
    if (!dragged) return { ref: null, summary: null };
    if (typeof dragged.module === 'string' && typeof dragged.id === 'string') return { ref: cleanRef(dragged), summary: null };
    const ref = dragged.ref ? cleanRef(dragged.ref) : null;
    const summary = !ref && dragged.summary && typeof dragged.summary.title === 'string' ? dragged.summary : null;
    return { ref, summary };
  }

  // The drop fill rules (see plan-drop.md, "The drop context"). For each `name: type` an action takes:
  //   ref:<module>:<kind>  the dropped pointer, when it is that kind
  //   ref                  the dropped pointer; a second one, or one named `target`, the target's own object under the pointer
  //   date / datetime      the day (and time) under the pointer, else the summary's own date
  //   string  title/kind   the summary's title / kind
  //   text    notes/body/content/text   the summary's text, when the drag carried one
  //   number  lat/lng      the spot under the pointer (a map), else the summary's own place
  // Returns the input, or null: a required input could not be filled, or nothing of the dropped object was used.
  const TEXT_FIELDS = ['notes', 'body', 'content', 'text'];
  function fillFor(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    const summary = ctx.summary || d.summary || {};
    const place = ctx.place || summary.place || null;
    const input = {};
    let used = false;
    let refsGiven = 0;
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      const optional = t.endsWith('?');
      const base = optional ? t.slice(0, -1) : t;
      let value;
      if (base.startsWith('ref:')) {
        if (d.ref && base === `ref:${d.ref.module}:${d.ref.kind}`) { value = d.ref; used = true; }
      } else if (base === 'ref') {
        if (d.ref && field !== 'target' && refsGiven === 0) { value = d.ref; used = true; refsGiven += 1; }
        else if (ctx.target) value = ctx.target;
      } else if (base === 'date') {
        if (ctx.date) value = ctx.date;
        else if (summary.date) { value = summary.date; used = true; }
      } else if (base === 'datetime') {
        if (ctx.date) value = ctx.time ? `${ctx.date}T${ctx.time}` : ctx.date;
        else if (summary.date) { value = summary.date; used = true; }
      } else if (base === 'string') {
        if (field === 'title' && summary.title) { value = String(summary.title); used = true; }
        else if (field === 'kind' && summary.kind) { value = String(summary.kind); used = true; }
      } else if (base === 'text') {
        if (TEXT_FIELDS.includes(field) && summary.text) { value = String(summary.text); used = true; }
      } else if (base === 'number') {
        if (place && field === 'lat') { value = place.lat; if (!ctx.place) used = true; }
        else if (place && field === 'lng') { value = place.lng; if (!ctx.place) used = true; }
      }
      if (value === undefined) {
        if (!optional) return null;
        continue;
      }
      input[field] = value;
    }
    return used ? input : null;
  }
  // Whether a filled input used anything from under the pointer (the target object, the day or time, the spot):
  // an action that used only the dropped object is about the object, not about here.
  function usesHere(input, ctx) {
    const t = ctx.target;
    return Object.values(input || {}).some((v) =>
      (t && v && typeof v === 'object' && v.module === t.module && v.kind === t.kind && v.id === t.id)
      || (ctx.date && typeof v === 'string' && (v === ctx.date || v.startsWith(`${ctx.date}T`)))
      || (ctx.place && (v === ctx.place.lat || v === ctx.place.lng)));
  }
  // Why fillFor said no, for the drag trace.
  function whyNot(action, dragged, context) {
    const d = normalizeDragged(dragged);
    const ctx = context || {};
    for (const [field, type] of Object.entries((action && action.input) || {})) {
      const t = String(type);
      if (t.endsWith('?')) continue;
      const one = fillFor({ input: { [field]: t + '?' } }, d, ctx);
      const filledAlone = one && field in one;
      // A required input fillFor could not fill on its own is the reason; a plain `ref` or `title` counts as "used" itself.
      if (!filledAlone && !(t === 'ref' && ctx.target) ) return `needs ${field} (${t})`;
    }
    return 'nothing of the dropped object would be used';
  }

  // Text made safe to put in HTML.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // A small, safe subset of Markdown, to plain HTML: headings (# to ###), **bold**, *italic* or _italic_, `code`,
  // fenced ``` code blocks, unordered (-, *) and ordered (1.) lists, [text](url) links (http, https and mailto only; anything
  // else is left as plain text), paragraphs on a blank line, a single line break within one. Everything is escaped
  // first (via `esc`), so no HTML in the text itself ever reaches the page. This is the one place a module (or the
  // call page, for chat) may set innerHTML from what a person or an AI wrote, because the safety happens in here;
  // everywhere else, text still goes in with textContent. Used for an AI's replies and for chat messages, both text
  // nobody here wrote themselves.
  function markdown(text) {
    // Text direction controls and zero-width characters can disguise words; none is shown.
    text = String(text || '').replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/g, '');
    // Code, links and bare addresses are set aside as placeholders while bold and italic are found, so an underscore or star
    // inside an address or an attribute (target="_blank", .../Belem_Tower) can never pair with another and become emphasis.
    const inline = (s) => {
      const kept = [];
      const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
      const html = esc(String(s).replace(/\u0000/g, ''))
        .replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`))
        .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, (_, t, u) => keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`))
        // A bare address the text didn't wrap in [text](...) itself: linked as it stands.
        .replace(/(^|[\s(])(https?:\/\/[^\s<\u0000]+[^\s<.,;:!?)"'\u0000])/g, (_, lead, u) => lead + keep(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`))
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        // _italic_ only at word edges, so snake_case stays as written.
        .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
        ;
      let out = html;
      for (let i = 0; i < 3 && out.includes('\u0000'); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
      return out;
    };
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null; // { tag: 'ul' | 'ol', items: [] }
    let quote = null; // lines inside a > quote, raw (not yet inlined)
    let code = null; // lines inside a ``` fence, raw (not yet escaped)
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
    const flushQuote = () => { if (quote) { out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); quote = null; } };
    for (const line of lines) {
      if (code) {
        if (/^\s*```\s*$/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else code.push(line);
        continue;
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); flushQuote(); code = []; continue; }
      if (!line.trim()) { flushPara(); flushList(); flushQuote(); continue; }
      const q = /^\s*>\s?(.*)$/.exec(line);
      if (q) { flushPara(); flushList(); if (!quote) quote = []; quote.push(q[1]); continue; }
      flushQuote();
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
      const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      const ul = !ol && /^\s*[-*]\s+(.+)$/.exec(line);
      if (ol || ul) {
        flushPara(); // the lines before a list come before it ("Links:" then its list)
        const tag = ol ? 'ol' : 'ul';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((ol || ul)[1]);
        continue;
      }
      flushList();
      para.push(line);
    }
    flushPara();
    flushList();
    flushQuote();
    if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); // an unclosed fence: show what there was
    return out.join('');
  }

  // Markdown and HTML to plain text, for a field a module shows as plain text (a title, a form field, a description):
  // **bold**, *italic*, ~~struck~~ and `code` unmarked; [text](address) as "text (address)" and a picture as its words;
  // headings and quotes unmarked; a list's lines start "- " (a numbered list keeps its numbers); fences, rules and the
  // ruled line under a header row (|---|) dropped; HTML tags removed (a <br>, a paragraph or a list item still breaks the
  // line; <script> and <style> go with what they hold up to their closing tag, and with none only the tag goes) and its
  // entities read. A backslash keeps a mark as it is (\* stays *). Lines are kept unless `line` is true, which makes it one
  // line. Every pattern is bounded, so a long or crafted text takes linear time.
  const BLOCK_TAGS = /^(?:p|div|h[1-6]|ul|ol|tr|blockquote|pre|section|article|header|footer|hr|dl|dt|dd)$/;
  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', deg: '°', times: '×' };
  function htmlToText(s) {
    if (s.indexOf('<') < 0) return s;
    let out = '';
    let i = 0;
    const unclosed = {}; // a <script> or <style> with no closing tag after it: none further on has one either
    for (;;) {
      const lt = s.indexOf('<', i);
      if (lt < 0) break;
      // Only "<" followed by a letter, "/" or "!" starts a tag; "a < b" is words.
      if (!/[A-Za-z/!]/.test(s.charAt(lt + 1))) { out += s.slice(i, lt + 1); i = lt + 1; continue; }
      const gt = s.indexOf('>', lt + 1);
      if (gt < 0) break; // no ">" left: nothing more is a tag
      out += s.slice(i, lt);
      const inner = s.slice(lt + 1, gt);
      const name = (/^\/?([A-Za-z][A-Za-z0-9]{0,15})/.exec(inner) || [])[1];
      const tag = name ? name.toLowerCase() : '';
      i = gt + 1;
      if (/^(?:https?:\/\/|mailto:)\S+$/i.test(inner)) out += inner; // an <https://...> address is the address
      else if (tag === 'br') out += '\n';
      else if (tag === 'li' && inner.charAt(0) !== '/') out += '\n- ';
      else if (BLOCK_TAGS.test(tag)) out += '\n';
      else if ((tag === 'script' || tag === 'style') && inner.charAt(0) !== '/' && !unclosed[tag]) {
        // What it holds goes with it, up to its closing tag. With none, only the tag itself goes and the words after it stay.
        const closer = new RegExp(`</${tag}`, 'gi');
        closer.lastIndex = i;
        const found = closer.exec(s);
        if (!found) unclosed[tag] = true;
        else {
          const close = s.indexOf('>', found.index);
          i = close < 0 ? s.length : close + 1;
        }
      } else if (tag === 'td' || tag === 'th') out += ' ';
    }
    return out + s.slice(i);
  }
  function entityText(s) {
    return s.replace(/&(#\d{1,7}|#[xX][0-9A-Fa-f]{1,6}|[A-Za-z]{2,8});/g, (whole, e) => {
      if (e.charAt(0) === '#') {
        const n = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : whole;
    });
  }
  // A backslash-kept mark is held as a private character while the marks around it are read, then put back.
  const KEEP_BASE = 0xe000;
  function plainText(text, o) {
    let s = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[\ue000-\ue07f]/g, '');
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!>~|<])/g, (m, c) => String.fromCharCode(KEEP_BASE + c.charCodeAt(0)));
    s = htmlToText(s);
    const lines = [];
    let fenced = false;
    for (let line of s.split('\n')) {
      if (/^ {0,3}(?:```|~~~)/.test(line)) { fenced = !fenced; continue; }
      if (fenced) { lines.push(line); continue; }
      if (!line.trim()) { lines.push(''); continue; }
      // A rule (---, ***, ___) or the ruled line under a header row (|---|:--:|) says nothing in plain text.
      if (/^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line)) continue;
      if (line.indexOf('-') >= 0 && line.indexOf('|') >= 0 && /^[\s|:-]+$/.test(line)) continue;
      line = line.replace(/^[ \t]{0,40}(?:>[ \t]?){1,10}/, '');
      const heading = /^[ \t]{0,3}#{1,6}[ \t]+/.exec(line);
      if (heading) {
        // "## Title ##": the closing marks go too, found from the end rather than by a pattern.
        line = line.slice(heading[0].length).trimEnd();
        let end = line.length;
        while (end > 0 && line.charAt(end - 1) === '#') end -= 1;
        if (end < line.length && (end === 0 || /[ \t]/.test(line.charAt(end - 1)))) line = line.slice(0, end).trimEnd();
      }
      line = line.replace(/^([ \t]{0,40})[-*+][ \t]+/, '$1- ');
      if (/^[ \t]{0,3}\|/.test(line)) line = line.replace(/^[ \t]{0,3}\|[ \t]?/, '').replace(/[ \t]?\|[ \t]*$/, '');
      lines.push(line
        .replace(/!\[([^[\]\n]{0,300})\]\(([^()\s]{0,600})(?:[ \t]{1,10}"[^"\n]{0,200}")?\)/g, '$1')
        .replace(/\[([^[\]\n]{1,300})\]\(([^()\s]{1,600})(?:[ \t]{1,10}"[^"\n]{0,200}")?\)/g, (m, words, address) => (words === address ? address : `${words} (${address})`))
        .replace(/`([^`\n]{1,300})`/g, '$1')
        .replace(/(\*\*|__)(?=\S)([^\n]{1,300}?)\1/g, '$2')
        .replace(/~~(?=\S)([^\n]{1,300}?)~~/g, '$1')
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]{1,300}?)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w_])_(?=\S)([^_\n]{1,300}?)_(?!\w)/g, '$1$2'));
    }
    s = entityText(lines.join('\n')).replace(/[\ue000-\ue07f]/g, (c) => String.fromCharCode(c.charCodeAt(0) - KEEP_BASE));
    s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
    if (o && o.line) return s.replace(/\s+/g, ' ').trim();
    return s.split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // A time of day typed by a person, read as "HH:MM" (24 hours), or '' when it is not one. "1030", "10:30", "10.30", "10:30 pm", "10p",
  // "7", "22:30" all read. With no am or pm, a 24-hour clock takes the hour as given; a 12-hour clock takes 0 and 13 to 23 as given,
  // and 1 to 12 in the half of the day `prev` ("HH:MM", what the field held) was in (noon for 12, the morning for the rest, when it held nothing).
  function parseClockText(text, clock, prev) {
    const t = String(text ?? '').trim();
    const m = /^(\d{1,2})\s*(?:[:.h]\s*(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(t) || /^(\d{1,2})(\d{2})\s*(?:([ap])\.?\s*m?\.?)?$/i.exec(t);
    if (!m) return '';
    let h = Number(m[1]);
    const min = m[2] === undefined ? 0 : Number(m[2]);
    const half = m[3] ? m[3].toLowerCase() : '';
    if (min > 59) return '';
    if (half) {
      if (h < 1 || h > 12) return '';
      h = (h % 12) + (half === 'p' ? 12 : 0);
    } else if (h > 23) {
      return '';
    } else if (clock !== '24' && h >= 1 && h <= 12) {
      const pm = /^\d{2}:/.test(prev || '') ? Number(prev.slice(0, 2)) >= 12 : h === 12;
      h = (h % 12) + (pm ? 12 : 0);
    }
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  // "HH:MM" as the field shows it: "10:30 PM" on a 12-hour clock, "22:30" on a 24-hour one; '' stays ''.
  function clockText(hhmm, clock) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ''));
    if (!m) return '';
    if (clock === '24') return hhmm;
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
  }

  // A local date and time from a `when` (the objects format's: "2026-11-14T12:50", "2026-11-14", or "12:50" when the day is
  // not known; plan-object-handoff.md, "Kinds and their details"), as { date, time }: "YYYY-MM-DD" and "HH:MM", each null when
  // not given. The clock time is kept as written: seconds, and a trailing Z or offset, are dropped, never turned into another
  // zone. A space may stand for the T, and a time may be "3:25 PM". `day` is the day for a time alone (the object's own
  // date). Null when neither a day nor a time can be read; an impossible day or time is no value.
  function localWhen(when, day) {
    const pad = (n) => String(n).padStart(2, '0');
    const realDay = (y, m, d) => {
      const t = new Date(Date.UTC(+y, +m - 1, +d));
      return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d ? `${y}-${m}-${d}` : null;
    };
    const clock = (h, mi, half) => {
      let hour = +h;
      if (+mi > 59) return null;
      if (half) {
        if (hour < 1 || hour > 12) return null;
        hour = (hour % 12) + (/^p/i.test(half) ? 12 : 0);
      } else if (hour > 23) return null;
      return `${pad(hour)}:${mi}`;
    };
    const s = typeof when === 'string' ? when.trim().slice(0, 40) : '';
    const TIME = '(\\d{1,2}):(\\d{2})(?::\\d{2}(?:\\.\\d{1,9})?)?[ \\t]?([ap]\\.?m\\.?)?(?:z|[+-]\\d{2}(?::?\\d{2})?)?';
    let date = null;
    let time = null;
    let m = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[T ]${TIME})?$`, 'i').exec(s);
    if (m) {
      date = realDay(m[1], m[2], m[3]);
      time = date && m[4] !== undefined ? clock(m[4], m[5], m[6]) : null;
      if (!date || (m[4] !== undefined && !time)) { date = null; time = null; }
    } else if ((m = new RegExp(`^${TIME}$`, 'i').exec(s))) {
      time = clock(m[1], m[2], m[3]);
    }
    if (!date && time && typeof day === 'string') {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
      date = d ? realDay(d[1], d[2], d[3]) : null;
    } else if (!date && !time && !s && typeof day === 'string') {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
      date = d ? realDay(d[1], d[2], d[3]) : null;
    }
    return date || time ? { date, time } : null;
  }

  // An object's `details` as "Label: value" lines, for the fields a module has no place of its own for (plan-object-handoff.md,
  // "Nothing is lost": "Cabin: 4B" in the notes). The words are the Planner's (travel-lib-object.js). `kind` words a car's
  // ends as its pick-up and drop-off; `skip` lists the fields the module used. A date and time reads "2026-11-14 12:50", a
  // length "2 h 30 min", a place "Chicago Midway (MDW)", a flag "yes" or "no"; a picture's file id is never shown.
  const DETAIL_WORDS = {
    airline: 'Airline', operator: 'Operator', company: 'Company', number: 'Number', from: 'From', to: 'To', departs: 'Departs',
    arrives: 'Arrives', minutes: 'Length', terminal: 'Terminal', gate: 'Gate', seat: 'Seat', class: 'Class', reference: 'Reference',
    platform: 'Platform', carriage: 'Coach', cabin: 'Cabin', address: 'Address', checkIn: 'Check in', checkOut: 'Check out',
    roomType: 'Room', guests: 'People', starts: 'Starts', ends: 'Ends', partySize: 'Party size', name: 'Booking name',
    tickets: 'Tickets', allDay: 'All day', due: 'Due', options: 'Options', closes: 'Closes', multiple: 'More than one answer',
  };
  // A car's places are where it is picked up and dropped off; its times, as the Planner's car form words them, Pick-up time.
  const CAR_DETAIL_WORDS = { from: 'Pick up', to: 'Drop off', departs: 'Pick-up time', arrives: 'Drop-off time' };
  function detailLines(details, o) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return [];
    const skip = new Set(o && Array.isArray(o.skip) ? o.skip : []);
    const kind = o && typeof o.kind === 'string' ? o.kind : '';
    const own = (name) => Object.prototype.hasOwnProperty.call(DETAIL_WORDS, name);
    const label = (name) => {
      if (kind === 'car' && Object.prototype.hasOwnProperty.call(CAR_DETAIL_WORDS, name)) return CAR_DETAIL_WORDS[name];
      if (own(name)) return DETAIL_WORDS[name];
      const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    };
    const shown = (name, v) => {
      if (typeof v === 'boolean') return v ? 'yes' : 'no';
      if (name === 'minutes' && Number.isInteger(v) && v > 0) {
        const h = Math.floor(v / 60);
        const m = v % 60;
        return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
      }
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
      if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16).replace('T', ' ') : v;
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(', ');
      if (v && typeof v === 'object') {
        const code = typeof v.code === 'string' ? v.code : '';
        const place = typeof v.name === 'string' ? v.name : '';
        return place && code ? `${place} (${code})` : place || code;
      }
      return '';
    };
    const lines = [];
    for (const [name, v] of Object.entries(details).slice(0, 40)) {
      if (name === 'upload' || skip.has(name) || !/^[a-zA-Z]{1,24}$/.test(name)) continue;
      const text = plainText(shown(name, v), { line: true }).slice(0, 300);
      if (text) lines.push(`${label(name)}: ${text}`);
    }
    return lines;
  }

  // A currency list for a <select> (host.ui.currencySelect, and Manage's Currency, which loads this file for it): the common
  // ones, then every other by name in the viewer's language, and the current value first when it is in neither, so a stored
  // code is shown rather than lost. `currencies` is what the server takes (GET /api/currencies, or host.locale().currencies);
  // without it the browser's own list, and at the least the common ones.
  const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'MXN', 'BRL', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ZAR', 'SGD', 'HKD', 'KRW', 'THB', 'TRY', 'AED'];
  let currencyNames = null;
  function currencyName(code) {
    try {
      if (!currencyNames) currencyNames = new Intl.DisplayNames(undefined, { type: 'currency' });
      return currencyNames.of(code) || code;
    } catch (err) {
      return code;
    }
  }
  // fillCurrencySelect(select, { value, currencies, empty }): `empty` is the label of a first "" choice, for a field that may
  // be left to a default. A three-letter value is matched in capitals. Returns the value selected.
  function fillCurrencySelect(select, o) {
    const options = o || {};
    const raw = typeof options.value === 'string' ? options.value.trim() : '';
    const value = /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : raw;
    let list = Array.isArray(options.currencies) && options.currencies.length ? options.currencies : null;
    if (!list && typeof Intl.supportedValuesOf === 'function') {
      try { list = Intl.supportedValuesOf('currency'); } catch (err) { list = null; }
    }
    if (!list || !list.length) list = COMMON_CURRENCIES;
    list = [...new Set(list.filter((c) => typeof c === 'string').map((c) => c.toUpperCase()))];
    const doc = select.ownerDocument || document;
    const option = (code, label) => {
      const el = doc.createElement('option');
      el.value = code;
      const name = label === undefined ? currencyName(code) : label;
      el.textContent = label !== undefined || name === code ? name : `${code} - ${name}`;
      return el;
    };
    const group = (label, codes) => {
      const g = doc.createElement('optgroup');
      g.label = label;
      g.append(...codes.map((c) => option(c)));
      return g;
    };
    const common = COMMON_CURRENCIES.filter((c) => list.includes(c));
    const others = list.filter((c) => !common.includes(c)).sort((a, b) => currencyName(a).localeCompare(currencyName(b)));
    const children = [];
    if (options.empty) children.push(option('', String(options.empty)));
    if (value && !list.includes(value)) children.push(option(value));
    if (common.length) children.push(group('Common', common));
    if (others.length) children.push(group('All currencies', others));
    select.replaceChildren(...children);
    select.value = value;
    return select.value;
  }

  // The view switch (the view-switch rules in public/style.css and public/sdk/host.css), the one implementation the
  // host's pages and the SDK share. fillChoice(button, { id, label, icon?, regular?, iconOnly?, svg? }) draws one choice:
  // its icon (a Font Awesome <i>, or with `svg` an empty .tb-tab-glyph the caller fills with host.ui.icon's SVG, which
  // it returns) and its word. fitSwitches(container) shows the switches in it as icons only while their words do not fit
  // the container (its own width, never the window's); watchSwitches(container) fits now and again whenever the
  // container changes size or the fonts arrive. In icons only, every choice keeps its word as its title and its
  // aria-label; a choice without an icon keeps its word; what is selected, the keyboard and focus do not change.
  const SWITCH_COMPACT = 'tb-tabs-compact';
  const SWITCH_ICON = /^[a-z0-9-]{1,40}$/;
  function fillChoice(button, o) {
    const doc = button.ownerDocument;
    const word = String((o && o.label) || '');
    const icon = o && SWITCH_ICON.test(o.icon || '') ? o.icon : '';
    const iconOnly = Boolean(icon && o.iconOnly);
    const name = word || String((o && o.id) || icon);
    button.textContent = '';
    button.classList.add('tb-tab');
    button.classList.toggle('tb-tab-icon', iconOnly);
    delete button.dataset.tip;
    delete button.dataset.fitTitle;
    let glyph = null;
    if (icon) {
      glyph = doc.createElement(o.svg ? 'span' : 'i');
      glyph.className = o.svg ? 'tb-tab-glyph' : `tb-tab-glyph fa-${o.regular ? 'regular' : 'solid'} fa-${icon} fa-fw`;
      glyph.setAttribute('aria-hidden', 'true');
      button.appendChild(glyph);
    }
    if (word && !iconOnly) {
      const w = doc.createElement('span');
      w.className = 'tb-tab-word';
      w.textContent = word;
      button.appendChild(w);
    }
    button.setAttribute('aria-label', name);
    if (iconOnly) button.dataset.tip = name;
    return glyph;
  }
  // A choice with an icon and a word, in or out of icons only: its word is its accessible name either way, and its
  // tooltip only while the word is hidden (a title the page set itself is left alone). A choice is a tab (.tb-tab) or a
  // part of the module frame's segmented switch (.mf-switch-btn, its word .mf-word: Chat's Discussion | Assistant).
  function labelChoice(button, compact) {
    const wordEl = button.querySelector(':scope > :is(.tb-tab-word, .mf-word)');
    if (!wordEl || !button.querySelector(':scope > :is(.tb-tab-glyph, i)')) return;
    const word = wordEl.textContent.trim();
    button.setAttribute('aria-label', word);
    if (compact && ((!button.dataset.tip && !button.title) || button.dataset.fitTitle)) {
      button.dataset.tip = word;
      button.dataset.fitTitle = '1';
    } else if (!compact && button.dataset.fitTitle) {
      delete button.dataset.tip;
      delete button.dataset.fitTitle;
    }
  }
  function fitSwitches(container) {
    if (!container || !container.isConnected) return;
    const groups = [...container.querySelectorAll('.tb-tabs, .mf-switch')];
    if (!groups.length) return;
    // Measured with every word showing; a container that is not laid out (hidden) keeps the words.
    for (const g of groups) g.classList.remove(SWITCH_COMPACT);
    const width = container.clientWidth;
    const narrow = width > 0 && (container.scrollWidth > width + 1 || groups.some((g) => g.getBoundingClientRect().width > width + 1));
    for (const g of groups) {
      g.classList.toggle(SWITCH_COMPACT, narrow);
      for (const b of g.querySelectorAll('.tb-tab, .mf-switch-btn')) labelChoice(b, narrow);
    }
  }
  const switchWatch = new WeakMap(); // container -> the view it is watched in
  function watchSwitches(container) {
    if (!container) return;
    fitSwitches(container);
    const view = container.ownerDocument && container.ownerDocument.defaultView;
    if (!view || switchWatch.get(container) === view) return;
    switchWatch.set(container, view);
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = view.requestAnimationFrame(() => { frame = 0; fitSwitches(container); });
    };
    if (typeof view.ResizeObserver === 'function') new view.ResizeObserver(later).observe(container);
    else view.addEventListener('resize', later);
    const fonts = view.document.fonts;
    if (fonts && typeof fonts.addEventListener === 'function') {
      fonts.addEventListener('loadingdone', later);
      fonts.ready.then(later, () => {});
    }
  }

  // The segmented switch's keyboard: the standard radio group. A switch is .mf-switch with role="radiogroup" and a name; its
  // parts are .mf-switch-btn buttons with role="radio" and aria-checked (the module frame's view switches, Chat's Discussion |
  // Assistant, the Prototype's switches, the Planner's "How you get there"). One Tab stop: the chosen part, else the first;
  // Tab leaves the group. Left or Up and Right or Down move to the part before or after (round the ends) and choose it; Home
  // and End the first and the last; Space and Enter choose (the button's own click). Choosing is the part's click, so the
  // page's own click handler does it; a part drawn again by that click (the module frame redraws) is found again by its
  // data-key. One listener per window on the document, reading the event's composed path, so a module in a shadow root has
  // it too. Whoever draws a switch may call roveSwitch(group); one never roved is roved when focus first comes into it.
  const SWITCH_PART = '.mf-switch > .mf-switch-btn';
  const switchParts = (g) => (g ? [...g.children].filter((b) => b.classList.contains('mf-switch-btn') && !b.disabled && !b.hidden) : []);
  function roveSwitch(g) {
    const parts = switchParts(g);
    const stop = parts.find((b) => b.getAttribute('aria-checked') === 'true') || parts[0];
    for (const b of g ? [...g.children] : []) if (b.classList.contains('mf-switch-btn')) b.tabIndex = b === stop ? 0 : -1;
  }
  function switchPartOf(e) {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    return path.find((n) => n && n.nodeType === 1 && typeof n.matches === 'function' && n.matches(SWITCH_PART)) || null;
  }
  // The same part after a click that may have drawn the switch again.
  function switchPartAgain(b, root) {
    if (b.isConnected) return b;
    const key = b.dataset && b.dataset.key;
    if (!key || !root || typeof root.querySelector !== 'function') return null;
    return [...root.querySelectorAll('.mf-switch-btn')].find((x) => x.dataset.key === key) || null;
  }
  function switchKeydown(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const b = switchPartOf(e);
    if (!b) return;
    const parts = switchParts(b.parentElement);
    const at = parts.indexOf(b);
    if (at < 0 || !parts.length) return;
    const view = b.ownerDocument && b.ownerDocument.defaultView;
    const rtl = Boolean(view && view.getComputedStyle && view.getComputedStyle(b).direction === 'rtl');
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    let to;
    if (step) to = (at + step + parts.length) % parts.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = parts.length - 1;
    else return;
    e.preventDefault();
    const next = parts[to];
    const root = typeof next.getRootNode === 'function' ? next.getRootNode() : next.ownerDocument;
    next.focus();
    if (next.getAttribute('aria-checked') !== 'true') next.click();
    const now = switchPartAgain(next, root);
    if (!now) return;
    roveSwitch(now.parentElement);
    if (root.activeElement !== now) now.focus();
  }
  function switchClick(e) {
    const b = switchPartOf(e);
    if (!b) return;
    const root = typeof b.getRootNode === 'function' ? b.getRootNode() : b.ownerDocument;
    Promise.resolve().then(() => { const now = switchPartAgain(b, root); if (now) roveSwitch(now.parentElement); });
  }
  // Focus coming into a switch nobody roved (every part a Tab stop): rove it and put focus on the chosen part.
  function switchFocusin(e) {
    const b = switchPartOf(e);
    if (!b) return;
    const g = b.parentElement;
    if ([...g.children].some((x) => x.classList.contains('mf-switch-btn') && x.tabIndex === -1)) return;
    roveSwitch(g);
    const stop = switchParts(g).find((x) => x.tabIndex === 0);
    if (stop && stop !== b) stop.focus();
  }
  const switchDoc = global.document;
  if (switchDoc && typeof switchDoc.addEventListener === 'function' && !global.__hostSwitchKeys) {
    global.__hostSwitchKeys = true;
    switchDoc.addEventListener('keydown', switchKeydown);
    switchDoc.addEventListener('click', switchClick);
    switchDoc.addEventListener('focusin', switchFocusin);
  }

  // The editor window (host.ui.editor): a module's Add or Edit form as a modal <dialog>, drawn in the browser's top layer
  // above every module and the header, sized to the form rather than the module, a full-screen sheet on a phone. Its
  // styles are in /sdk/host.css (.sdk-editor); see documentation/plans/plan-editor-window.md. The two sizes, by name;
  // check-module-window.mjs reads them and the sentence thrown for a wrong element.
  const EDITOR_SIZES = { medium: 560, large: 880 };
  const EDITOR_NEEDS = 'host.ui.editor needs a <dialog> element';
  const EDITOR_FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  let editorSeq = 0;
  // deps: { root, rootElement, icon(name) -> Promise<svg>, opened: Map<dialog, { reopen }>, lift(open, size) } from the
  // module's host. `lift` is there only in a sandboxed frame: a <dialog>'s top layer is the frame's own, so the frame
  // itself is lifted over the canvas (the host's `editor.lift`) while an editor is open, and put back when the last closes.
  function createEditor(dialog, o, deps) {
    if (!dialog || dialog.nodeType !== 1 || String(dialog.tagName).toUpperCase() !== 'DIALOG') throw new Error(EDITOR_NEEDS);
    const options = o || {};
    const size = EDITOR_SIZES[options.size] ? options.size : 'medium';
    const doc = dialog.ownerDocument;
    dialog.classList.add('sdk-editor', `sdk-editor-${size}`);
    dialog.classList.remove(size === 'large' ? 'sdk-editor-medium' : 'sdk-editor-large');
    if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    let returnTo = null; // what to focus on close: an element, or a function giving one
    let before = null; // what had focus before open()
    let lastFocus = null; // the last focused element inside, for reopening after a move
    let reason = ''; // why it is closing: 'done' (close()) or 'cancel'; '' when the browser closed it by itself
    let asking = null; // the "Discard your changes?" row while it shows: { row, focus }
    const active = () => (deps.root && deps.root.activeElement) || doc.activeElement || null;
    const visible = (el) => el === dialog || el.getClientRects().length > 0;
    // In a frame: lift the frame over the canvas once the editor is shown, put it back after the last one closes. The
    // call is not waited for. When the host says it lifted the frame ({ lifted: true, phone }; a window of its own, or a
    // frame the person is not in, says false), the frame is the window, exactly the editor's size, and the dialog fills
    // it (.sdk-editor-lifted, data-lift "window" or "phone" by the page's width, not the frame's).
    let liftedNow = false; // the host said it lifted the frame for this editor
    let sizer = null; // a ResizeObserver on the dialog's content while lifted, so the frame follows the form's height
    let watcher = null; // a MutationObserver while open: the dialog taken out of the page closes the editor's lift
    // The dialog's content height, for the frame to be no taller than the form needs (the dialog scrolls past that).
    const contentHeight = () => Math.ceil([...dialog.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0) + 2);
    const unlifted = () => {
      liftedNow = false;
      dialog.classList.remove('sdk-editor-lifted');
      delete dialog.dataset.lift;
      if (sizer) { sizer.disconnect(); sizer = null; }
    };
    // `retry`: asked again once, a second later, when the host refuses (it refuses for a second after putting a lift back
    // itself, and Keep editing can come inside that second).
    const lift = (open, retry) => {
      if (typeof deps.lift !== 'function') return;
      if (!open && deps.opened && [...deps.opened.keys()].some((d) => d !== dialog && d.open)) return;
      if (!open) unlifted();
      try {
        Promise.resolve(deps.lift(open, size, open ? contentHeight() : undefined)).then((r) => {
          if (!open) return;
          const did = Boolean(r && r.lifted === true) && dialog.open;
          liftedNow = did;
          dialog.classList.toggle('sdk-editor-lifted', did);
          if (did) dialog.dataset.lift = r.phone ? 'phone' : 'window'; else delete dialog.dataset.lift;
          if (did && !sizer && typeof ResizeObserver === 'function') {
            let last = contentHeight();
            sizer = new ResizeObserver(() => {
              if (!liftedNow || !dialog.open) return;
              const h = contentHeight();
              if (Math.abs(h - last) < 4) return;
              last = h;
              Promise.resolve(deps.lift(true, size, h)).catch(() => {});
            });
            for (const c of dialog.children) sizer.observe(c);
          }
          if (!did && sizer) { sizer.disconnect(); sizer = null; }
          if (!did && retry && dialog.open) setTimeout(() => { if (dialog.open && !liftedNow) lift(true); }, 1100);
        }, () => {});
      } catch (err) { /* no host to ask */ }
    };
    // The host put the lift back itself (its Close, Escape on the page, a click on the backdrop): close as Escape does,
    // which asks "Discard your changes?" when something would be lost. Keep editing lifts the frame again.
    const dismiss = () => { unlifted(); if (dialog.open) requestClose(); };
    const watch = () => {
      if (watcher || typeof MutationObserver !== 'function' || !deps.root || !deps.root.nodeType) return;
      watcher = new MutationObserver(() => {
        if (dialog.isConnected) return;
        unwatch();
        deps.opened.delete(dialog);
        lift(false);
      });
      watcher.observe(deps.root, { childList: true, subtree: true });
    };
    const unwatch = () => { if (watcher) { watcher.disconnect(); watcher = null; } };
    // The head: the form's own heading (moved here, once) and the close button, in a sticky strip, so they stay at the top
    // while the form scrolls under them. Made again when missing: a module may replace the dialog's content on each open
    // (the Planner clones a template into it), and the new form brings its heading.
    const corner = () => {
      let c = dialog.querySelector(':scope > .sdk-editor-head');
      const title = dialog.querySelector(':scope > form > :is(h1, h2, h3, h4), :scope > :is(h1, h2, h3, h4)');
      if (c) {
        if (title) { const old = c.querySelector('.sdk-editor-title'); if (old && old !== title) old.remove(); title.classList.add('sdk-editor-title'); c.prepend(title); }
        return;
      }
      c = doc.createElement('div');
      c.className = 'sdk-editor-head';
      if (title) { title.classList.add('sdk-editor-title'); c.appendChild(title); }
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sdk-icon-btn btn-quiet btn-small sdk-editor-close';
      b.setAttribute('aria-label', 'Close');
      b.dataset.tip = 'Close';
      b.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3.05 1.64 8 6.59l4.95-4.95 1.41 1.41L9.41 8l4.95 4.95-1.41 1.41L8 9.41l-4.95 4.95-1.41-1.41L6.59 8 1.64 3.05z"/></svg>';
      deps.icon('xmark').then((svg) => { if (svg) b.innerHTML = svg; }, () => {});
      b.addEventListener('click', () => requestClose());
      c.appendChild(b);
      dialog.prepend(c);
    };
    // A screen reader's name for the dialog: its first heading, unless the module named it.
    const label = () => {
      if (dialog.hasAttribute('aria-label') || dialog.hasAttribute('aria-labelledby')) return;
      const h = dialog.querySelector('h1, h2, h3, h4');
      if (!h) return;
      if (!h.id) h.id = `sdk-editor-title-${++editorSeq}`;
      dialog.setAttribute('aria-labelledby', h.id);
    };
    const focusIn = (el) => {
      const own = (f) => !f.closest('.sdk-editor-head, .sdk-editor-discard');
      const target = el && el.nodeType === 1 && dialog.contains(el) && visible(el) ? el
        : [...dialog.querySelectorAll(EDITOR_FIELD)].find((f) => own(f) && visible(f)) || dialog;
      try { target.focus(); } catch (err) { /* not focusable */ }
    };
    const ask = () => {
      const row = doc.createElement('div');
      row.className = 'sdk-editor-discard';
      row.setAttribute('role', 'alertdialog');
      const text = doc.createElement('span');
      text.className = 'sdk-editor-discard-text';
      text.id = `sdk-editor-discard-${++editorSeq}`;
      text.textContent = 'Discard your changes?';
      row.setAttribute('aria-labelledby', text.id);
      const keep = doc.createElement('button');
      keep.type = 'button';
      keep.className = 'btn btn-quiet';
      keep.dataset.editor = 'keep';
      keep.textContent = 'Keep editing';
      keep.addEventListener('click', () => keepEditing());
      const discard = doc.createElement('button');
      discard.type = 'button';
      discard.className = 'btn btn-danger';
      discard.dataset.editor = 'discard';
      discard.textContent = 'Discard';
      discard.addEventListener('click', () => finish('cancel'));
      row.append(text, keep, discard);
      asking = { row, focus: active() };
      dialog.appendChild(row);
      keep.focus();
    };
    const keepEditing = () => {
      const a = asking;
      asking = null;
      if (!a) return;
      a.row.remove();
      if (a.focus && a.focus.isConnected && dialog.contains(a.focus)) a.focus.focus(); else focusIn();
      if (!liftedNow && dialog.open) lift(true, true);
    };
    const finish = (why) => {
      reason = why;
      if (asking) { asking.row.remove(); asking = null; }
      if (dialog.open) dialog.close();
    };
    // Escape or the close button: the question first when the module says something would be lost.
    const requestClose = () => {
      if (asking) return keepEditing();
      let dirty = false;
      try { dirty = typeof options.isDirty === 'function' && Boolean(options.isDirty()); } catch (err) { console.error(err); }
      if (dirty) ask(); else finish('cancel');
    };
    const restoreFocus = () => {
      let want = null;
      try { want = typeof returnTo === 'function' ? returnTo() : returnTo; } catch (err) { want = null; }
      const usable = (el) => el && el.nodeType === 1 && el.isConnected && typeof el.focus === 'function' && !dialog.contains(el);
      let target = usable(want) ? want : usable(before) && before !== doc.body ? before : deps.rootElement;
      if (!target) return;
      if (target === deps.rootElement && !target.hasAttribute('tabindex')) target.tabIndex = -1;
      try { target.focus(); } catch (err) { /* not focusable */ }
    };
    // Escape is handled here, on the key, rather than left to the dialog's own cancel: a browser fires cancel only while
    // the page has a fresh user activation, and Escape itself gives none, so a second Escape (Keep editing) would close
    // the dialog over the question and lose what was typed. Stopped here so neither the module's nor the page's listeners
    // see it; a list open inside (a menu, the date picker) stopped it already and closed only itself.
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
    });
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      requestClose();
    });
    dialog.addEventListener('focusin', (e) => { lastFocus = e.target; });
    // A hairline shows under the head once the form has scrolled (data-scrolled, read by the Dialogs block).
    const scrolled = () => dialog.toggleAttribute('data-scrolled', dialog.scrollTop > 0);
    dialog.addEventListener('scroll', scrolled, { passive: true });
    dialog.addEventListener('close', () => {
      unwatch();
      deps.opened.delete(dialog);
      lift(false);
      if (!deps.opened.size) doc.documentElement.removeAttribute('data-dialog-open');
      if (asking) { asking.row.remove(); asking = null; }
      const why = reason === 'done' ? 'done' : 'cancel';
      reason = '';
      if (typeof options.onClose === 'function') {
        try { options.onClose(why); } catch (err) { console.error(err); }
      }
      // A microtask later: a module that redraws its list after a save queues that redraw as a microtask too, and
      // `returnTo` must look for the new row (or the opener) in the redrawn list, not the one being replaced.
      Promise.resolve().then(restoreFocus);
    });
    // After the host moved the module's box (docked to floating or back), the dialog is out of the top layer: show it
    // modal again, with the same focus.
    const reopen = () => {
      if (!dialog.hasAttribute('open') || !dialog.isConnected) return;
      const f = lastFocus;
      dialog.removeAttribute('open');
      try { dialog.showModal(); } catch (err) { console.error(err); return; }
      deps.opened.set(dialog, { reopen, dismiss });
      lift(true);
      if (f && f.isConnected && dialog.contains(f)) { try { f.focus(); } catch (err) { focusIn(); } } else focusIn();
    };
    const api = {
      open(a) {
        const arg = a || {};
        if (arg.returnTo !== undefined) returnTo = arg.returnTo;
        corner();
        dialog.removeAttribute('data-scrolled');
        label();
        if (!dialog.open) {
          before = active();
          reason = '';
          dialog.showModal(); // throws for a dialog that is not in the page: then nothing is lifted
          deps.opened.set(dialog, { reopen, dismiss });
          watch();
          lift(true);
          doc.documentElement.setAttribute('data-dialog-open', ''); // the page behind does not scroll (system.css)
        }
        focusIn(arg.focus);
      },
      close() { finish('done'); },
      // The module's own Cancel button: the same way out as Escape and the corner Close, so it asks "Discard your
      // changes?" when isDirty() says so, and closes with 'cancel' otherwise.
      cancel() { requestClose(); },
      get isOpen() { return Boolean(dialog.open); },
      element: dialog,
    };
    return api;
  }

  // ---- The shared outline pieces (plan-templates-redesign.md, "The shared outline pieces") ----------------------------------------
  // host.util.order, host.util.rollup, host.ui.progress, host.ui.peoplePicker and host.ui.outline. They never write data and never
  // call the host for anything but icons and the people of the space; every piece of text a person typed goes in with textContent.
  // The pure parts (order keys, the tree, the moves, the rollup) sit between the markers below so tools/check-outline.mjs can
  // slice them out of this file and run them in Node; the pieces that draw (createOutline and the rest) are tried in Chromium.
  // outline:start
  // An order key: a short string of 0-9, A-Z and a-z that sorts (by character code) between its two neighbours. Nothing is
  // renumbered when two people insert at once: each makes a key between the same two neighbours, the two keys may be equal, and
  // the outline lists equal keys by id, so every screen shows the same order. Keys never end in "0", so there is always room
  // between two of them.
  const ORDER_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const ORDER_KEY = /^[0-9A-Za-z]{1,200}$/;
  const orderDigit = (i) => ORDER_DIGITS[i];
  const orderIndex = (c) => ORDER_DIGITS.indexOf(c);
  // A key strictly between a ('' is the start) and b (null is the end), with a < b and no key ending in "0". After the last key and
  // before the first it steps one character (so a long list of adds at either end stays short); between two it takes the middle.
  function orderMid(a, b) {
    if (b === null) {
      if (!a) return orderDigit(ORDER_DIGITS.length >> 1);
      const i = orderIndex(a[0]);
      return i < ORDER_DIGITS.length - 1 ? orderDigit(i + 1) : a[0] + orderMid(a.slice(1), null);
    }
    let n = 0;
    while ((a[n] || '0') === b[n]) n += 1;
    if (n > 0) return b.slice(0, n) + orderMid(a.slice(n), b.slice(n));
    const da = a ? orderIndex(a[0]) : 0;
    const db = orderIndex(b[0]);
    if (!a && db > 1) return orderDigit(db - 1);
    if (db - da > 1) return orderDigit(Math.round((da + db) / 2));
    if (b !== null && b.length > 1) return b.slice(0, 1);
    return orderDigit(da) + orderMid(a.slice(1), null);
  }
  function outlineOrder(before, after) {
    const a = before === undefined || before === null || before === '' ? '' : before;
    const b = after === undefined || after === null || after === '' ? null : after;
    const bad = (k) => typeof k !== 'string' || !ORDER_KEY.test(k) || k.endsWith('0');
    if (a !== '' && bad(a)) throw new RangeError('host.util.order: the key before is not an order key');
    if (b !== null && bad(b)) throw new RangeError('host.util.order: the key after is not an order key');
    if (b !== null && a >= b) throw new RangeError('host.util.order: the key before must sort before the key after');
    const key = orderMid(a, b);
    if (key.length > 200) throw new RangeError('host.util.order: the key would be longer than 200 characters');
    return key;
  }

  // The entries as a tree: [{ id, parent?, order?, done? ... }] (`id` a non-empty string; a `parent` that is not an entry, is itself
  // or makes a loop reads as no parent; a repeated id keeps the first). Siblings sort by `order` (strings by character code,
  // numbers by value, none last), then by id. Returns { roots, byId, list } of nodes { id, entry, parent, children, level }.
  function outlineCompare(a, b) {
    const x = a.entry.order;
    const y = b.entry.order;
    const kind = (v) => (typeof v === 'number' && Number.isFinite(v) ? 0 : typeof v === 'string' ? 1 : 2);
    const ka = kind(x);
    const kb = kind(y);
    if (ka !== kb) return ka - kb;
    if (ka < 2 && x !== y) return x < y ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  function outlineTree(entries) {
    const byId = new Map();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || byId.has(e.id)) continue;
      byId.set(e.id, { id: e.id, entry: e, parent: null, children: [], level: 1 });
    }
    for (const node of byId.values()) {
      const pid = node.entry.parent;
      node.parent = typeof pid === 'string' && pid && pid !== node.id ? byId.get(pid) || null : null;
    }
    // A loop of parents: walk up from each entry once, marking what is on the walk (1) and what is known to end at the top (2); meeting
    // an entry on the same walk is a loop, and that entry lets go of its parent. Every entry is walked once: linear.
    const mark = new Map();
    for (const start of byId.values()) {
      if (mark.has(start)) continue;
      const path = [];
      let p = start;
      while (p && !mark.has(p)) { mark.set(p, 1); path.push(p); p = p.parent; }
      if (p && mark.get(p) === 1) p.parent = null;
      for (const q of path) mark.set(q, 2);
    }
    const roots = [];
    for (const node of byId.values()) (node.parent ? node.parent.children : roots).push(node);
    roots.sort(outlineCompare);
    const list = [];
    const stack = roots.slice().reverse();
    for (const r of roots) r.level = 1;
    while (stack.length) {
      const node = stack.pop();
      list.push(node);
      node.children.sort(outlineCompare);
      for (const c of node.children) c.level = node.level + 1;
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
    }
    return { roots, byId, list };
  }
  // How many levels a node's subtree takes, itself included.
  function outlineHeight(node) {
    let most = 1;
    const stack = [[node, 1]];
    while (stack.length) {
      const [n, h] = stack.pop();
      if (h > most) most = h;
      for (const c of n.children) stack.push([c, h + 1]);
    }
    return most;
  }
  const outlineValid = (n) => Boolean(n) && typeof n.entry.order === 'string' && ORDER_KEY.test(n.entry.order) && !n.entry.order.endsWith('0');
  // Where an entry would go: under `parentId` (null: the top) at `index` among that parent's other children. { id, parent, order,
  // index, count } (index and count for the words a screen reader hears), or null when it is no change, is into itself or its own
  // children, or goes deeper than `depth` levels.
  function outlinePlace(tree, id, parentId, index, depth) {
    const node = tree.byId.get(id);
    if (!node) return null;
    const parent = parentId === null ? null : tree.byId.get(parentId) || null;
    if (parentId !== null && !parent) return null;
    for (let p = parent; p; p = p.parent) if (p === node) return null;
    const level = parent ? parent.level + 1 : 1;
    if (level + outlineHeight(node) - 1 > depth) return null;
    const sibs = (parent ? parent.children : tree.roots).filter((n) => n !== node);
    const at = Math.max(0, Math.min(Math.floor(index), sibs.length));
    if (node.parent === parent && (parent ? parent.children : tree.roots).indexOf(node) === at) return null;
    const prev = sibs[at - 1];
    const next = sibs[at];
    let key;
    try {
      if ((prev && !outlineValid(prev)) || (next && !outlineValid(next))) throw new RangeError('not keys');
      const a = prev ? prev.entry.order : null;
      let b = next ? next.entry.order : null;
      if (a !== null && b !== null && a >= b) { // two entries share a key: go after all of them
        let k = at;
        while (k < sibs.length && outlineValid(sibs[k]) && sibs[k].entry.order <= a) k += 1;
        b = k < sibs.length && outlineValid(sibs[k]) ? sibs[k].entry.order : null;
      }
      key = outlineOrder(a, b);
    } catch (err) { // keys that are not order keys (or a loop of ties): after the last good one
      const good = sibs.filter(outlineValid).map((n) => n.entry.order).sort();
      try { key = outlineOrder(good.length ? good[good.length - 1] : null, null); } catch (err2) { return null; }
    }
    return { id, parent: parentId, order: key, index: at, count: sibs.length + 1 };
  }
  // The four keyboard and menu moves of one entry, each a place or null: { up, down, indent, outdent }.
  function outlineMoves(tree, id, depth) {
    const node = tree.byId.get(id);
    const none = { up: null, down: null, indent: null, outdent: null };
    if (!node) return none;
    const pid = node.parent ? node.parent.id : null;
    const sibs = node.parent ? node.parent.children : tree.roots;
    const i = sibs.indexOf(node);
    const before = i > 0 ? sibs[i - 1] : null;
    return {
      up: i > 0 ? outlinePlace(tree, id, pid, i - 1, depth) : null,
      down: i < sibs.length - 1 ? outlinePlace(tree, id, pid, i + 1, depth) : null,
      indent: before ? outlinePlace(tree, id, before.id, before.children.length, depth) : null,
      outdent: node.parent ? outlinePlace(tree, id, node.parent.parent ? node.parent.parent.id : null, (node.parent.parent ? node.parent.parent.children : tree.roots).indexOf(node.parent) + 1, depth) : null,
    };
  }
  // Dropping `dragId` on `targetId`: zone 'before' or 'after' the target (as its sibling), or 'into' it (its last child; an open
  // target with children takes 'after' as its first child, since that is where it is drawn). null when it may not go there.
  function outlineDrop(tree, dragId, targetId, zone, depth, isOpen) {
    const drag = tree.byId.get(dragId);
    const target = tree.byId.get(targetId);
    if (!drag || !target || drag === target) return null;
    for (let p = target.parent; p; p = p.parent) if (p === drag) return null;
    const pid = target.parent ? target.parent.id : null;
    const others = (target.parent ? target.parent.children : tree.roots).filter((n) => n !== drag);
    const kids = target.children.filter((n) => n !== drag);
    if (zone === 'into') return outlinePlace(tree, dragId, target.id, kids.length, depth);
    if (zone === 'before') return outlinePlace(tree, dragId, pid, others.indexOf(target), depth);
    if (kids.length && (typeof isOpen === 'function' ? isOpen(target) : true)) return outlinePlace(tree, dragId, target.id, 0, depth);
    return outlinePlace(tree, dragId, pid, others.indexOf(target) + 1, depth);
  }
  // host.util.rollup(entries, { done(entry) }?): for each entry that has children, { done, total } counted over the entries below
  // it at any depth that have no children of their own (an entry with children is what its children make it). An entry is done when
  // `entry.done` is truthy, or `o.done(entry)` says so. Returns an object keyed by id with only those entries; a loop of parents
  // or a parent that is not there is read as the tree reads it (see outlineTree).
  function outlineRollup(entries, o) {
    const tree = outlineTree(entries);
    const isDone = o && typeof o.done === 'function' ? o.done : (e) => Boolean(e && e.done);
    const tally = new Map();
    const out = Object.create(null);
    for (let i = tree.list.length - 1; i >= 0; i -= 1) {
      const n = tree.list[i];
      if (!n.children.length) { let d = false; try { d = Boolean(isDone(n.entry)); } catch (err) { /* not done */ } tally.set(n, { done: d ? 1 : 0, total: 1 }); continue; }
      let done = 0;
      let total = 0;
      for (const c of n.children) { const t = tally.get(c); done += t.done; total += t.total; }
      tally.set(n, { done, total });
      out[n.id] = { done, total };
    }
    return out;
  }
  // outline:end

  // ---- The colour picker's pure parts (plan-colour-picker.md, step 1) -------------------------------------------------------------
  // Cleaning a hex, hex to hue, saturation and brightness and back, the default palette, the palette check, the answer's shape and
  // host.util.contrast / host.util.readableOn. Pure code between the markers, so tools/check-colour-picker.mjs can slice it out of
  // this file and run it in Node. The contrast maths is theme-colour.js's (contrast, pickOn); the check holds the two equal.
  // colour:start
  const COLOUR_HEX = /^#[0-9a-f]{6}$/;
  // '#2F6CBF', '2f6cbf' and ' #2f6cbf ' are '#2f6cbf'; anything else (3 or 8 digits, a name, url(), not a string) is null.
  function colourClean(value) {
    if (typeof value !== 'string') return null;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
    return m ? `#${m[1].toLowerCase()}` : null;
  }
  // '#rrggbb' to { h: 0 to under 360, s: 0 to 100, v: 0 to 100 }, unrounded, so it goes back to the same hex. A grey has hue 0.
  function colourToHsv(hex) {
    const c = colourClean(hex);
    if (!c) throw new TypeError('colourToHsv takes a #rrggbb colour');
    const n = parseInt(c.slice(1), 16);
    const r = (n >> 16) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
      if (h >= 360) h -= 360;
    }
    return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
  }
  // { h, s, v } back to '#rrggbb', lower case. The hue wraps; saturation and brightness are held to 0 to 100.
  function colourFromHsv(hsv) {
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const o = hsv || {};
    const h = ((num(o.h) % 360) + 360) % 360;
    const s = Math.max(0, Math.min(100, num(o.s))) / 100;
    const v = Math.max(0, Math.min(100, num(o.v))) / 100;
    const f = (k) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
    return `#${[f(5), f(3), f(1)].map((x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0')).join('')}`;
  }
  // The person's colour grid (plan-colour-picker.md, "The person's colour grid"; decisions 22 to 24). Before their first edit it is
  // these 24 starting colours, all at opacity 100, in the grid's own order; they are not stored until then. A picked colour is data,
  // the same in every theme, so these are not tokens. (Each is written as [name, hex] so that no line reads as a stylesheet declaration.)
  const COLOUR_GRID_MAX = 48;
  const COLOUR_GRID_START = Object.freeze([
    ['White', '#ffffff'], ['Light grey', '#c0c0c0'], ['Grey', '#808080'], ['Dark grey', '#404040'],
    ['Black', '#000000'], ['Light red', '#f28b82'], ['Red', '#d62828'], ['Dark red', '#8b1a1a'],
    ['Light brown', '#d2b48c'], ['Orange', '#f28c28'], ['Brown', '#8b5a2b'], ['Yellow', '#ffe135'],
    ['Light green', '#90ee90'], ['Green', '#2e9e3e'], ['Dark green', '#1b5e20'], ['Cyan', '#00bcd4'],
    ['Teal', '#008080'], ['Light blue', '#87ceeb'], ['Blue', '#1e5fd0'], ['Dark blue', '#1a237e'],
    ['Light purple', '#c3a6e8'], ['Purple', '#7b3fb5'], ['Pink', '#f48fb1'], ['Magenta', '#d81b9c'],
  ].map(([name, hex]) => Object.freeze({ name, color: hex, opacity: 100 })));
  // A grid as the page or the server gives it, checked: a fresh list of { color: '#rrggbb' lower case, opacity: a whole 0 to 100 },
  // at most 48 (`max`), no colour and opacity twice; anything else (a hole, an extra key, a string opacity, upper case) is null.
  function colourGridClean(list, max = COLOUR_GRID_MAX) {
    if (!Array.isArray(list) || list.length > max) return null;
    const out = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i += 1) {
      const e = Object.prototype.hasOwnProperty.call(list, i) ? list[i] : null;
      if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
      const keys = Object.keys(e);
      if (keys.length !== 2 || !keys.includes('color') || !keys.includes('opacity')) return null;
      if (typeof e.color !== 'string' || !COLOUR_HEX.test(e.color) || !Number.isInteger(e.opacity) || e.opacity < 0 || e.opacity > 100) return null;
      const k = `${e.color}/${e.opacity}`;
      if (seen.has(k)) return null;
      seen.add(k);
      out.push({ color: e.color, opacity: e.opacity });
    }
    return out;
  }
  // The grid's order ("The order"): the neutrals first (HSL saturation under 10 percent), light to dark; then by hue in twelve bands
  // of 30 degrees, the first centred on red; within a band, lighter first; a tie keeps the order it was stored in. A sorted copy.
  function colourGridOrder(list) {
    const place = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const r = (n >> 16) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      return { band: s < 0.1 ? -1 : Math.floor(((colourToHsv(hex).h + 15) % 360) / 30), l };
    };
    return list.map((e, i) => ({ e, i, ...place(e.color) }))
      .sort((a, b) => a.band - b.band || b.l - a.l || a.i - b.i)
      .map((x) => x.e);
  }
  // A grid colour's name: a starting colour's own name at opacity 100, else '' (a colour a person adds is named by its hex).
  function colourGridName(entry) {
    if (!entry || entry.opacity !== 100) return '';
    const s = COLOUR_GRID_START.find((c) => c.color === entry.color);
    return s ? s.name : '';
  }
  // What a grid swatch is called: its name, else its hex, with its opacity below 100 ("#2f6cbf, 60 percent").
  function colourGridLabel(entry) {
    const name = colourGridName(entry);
    if (name) return name;
    return entry.opacity < 100 ? `${entry.color}, ${entry.opacity} percent` : entry.color;
  }
  // The place of a colour at an opacity in a grid, or -1.
  function colourGridFind(list, entry) {
    return list.findIndex((c) => c.color === entry.color && c.opacity === entry.opacity);
  }
  // Adding a colour: { list, how } where how is 'added' (a new list with it at the end), 'there' (the same colour and opacity is in
  // it already) or 'full' (48 already); the list is unchanged for the last two.
  function colourGridAdd(list, entry) {
    if (colourGridFind(list, entry) >= 0) return { list, how: 'there' };
    if (list.length >= COLOUR_GRID_MAX) return { list, how: 'full' };
    return { list: [...list, { color: entry.color, opacity: entry.opacity }], how: 'added' };
  }
  // Removing a colour: a new list without it (the same list when it is not there).
  function colourGridRemove(list, entry) {
    const i = colourGridFind(list, entry);
    return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
  }
  // The person's Recent colours (decision 27): kept on their account, one list across all modules, newest first, at most 8, each
  // { color, opacity }; checked as the grid is (colourRecentClean). A choice goes to the front and an older copy of the same colour
  // and opacity is dropped: colourRecentAdd answers that new list (the one sent whole to the page) and leaves `list` alone.
  const COLOUR_RECENT_MAX = 8;
  const colourRecentClean = (list) => colourGridClean(list, COLOUR_RECENT_MAX);
  function colourRecentAdd(list, entry) {
    const was = Array.isArray(list) ? list : [];
    return [{ color: entry.color, opacity: entry.opacity }, ...was.filter((c) => !(c.color === entry.color && c.opacity === entry.opacity)).map((c) => ({ color: c.color, opacity: c.opacity }))].slice(0, COLOUR_RECENT_MAX);
  }
  // A module's own palette, checked: a fresh copy [{ heading, colours: [{ name, color }] }] with names trimmed and colours cleaned.
  // At most 6 groups and 48 colours; every heading and name plain text: at most 40 characters, at least one letter or digit, and no
  // control, format (zero-width, bidi), line or paragraph separator characters, lone surrogates, < or >. The input is walked by index
  // and copied into new arrays, so a hole or an array's own `map` decides nothing. A name reaches the page only as text.
  function colourPaletteCheck(palette) {
    const refuse = () => new TypeError('host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour');
    const plain = (x) => {
      if (typeof x !== 'string') return null;
      const t = x.trim();
      if (!t || t.length > 40) return null;
      if (/[\u0000-\u001f\u007f-\u009f<>]|[\p{Cf}\p{Zl}\p{Zp}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(t)) return null;
      return /[\p{L}\p{N}]/u.test(t) ? t : null;
    };
    const has = (o, i) => Object.prototype.hasOwnProperty.call(o, i);
    if (!Array.isArray(palette) || !palette.length || palette.length > 6) throw refuse();
    const out = [];
    let count = 0;
    for (let i = 0; i < palette.length; i += 1) {
      const group = has(palette, i) ? palette[i] : undefined;
      const heading = group && typeof group === 'object' ? plain(group.heading) : null;
      const list = group && typeof group === 'object' && Array.isArray(group.colours) ? group.colours : null;
      if (!heading || !list || !list.length) throw refuse();
      count += list.length;
      if (count > 48) throw refuse();
      const colours = [];
      for (let j = 0; j < list.length; j += 1) {
        const entry = has(list, j) ? list[j] : undefined;
        const name = entry && typeof entry === 'object' ? plain(entry.name) : null;
        const hex = entry && typeof entry === 'object' ? colourClean(entry.color) : null;
        if (!name || !hex) throw refuse();
        colours.push({ name, color: hex });
      }
      out.push({ heading, colours });
    }
    return out;
  }
  // An opacity as a whole percent from 0 to 100; anything that is not a number is 100.
  function colourOpacity(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
  }
  // The picker's answer: { color: '#rrggbb', opacity: 0 to 100 }; with keepsOpacity false the opacity is always 100.
  function colourAnswer(color, opacity, keepsOpacity) {
    const c = colourClean(color);
    if (!c) throw new TypeError('host.ui.colorPicker answers a #rrggbb colour');
    return { color: c, opacity: keepsOpacity === false ? 100 : colourOpacity(opacity) };
  }
  // The WCAG 2 contrast ratio of two #rrggbb colours (theme-colour.js's maths, the same constants).
  const colourLum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  // Strict: '#' and six lower-case hex digits only (COLOUR_HEX); anything else throws.
  function colourContrast(a, b) {
    const x = typeof a === 'string' && COLOUR_HEX.test(a) ? a : null;
    const y = typeof b === 'string' && COLOUR_HEX.test(b) ? b : null;
    if (!x || !y) throw new TypeError('host.util.contrast takes two #rrggbb colours');
    const p = colourLum(x);
    const q = colourLum(y);
    return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05);
  }
  // White or near-black words on a fill, whichever has more contrast (white on a tie, as pickOn); ok at 4.5:1 or more.
  function colourReadableOn(fill) {
    const f = typeof fill === 'string' && COLOUR_HEX.test(fill) ? fill : null;
    if (!f) throw new TypeError('host.util.readableOn takes a #rrggbb colour');
    const w = colourContrast('#ffffff', f);
    const d = colourContrast('#0a0a0a', f);
    const ratio = Math.max(w, d);
    return { color: w >= d ? '#ffffff' : '#0a0a0a', ratio, ok: ratio >= 4.5 };
  }
  // colour:end

  // A shared tag's look (plan-colour-picker.md, decision 30): a tag's colour is '#rrggbb', picked with the colour picker, or none. A
  // colour is the chip's fill with readable words on it (readableOn), set as --tag-fill and --tag-ink (system.css draws them); no colour
  // is the plain chip. The one place a tag chip or a tag's dot gets its colour: host.tags here, and a page through
  // window.hostColour.paintTag (Set up's Tags section). Answers the element.
  function paintTag(el, color) {
    const hex = typeof color === 'string' && COLOUR_HEX.test(color) ? color : '';
    if (!hex) {
      el.dataset.tone = 'neutral';
      el.removeAttribute('data-tag-fill');
      el.style.removeProperty('--tag-fill');
      el.style.removeProperty('--tag-ink');
      return el;
    }
    el.removeAttribute('data-tone');
    el.dataset.tagFill = '';
    el.style.setProperty('--tag-fill', hex);
    el.style.setProperty('--tag-ink', colourReadableOn(hex).color);
    return el;
  }

  // The words the outline says itself; the module passes its own as `labels` (it does not translate these).
  const OUTLINE_WORDS = {
    empty: 'Nothing here yet.', name: 'Outline', move: 'Move', open: 'Open', moveUp: 'Move up', moveDown: 'Move down', indent: 'Indent', outdent: 'Outdent',
    fold: 'Fold', unfold: 'Unfold', moved: (n, of) => `Moved to place ${n} of ${of}.`,
  };
  let outlineSeq = 0;
  // host.ui.outline(el, { entries, depth?, name?, labels?, canEdit?, collapsed?, title?(entry), row?(entry, contentEl, info), menu?(entry),
  //   onOpen?(entry), onMove({ id, parent, order }), onFold?(id, folded) }) -> { set(entries), fold(id, folded?), focus(id), destroy() }.
  // deps: { icon(name) -> Promise<svg>, menu(args) } from the module's host.
  function createOutline(el, o, deps) {
    if (!el || el.nodeType !== 1) throw new Error('host.ui.outline needs an element');
    const options = o || {};
    const doc = el.ownerDocument;
    const depth = Math.max(1, Math.min(5, Math.floor(Number(options.depth)) || 2));
    const words = { ...OUTLINE_WORDS };
    for (const [k, v] of Object.entries(options.labels || {})) if (k in OUTLINE_WORDS && typeof v === typeof OUTLINE_WORDS[k]) words[k] = v;
    const editable = options.canEdit !== false;
    const seq = ++outlineSeq;
    const MIME = `application/x-host-outline-${seq}`; // one instance's own drag type: a drag from anywhere else is never its drag
    let tree = outlineTree([]);
    const folded = new Set(Array.isArray(options.collapsed) ? options.collapsed.filter((x) => typeof x === 'string') : []);
    let current = ''; // the entry whose handle is the tab stop
    let said = null; // the move the module was told of, to announce once a later set() shows it
    let late = false; // a set() that waits because a person is typing in a row's own field
    let drag = null; // { id, handle } while this outline's own handle is being dragged
    let dropAt = null; // { row, cls } the row showing where it would land
    let dead = false;
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const ids = new WeakMap(); // an item's element -> its entry id (never read back from the page)
    const idOf = (node) => { const li = node && node.closest ? node.closest('li.sdk-outline-item') : null; return li && el.contains(li) ? ids.get(li) || '' : ''; };
    const svg = async (parent, name) => { try { const s = await deps.icon(name); if (s && !dead) parent.innerHTML = s; } catch (err) { /* no icon */ } };

    el.classList.add('sdk-outline');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', typeof options.name === 'string' && options.name ? options.name : words.name);
    const live = make('div', 'sdk-outline-live');
    live.setAttribute('role', 'status');
    const body = make('div', 'sdk-outline-body');
    el.replaceChildren(body, live);

    const titleOf = (n) => {
      let t = '';
      try { if (typeof options.title === 'function') t = String(options.title(n.entry) ?? ''); } catch (err) { /* the row's own text */ }
      return (t || n.entry.title || n.entry.name || n.id).toString().replace(/\s+/g, ' ').trim().slice(0, 80);
    };
    const open = (n) => !folded.has(n.id);
    const handles = () => [...el.querySelectorAll('.sdk-outline-handle')];
    const say = (text) => { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = text; }, 30); };

    function perform(plan) {
      if (!plan || !editable || typeof options.onMove !== 'function') return;
      said = { id: plan.id, parent: plan.parent, order: plan.order, text: typeof words.moved === 'function' ? words.moved(plan.index + 1, plan.count) : String(words.moved) };
      try {
        const r = options.onMove({ id: plan.id, parent: plan.parent, order: plan.order });
        if (r && typeof r.catch === 'function') r.catch((err) => console.error(err));
      } catch (err) { console.error(err); }
    }

    // One entry's line, without its children.
    function item(n) {
      const li = make('li', 'sdk-outline-item');
      ids.set(li, n.id);
      li.setAttribute('data-level', String(n.level));
      const row = make('div', 'sdk-outline-row');
      const kids = n.children.length;
      if (kids) {
        const f = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-outline-fold');
        f.type = 'button';
        f.setAttribute('aria-expanded', String(open(n)));
        f.setAttribute('aria-label', `${open(n) ? words.fold : words.unfold}: ${titleOf(n)}`);
        const ic = make('span', 'ic'); ic.setAttribute('aria-hidden', 'true');
        f.append(ic); svg(ic, 'chevron-right');
        row.append(f);
      } else row.append(make('span', 'sdk-outline-fold-gap'));
      const content = make('div', 'sdk-outline-content');
      let made = false;
      if (typeof options.row === 'function') {
        try { options.row(n.entry, content, { level: n.level, children: kids, folded: !open(n), canEdit: editable }); made = Boolean(content.firstChild); } catch (err) { console.error(err); content.replaceChildren(); }
      }
      if (!made) content.textContent = titleOf(n);
      row.append(content);
      if (editable) {
        const h = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-outline-handle');
        h.type = 'button';
        h.draggable = true;
        h.tabIndex = n.id === current ? 0 : -1;
        h.setAttribute('aria-haspopup', 'menu');
        h.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
        h.setAttribute('aria-label', `${words.move}: ${titleOf(n)}`);
        h.dataset.tip = words.move;
        const grip = make('span', 'ic sdk-outline-grip'); grip.setAttribute('aria-hidden', 'true'); svg(grip, 'grip-vertical');
        const dots = make('span', 'ic sdk-outline-dots'); dots.setAttribute('aria-hidden', 'true'); svg(dots, 'ellipsis-vertical');
        h.append(grip, dots);
        row.append(h);
      }
      li.append(row);
      return li;
    }
    // The levels are drawn nested down to `depth`; an entry below that (data written elsewhere) is drawn flat, in order, under the
    // line of the one at the last level, so a very deep list is never a very deep page.
    function build(nodes, ul) {
      for (const n of nodes) {
        const li = item(n);
        ul.append(li);
        if (!n.children.length || !open(n)) continue;
        if (n.level < depth) {
          const sub = make('ul', 'sdk-outline-list');
          build(n.children, sub);
          li.append(sub);
        } else {
          const stack = n.children.slice().reverse();
          const flat = make('ul', 'sdk-outline-list');
          while (stack.length) {
            const d = stack.pop();
            flat.append(item(d));
            if (d.children.length && open(d)) for (let i = d.children.length - 1; i >= 0; i -= 1) stack.push(d.children[i]);
          }
          li.append(flat);
        }
      }
    }

    function draw() {
      if (dead) return;
      const act = (deps.root && deps.root.activeElement) || doc.activeElement;
      // A person typing in a field of their own row: the redraw waits until they leave it (focusout), so their text and focus stay.
      if (act && el.contains(act) && act.closest && act.closest('.sdk-outline-content') && act.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) { late = true; return; }
      late = false;
      // Focus goes back only to a handle or fold button that had it; anything else keeps it where it is.
      const hadEl = act && el.contains(act) && act.closest ? act.closest('.sdk-outline-handle, .sdk-outline-fold') : null;
      const had = hadEl ? { id: idOf(hadEl), cls: hadEl.classList.contains('sdk-outline-handle') ? 'handle' : 'fold' } : null;
      drag = null; // a rebuilt list has no handle being dragged
      if (!tree.byId.has(current)) current = tree.roots[0] ? tree.roots[0].id : '';
      clearDrop();
      if (!tree.list.length) {
        const p = make('p', 'sdk-outline-empty', typeof options.empty === 'string' && options.empty ? options.empty : words.empty);
        body.replaceChildren(p);
        said = null;
        return;
      }
      const ul = make('ul', 'sdk-outline-list sdk-outline-top');
      build(tree.roots, ul);
      body.replaceChildren(ul);
      if (had && had.id) { const h = had.cls === 'handle' ? handleOf(had.id) || foldOf(had.id) : foldOf(had.id) || handleOf(had.id); if (h) h.focus(); }
      if (said) { // told only once the list shows the move
        const n = tree.byId.get(said.id);
        if (n && (n.parent ? n.parent.id : null) === said.parent && n.entry.order === said.order) say(said.text);
        said = null;
      }
    }
    const itemOf = (id) => { for (const li of el.querySelectorAll('li.sdk-outline-item')) if (ids.get(li) === id) return li; return null; };
    const handleOf = (id) => { const li = itemOf(id); return li ? li.querySelector(':scope > .sdk-outline-row > .sdk-outline-handle') : null; };
    const foldOf = (id) => { const li = itemOf(id); return li ? li.querySelector(':scope > .sdk-outline-row > .sdk-outline-fold') : null; };
    function setCurrent(id) {
      current = id;
      for (const h of handles()) h.tabIndex = idOf(h) === id ? 0 : -1;
    }
    function toggle(id, to) {
      const n = tree.byId.get(id);
      if (!n || !n.children.length) return;
      const wasOpen = open(n);
      const next = to === undefined ? !wasOpen : Boolean(to);
      if (next === wasOpen) return;
      if (next) folded.delete(id); else folded.add(id);
      draw();
      if (typeof options.onFold === 'function') { try { options.onFold(id, !next); } catch (err) { console.error(err); } }
    }

    function showMenu(id, anchor) {
      const n = tree.byId.get(id);
      if (!n) return;
      const m = outlineMoves(tree, id, depth);
      const go = (plan) => () => perform(plan);
      const items = [];
      if (typeof options.onOpen === 'function') items.push({ id: 'open', label: words.open, icon: 'arrow-up-right-from-square', onClick: () => { try { options.onOpen(n.entry); } catch (err) { console.error(err); } } }, { separator: true });
      items.push(
        { id: 'up', label: words.moveUp, icon: 'arrow-up', disabled: !m.up, onClick: go(m.up) },
        { id: 'down', label: words.moveDown, icon: 'arrow-down', disabled: !m.down, onClick: go(m.down) },
        { id: 'indent', label: words.indent, icon: 'indent', disabled: !m.indent, onClick: go(m.indent) },
        { id: 'outdent', label: words.outdent, icon: 'outdent', disabled: !m.outdent, onClick: go(m.outdent) },
      );
      let extra = [];
      try { extra = typeof options.menu === 'function' ? options.menu(n.entry) : []; } catch (err) { console.error(err); }
      if (Array.isArray(extra) && extra.length) items.push({ separator: true }, ...extra);
      // When the menu closes with focus nowhere (a pick or Escape), it goes back to this entry's handle.
      deps.menu({ id: 'sdk-outline-menu', anchor, items, onClose: () => { const a = (deps.root && deps.root.activeElement) || doc.activeElement; if (!a || a === doc.body) { const h = handleOf(id); if (h) h.focus(); } } });
    }

    // ---- the keyboard and the pointer, on the outline itself ----
    const onClick = (e) => {
      const fold = e.target.closest ? e.target.closest('.sdk-outline-fold') : null;
      if (fold && el.contains(fold)) { toggle(idOf(fold)); return; }
      const h = e.target.closest ? e.target.closest('.sdk-outline-handle') : null;
      if (h && el.contains(h)) { setCurrent(idOf(h)); showMenu(idOf(h), h); return; }
      if (typeof options.onOpen === 'function' && e.target.closest) {
        const content = e.target.closest('.sdk-outline-content');
        if (content && el.contains(content) && !e.target.closest('a, button, input, select, textarea, label, [contenteditable]')) {
          const n = tree.byId.get(idOf(content));
          if (n) { try { options.onOpen(n.entry); } catch (err) { console.error(err); } }
        }
      }
    };
    const onFocusIn = (e) => { const h = e.target.closest ? e.target.closest('.sdk-outline-handle') : null; if (h && el.contains(h)) setCurrent(idOf(h)); };
    const onKey = (e) => {
      // Alt+Left and Alt+Right are the browser's Back and Forward: never while focus is in the outline.
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && el.contains(e.target)) e.preventDefault();
      const h = e.target.closest ? e.target.closest('.sdk-outline-handle, .sdk-outline-fold') : null;
      if (!h || !el.contains(h) || e.ctrlKey || e.metaKey) return;
      const id = idOf(h);
      const isHandle = h.classList.contains('sdk-outline-handle');
      if (e.altKey && !e.shiftKey && isHandle) {
        const m = outlineMoves(tree, id, depth);
        const plan = { ArrowUp: m.up, ArrowDown: m.down, ArrowRight: m.indent, ArrowLeft: m.outdent }[e.key];
        if (e.key in { ArrowUp: 1, ArrowDown: 1, ArrowRight: 1, ArrowLeft: 1 }) { e.preventDefault(); perform(plan); }
        return;
      }
      if (e.altKey || e.shiftKey) return;
      const list = handles();
      const at = list.indexOf(h);
      const go = (to) => { if (to && to !== h) { e.preventDefault(); to.focus(); } };
      if (e.key === 'ArrowDown' && isHandle) go(list[at + 1]);
      else if (e.key === 'ArrowUp' && isHandle) go(list[at - 1]);
      else if (e.key === 'Home' && isHandle) go(list[0]);
      else if (e.key === 'End' && isHandle) go(list[list.length - 1]);
      else if (e.key === 'ArrowRight' && tree.byId.get(id) && tree.byId.get(id).children.length && !open(tree.byId.get(id))) { e.preventDefault(); toggle(id, true); }
      else if (e.key === 'ArrowLeft' && tree.byId.get(id) && tree.byId.get(id).children.length && open(tree.byId.get(id))) { e.preventDefault(); toggle(id, false); }
    };
    function clearDrop() {
      if (dropAt) { dropAt.row.classList.remove('drop-before', 'drop-after', 'drop-into'); dropAt = null; }
    }
    const dragStart = (e) => {
      const h = e.target.closest ? e.target.closest('.sdk-outline-handle') : null;
      if (!h || !el.contains(h) || !editable) { return; }
      const id = idOf(h);
      if (!id || !e.dataTransfer) { e.preventDefault(); return; }
      drag = { id, handle: h };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(MIME, id);
      const row = h.closest('.sdk-outline-row');
      if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 16, 16);
      const li = h.closest('li');
      if (li) li.classList.add('dragging');
    };
    // Where the pointer is over a row: the top third puts the entry before it, the bottom third after it, the middle inside it.
    function planFor(e) {
      if (!drag || !tree.byId.has(drag.id)) return null;
      const row = e.target.closest ? e.target.closest('.sdk-outline-row') : null;
      if (!row || !el.contains(row)) return null;
      const id = idOf(row);
      const rect = row.getBoundingClientRect();
      const f = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
      const zone = f < 0.33 ? 'before' : f > 0.66 ? 'after' : 'into';
      let plan = outlineDrop(tree, drag.id, id, zone, depth, open);
      let shown = zone === 'after' && plan && plan.parent === id ? 'into' : zone;
      if (!plan && zone === 'into') { shown = f < 0.5 ? 'before' : 'after'; plan = outlineDrop(tree, drag.id, id, shown, depth, open); if (plan && shown === 'after' && plan.parent === id) shown = 'into'; }
      return plan ? { plan, row, shown } : null;
    }
    const dragOver = (e) => {
      if (drag && !(drag.handle && drag.handle.isConnected && el.contains(drag.handle))) drag = null; // its handle is gone: no drag of ours
      if (!drag || !e.dataTransfer || ![...(e.dataTransfer.types || [])].includes(MIME)) return; // not this outline's own drag: left alone
      const hit = planFor(e);
      clearDrop();
      if (!hit) { e.dataTransfer.dropEffect = 'none'; return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      hit.row.classList.add(`drop-${hit.shown}`);
      dropAt = { row: hit.row };
    };
    const dragLeave = (e) => { if (!e.relatedTarget || !el.contains(e.relatedTarget)) clearDrop(); };
    const drop = (e) => {
      if (!drag || !e.dataTransfer || ![...(e.dataTransfer.types || [])].includes(MIME)) return;
      const hit = planFor(e);
      e.preventDefault();
      clearDrop();
      drag = null;
      if (hit) perform(hit.plan);
    };
    const onFocusOut = () => { if (late) setTimeout(() => { if (late && !dead) draw(); }, 0); };
    const dragEnd = () => { clearDrop(); drag = null; for (const li of el.querySelectorAll('li.dragging')) li.classList.remove('dragging'); };
    const on = [['click', onClick], ['keydown', onKey], ['focusin', onFocusIn], ['dragstart', dragStart], ['dragover', dragOver], ['dragleave', dragLeave], ['drop', drop], ['dragend', dragEnd], ['focusout', onFocusOut]];
    for (const [t, f] of on) el.addEventListener(t, f);

    const api = {
      set(entries) { tree = outlineTree(entries); draw(); },
      fold(id, to) { toggle(String(id), to); },
      focus(id) { const h = handleOf(String(id)) || foldOf(String(id)); if (h) h.focus(); },
      destroy() { dead = true; for (const [t, f] of on) el.removeEventListener(t, f); el.replaceChildren(); el.classList.remove('sdk-outline'); el.removeAttribute('role'); el.removeAttribute('aria-label'); },
    };
    api.set(options.entries);
    return api;
  }

  // host.ui.progress(el, { done, total, label?, words?(done, total) }) -> { set({ done, total }), destroy() }: a small bar and the words
  // "2 of 4". Numbers that are not whole counts read as 0; done never passes total.
  function createProgress(el, o) {
    if (!el || el.nodeType !== 1) throw new Error('host.ui.progress needs an element');
    const options = o || {};
    const doc = el.ownerDocument;
    el.classList.add('sdk-progress-line');
    el.replaceChildren();
    const bar = doc.createElement('div');
    bar.className = 'sdk-progress sdk-progress-short';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', typeof options.label === 'string' && options.label ? options.label : 'Progress');
    bar.setAttribute('aria-valuemin', '0');
    const fill = doc.createElement('span');
    fill.className = 'sdk-progress-fill';
    bar.append(fill);
    const text = doc.createElement('span');
    text.className = 'sdk-progress-words';
    el.append(bar, text);
    const count = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
    const api = {
      set(next) {
        const total = count(next && next.total);
        const done = Math.min(count(next && next.done), total);
        let said = `${done} of ${total}`;
        try { if (typeof options.words === 'function') said = String(options.words(done, total)); } catch (err) { /* the plain words */ }
        fill.style.setProperty('--pct', `${total ? Math.round((done / total) * 100) : 0}%`);
        bar.setAttribute('aria-valuemax', String(total || 1));
        bar.setAttribute('aria-valuenow', String(done));
        bar.setAttribute('aria-valuetext', said);
        text.textContent = said;
      },
      destroy() { el.replaceChildren(); el.classList.remove('sdk-progress-line'); },
    };
    api.set(options);
    return api;
  }

  // host.ui.peoplePicker(el, { people?, value?, multiple?, name?, none?, gone?, onChange(keys) }) -> { get(), set(keys), setPeople(list), ready, destroy() }.
  // The people of the space as the same chips the Planner's owners use (a tick box or a radio in a label). `people` is [{ key, name }];
  // left out, host.people() is asked. `value` is the keys chosen. A chosen key that is no longer in the list shows as `gone` ("No longer here")
  // so it can be taken off. One person only (`multiple: false`) adds `none` ("No one") as the first choice.
  let peopleSeq = 0;
  function createPeoplePicker(el, o, deps) {
    if (!el || el.nodeType !== 1) throw new Error('host.ui.peoplePicker needs an element');
    const options = o || {};
    const doc = el.ownerDocument;
    const many = options.multiple !== false;
    const group = `sdk-people-${++peopleSeq}`;
    const clean = (list) => (Array.isArray(list) ? list : []).filter((p) => p && typeof p.key === 'string' && p.key && p.key.length <= 200).map((p) => ({ key: p.key, name: typeof p.name === 'string' && p.name ? p.name : p.key }));
    let people = clean(options.people);
    const keys = (v) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).filter((k) => typeof k === 'string' && k && k.length <= 200))].slice(0, many ? 500 : 1);
    let chosen = keys(options.value);
    let dead = false;
    el.classList.add('sdk-people');
    el.setAttribute('role', many ? 'group' : 'radiogroup');
    el.setAttribute('aria-label', typeof options.name === 'string' && options.name ? options.name : many ? 'People' : 'Person');
    function chip(key, text, on) {
      const label = doc.createElement('label');
      const input = doc.createElement('input');
      input.type = many ? 'checkbox' : 'radio';
      if (!many) input.name = group;
      input.value = key;
      input.checked = on;
      label.append(input, doc.createTextNode(text));
      return label;
    }
    function draw() {
      if (dead) return;
      const known = new Set(people.map((p) => p.key));
      const rows = [];
      if (!many) rows.push(chip('', typeof options.none === 'string' && options.none ? options.none : 'No one', !chosen.length));
      for (const p of people) rows.push(chip(p.key, p.name, chosen.includes(p.key)));
      for (const k of chosen) if (!known.has(k)) rows.push(chip(k, typeof options.gone === 'string' && options.gone ? options.gone : 'No longer here', true));
      el.replaceChildren(...rows);
    }
    const onChange = () => {
      chosen = [...el.querySelectorAll('input:checked')].map((i) => i.value).filter(Boolean);
      if (typeof options.onChange === 'function') { try { options.onChange(chosen.slice()); } catch (err) { console.error(err); } }
    };
    el.addEventListener('change', onChange);
    draw();
    const ready = options.people ? Promise.resolve() : Promise.resolve(deps.people()).then((list) => { people = clean(list); draw(); }).catch(() => {});
    return {
      get: () => chosen.slice(),
      set(next) { chosen = keys(next); draw(); },
      setPeople(list) { people = clean(list); draw(); },
      ready,
      destroy() { dead = true; el.removeEventListener('change', onChange); el.replaceChildren(); el.classList.remove('sdk-people'); },
    };
  }

  // The kind picker (host.ui.kindPicker): one row that names the chosen kind of thing with its icon in its colour, a list
  // of the kinds in groups when opened, typing to filter, recently chosen kinds first. The ARIA combobox pattern (an
  // editable field with a listbox). Styles in /sdk/host.css (.sdk-kind); see documentation/plans/plan-editor-window.md,
  // Part 2. These helpers are pure so tools/check-module-window.mjs can slice them out and run them.
  const KIND_RECENT_MAX = 4;
  const KIND_RECENT_KEEP = 12; // ids kept in this browser (more than shown, so a change of `max` has something to show)
  // The words a kind is found by: its label and its `words`, lower-cased, without accents ("Café" is found by "cafe").
  const kindWords = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // Every word typed must start some word of the kind's name or its `words`.
  function kindMatches(option, query) {
    const parts = kindWords(query);
    if (!parts.length) return true;
    const words = [...kindWords(option.label), ...(Array.isArray(option.words) ? option.words : []).flatMap(kindWords)];
    return parts.every((p) => words.some((w) => w.startsWith(p)));
  }
  // How well a kind matches what was typed, for the order: 0 its name is the query, 1 its name starts with it, 2 a later
  // word of its name does, 3 only its `words` do, 4 no match.
  function kindRank(option, query) {
    if (!kindMatches(option, query)) return 4;
    const q = kindWords(query).join(' ');
    const name = kindWords(option.label).join(' ');
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    const parts = kindWords(query);
    return parts.every((p) => kindWords(option.label).some((w) => w.startsWith(p))) ? 2 : 3;
  }
  // The groups the open list shows: with nothing typed, Recent first (the ids in `recent` that are in the groups, in that
  // order, up to `max`, and not repeated in their own groups below), then every group; with a query, the kinds that match
  // in their groups, the better matches first (a name that starts with the query before one found by its words; a group
  // ordered by its best match), and a group with none left goes. [] when nothing matches.
  function kindPickerGroups(groups, query, recent, max) {
    const all = (Array.isArray(groups) ? groups : []).filter((g) => g && Array.isArray(g.options));
    const q = String(query || '');
    if (kindWords(q).length) {
      return all.map((g) => {
        const ranked = g.options.filter(Boolean).map((o, i) => ({ o, r: kindRank(o, q), i })).filter((x) => x.r < 4).sort((a, b) => a.r - b.r || a.i - b.i);
        return { label: g.label, best: ranked.length ? ranked[0].r : 4, options: ranked.map((x) => x.o) };
      }).filter((g) => g.options.length).map((g, i) => ({ ...g, i })).sort((a, b) => a.best - b.best || a.i - b.i).map(({ label, options }) => ({ label, options }));
    }
    const byId = new Map();
    for (const g of all) for (const o of g.options) if (o && !byId.has(o.id)) byId.set(o.id, o);
    const top = (Array.isArray(recent) ? recent : []).filter((id, i, a) => byId.has(id) && a.indexOf(id) === i).slice(0, max || KIND_RECENT_MAX);
    if (!top.length) return all.map((g) => ({ label: g.label, options: g.options.filter(Boolean) })).filter((g) => g.options.length);
    const shown = new Set(top);
    return [{ label: 'Recent', recent: true, options: top.map((id) => byId.get(id)) }, ...all.map((g) => ({ label: g.label, options: g.options.filter((o) => o && !shown.has(o.id)) })).filter((g) => g.options.length)];
  }
  // A choice moves to the front of the recent ids, once.
  const kindRecentAdd = (ids, id) => [id, ...(Array.isArray(ids) ? ids : []).filter((x) => x !== id)].slice(0, KIND_RECENT_KEEP);
  const KIND_NEEDS = 'host.ui.kindPicker needs an element';
  let kindSeq = 0;
  // deps: { root, rootElement, icon(name) -> Promise<svg>, editorAt(el) -> dialog | null, moduleId } from the module's host.
  function createKindPicker(el, o, deps) {
    if (!el || el.nodeType !== 1) throw new Error(KIND_NEEDS);
    const options = o || {};
    const doc = el.ownerDocument;
    const memory = options.recent && options.recent.key ? `app:kind:${deps.moduleId || ''}:${String(options.recent.key).slice(0, 120)}` : '';
    const max = options.recent && Number(options.recent.max) > 0 ? Math.floor(Number(options.recent.max)) : KIND_RECENT_MAX;
    const readRecent = () => { if (!memory) return []; try { const v = JSON.parse(localStorage.getItem(memory) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch (err) { return []; } };
    const writeRecent = (id) => { if (!memory) return; try { localStorage.setItem(memory, JSON.stringify(kindRecentAdd(readRecent(), id))); } catch (err) { /* not kept */ } };
    let groups = [];
    let value = null;
    let open = false;
    let list = null; // the ul[role=listbox] while open
    let rows = []; // the options shown, in order: { id, option, el }
    let active = -1; // the active row's index
    let typed = ''; // what was typed since the list opened ('' shows every kind)
    const seq = ++kindSeq;
    const listId = `sdk-kind-list-${seq}`;
    const label = typeof options.label === 'string' && options.label ? options.label : 'Kind';
    const find = (id) => { for (const g of groups) for (const opt of g.options || []) if (opt && opt.id === id) return opt; return null; };
    // What has focus, seen from inside the module's root (a shadow root: the document only sees its host).
    const activeEl = () => (deps.root && deps.root.activeElement) || doc.activeElement || null;
    const first = () => { for (const g of groups) for (const opt of g.options || []) if (opt) return opt.id; return null; };
    // The row: the chip (the chosen kind's icon in its colour), the field, the chevron.
    el.classList.add('sdk-kind');
    el.replaceChildren();
    const field = doc.createElement('div');
    field.className = 'sdk-kind-field';
    const chip = doc.createElement('span');
    chip.className = 'sdk-kind-chip';
    chip.setAttribute('aria-hidden', 'true');
    const input = doc.createElement('input');
    input.type = 'text';
    input.className = 'sdk-kind-input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.spellcheck = false;
    const chevron = doc.createElement('span');
    chevron.className = 'sdk-kind-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.3 5.3 8 11l5.7-5.7-1.4-1.4L8 8.2 3.7 3.9z"/></svg>';
    field.append(chip, input, chevron);
    const sheet = doc.createElement('div');
    sheet.className = 'sdk-kind-sheet';
    sheet.appendChild(field);
    el.appendChild(sheet);
    const drawIcon = (node, name) => {
      node.replaceChildren();
      if (!name) return;
      deps.icon(name).then((svg) => { if (svg && node.dataset.kindIcon === name) node.innerHTML = svg; }, () => {});
    };
    const colour = (node, c) => { if (c) node.style.setProperty('--kind-color', String(c)); else node.style.removeProperty('--kind-color'); };
    // The closed row shows the chosen kind: its name in the field, its icon on the chip in its colour. An id that is not in
    // the groups (a marker type an owner removed) shows an empty field saying "Unknown kind", never another kind.
    const showChosen = () => {
      const opt = find(value);
      input.value = opt ? opt.label : '';
      input.placeholder = !opt && value ? 'Unknown kind' : '';
      chip.dataset.kindIcon = (opt && opt.icon) || '';
      chip.hidden = !opt || !opt.icon;
      colour(chip, opt && opt.color);
      drawIcon(chip, opt && opt.icon);
    };
    const setActive = (i, scroll) => {
      if (rows[active]) { rows[active].el.classList.remove('active'); }
      active = i >= 0 && i < rows.length ? i : -1;
      if (active === -1) { input.removeAttribute('aria-activedescendant'); return; }
      const row = rows[active];
      row.el.classList.add('active');
      input.setAttribute('aria-activedescendant', row.el.id);
      if (scroll !== false && typeof row.el.scrollIntoView === 'function') row.el.scrollIntoView({ block: 'nearest' });
    };
    // Where the list goes: under the field (above it when it would not fit), fixed against the window. Inside an open editor
    // window (host.ui.editor) it is appended to that dialog, so it is in the top layer with it; on a phone the stylesheet
    // makes the sheet (.sdk-kind-sheet, holding the field and the list) fill the lower part of the screen instead.
    const place = () => {
      if (!list || !open) return;
      if (phone()) { list.style.top = ''; list.style.left = ''; list.style.width = ''; list.style.maxHeight = ''; return; }
      const r = field.getBoundingClientRect();
      const h = Math.min(list.scrollHeight, 360);
      const below = window.innerHeight - 4 - (r.bottom + 4);
      const above = r.top - 8;
      const up = below < Math.min(h, 160) && above > below;
      const maxH = Math.max(80, Math.min(360, up ? above : below));
      list.style.maxHeight = maxH + 'px';
      list.style.width = Math.max(0, r.width) + 'px';
      list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - r.width - 4)) + 'px';
      list.style.top = (up ? Math.max(4, r.top - 4 - Math.min(h, maxH)) : r.bottom + 4) + 'px';
    };
    const phone = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
    // The list for what is typed: the groups, each with its name and its kinds; "Nothing matches" when none do.
    const draw = () => {
      if (!list) return;
      list.replaceChildren();
      rows = [];
      const shownGroups = kindPickerGroups(groups, typed, readRecent(), max);
      if (!shownGroups.length) {
        const none = doc.createElement('li');
        none.className = 'sdk-kind-empty';
        none.setAttribute('role', 'presentation');
        none.textContent = 'Nothing matches';
        list.appendChild(none);
      }
      shownGroups.forEach((g, gi) => {
        const li = doc.createElement('li');
        li.className = 'sdk-kind-group';
        li.setAttribute('role', 'group');
        const title = doc.createElement('div');
        title.className = 'sdk-kind-group-title';
        title.id = `${listId}-g${gi}`;
        title.textContent = g.label || '';
        li.setAttribute('aria-labelledby', title.id);
        li.appendChild(title);
        for (const opt of g.options) {
          const row = doc.createElement('div');
          row.className = 'sdk-kind-option';
          row.setAttribute('role', 'option');
          row.id = `${listId}-${rows.length}`;
          row.setAttribute('aria-selected', opt.id === value ? 'true' : 'false');
          row.dataset.id = String(opt.id);
          colour(row, opt.color);
          const name = doc.createElement('span');
          name.className = 'sdk-kind-name';
          name.textContent = opt.label || String(opt.id);
          if (opt.icon) {
            const ic = doc.createElement('span');
            ic.className = 'sdk-kind-icon';
            ic.setAttribute('aria-hidden', 'true');
            ic.dataset.kindIcon = opt.icon;
            drawIcon(ic, opt.icon);
            row.append(ic, name);
          } else row.append(name);
          const index = rows.length;
          row.addEventListener('mousemove', () => { if (active !== index) setActive(index, false); });
          row.addEventListener('click', (e) => { e.preventDefault(); choose(index); });
          li.appendChild(row);
          rows.push({ id: opt.id, option: opt, el: row });
        }
        list.appendChild(li);
      });
      // The active row: the chosen kind when it is in the list, else the first match.
      const at = rows.findIndex((r) => r.id === value);
      setActive(rows.length ? (typed || at === -1 ? 0 : at) : -1, false);
      if (rows[active]) rows[active].el.scrollIntoView({ block: typed ? 'nearest' : 'center' });
      place();
    };
    const away = (e) => { if (open && !el.contains(e.target) && !(list && list.contains(e.target))) close(); };
    const key = (e) => {
      if (e.key !== 'Escape' || !open) return;
      // Escape closes only the list: stopped and prevented, so an editor window around it does not close too.
      e.preventDefault();
      e.stopPropagation();
      close();
      input.focus();
    };
    const openList = () => {
      if (open || input.disabled) return;
      open = true;
      typed = '';
      list = doc.createElement('ul');
      list.className = 'sdk-kind-list';
      list.id = listId;
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', label);
      // The list never takes focus from the field (a click on a row chooses it while the field keeps focus).
      list.addEventListener('mousedown', (e) => e.preventDefault());
      // On a phone the sheet holds the field and the list; elsewhere the list goes under the field, into an open editor
      // window when the field is in one (so it is not inert under the dialog).
      const editor = deps.editorAt(input);
      if (phone()) sheet.appendChild(list); else (editor || (deps.root === doc ? doc.body : deps.root)).appendChild(list);
      el.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', listId);
      draw();
      doc.addEventListener('keydown', key, true);
      deps.root.addEventListener('pointerdown', away, true);
      // The list follows the field when anything scrolls: the document, and the module's root (a scroll inside a shadow
      // root, an editor dialog's own scrolling, never reaches the document's listener).
      doc.addEventListener('scroll', place, true);
      if (deps.root !== doc) deps.root.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
      if (phone() && activeEl() !== input) input.focus();
    };
    const close = () => {
      if (!open) return;
      open = false;
      if (list) list.remove();
      list = null;
      rows = [];
      active = -1;
      el.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.removeAttribute('aria-controls');
      doc.removeEventListener('keydown', key, true);
      deps.root.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('scroll', place, true);
      if (deps.root !== doc) deps.root.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      showChosen();
      if (activeEl() === input) input.select();
    };
    const choose = (i) => {
      const row = rows[i];
      if (!row) return close();
      const changed = row.id !== value;
      value = row.id;
      writeRecent(value);
      close();
      if (changed && typeof options.onChange === 'function') { try { options.onChange(value); } catch (err) { console.error(err); } }
    };
    field.addEventListener('click', (e) => {
      if (input.disabled) return;
      if (e.target === input) { if (!open) { openList(); input.select(); } return; }
      e.preventDefault();
      if (open) close(); else { openList(); input.focus(); input.select(); }
    });
    input.addEventListener('input', () => {
      if (!open) openList();
      typed = input.value;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) { openList(); return; }
        if (!rows.length) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive(active === -1 ? (step > 0 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length);
        return;
      }
      if (open && (e.key === 'Home' || e.key === 'End') && rows.length) { e.preventDefault(); setActive(e.key === 'Home' ? 0 : rows.length - 1); return; }
      if (e.key === 'Enter') {
        e.preventDefault(); // never the form's submit
        if (open) choose(active);
        return;
      }
      if (e.key === 'Tab' && open) choose(active);
    });
    // Focus arriving selects the name, so typing starts the search; focus leaving (a click elsewhere, a Tab out) closes the
    // list and puts the chosen name back.
    input.addEventListener('focus', () => { if (!open) input.select(); });
    input.addEventListener('blur', () => { setTimeout(() => { if (open && activeEl() !== input) close(); }, 0); });
    const api = {
      get value() { return value; },
      // set(): chooses without onChange; an id that is not in the groups is kept and shown as "Unknown kind" (empty).
      set(id) { value = id == null ? null : String(id); showChosen(); },
      // setGroups(): a new list. A chosen kind the new list no longer has stays the value, shown as unknown, and is
      // reported through onChange(value) so the module can show its fields again.
      setGroups(next) {
        groups = Array.isArray(next) ? next : [];
        if (value == null) value = first();
        showChosen();
        if (open) draw();
        if (value != null && !find(value) && typeof options.onChange === 'function') { try { options.onChange(value); } catch (err) { console.error(err); } }
      },
      // remember(id): put a kind at the front of the recent list without choosing it (a module records the kind an object
      // was saved with when the form opened on it already chosen).
      remember(id) { if (id != null && find(id)) writeRecent(String(id)); },
      get disabled() { return input.disabled; },
      set disabled(v) { input.disabled = Boolean(v); el.classList.toggle('disabled', Boolean(v)); if (v) close(); },
      focus() { try { input.focus(); } catch (err) { /* not focusable */ } },
      open: openList,
      close,
      element: el,
      input,
      destroy() { close(); el.classList.remove('sdk-kind', 'disabled'); el.replaceChildren(); },
    };
    groups = Array.isArray(options.groups) ? options.groups : [];
    // The start: `value`, or with `start: 'recent'` the kind chosen last time in this browser when there is one; else the first.
    const recent = options.start === 'recent' ? readRecent().find((id) => find(id)) : null;
    value = recent || (typeof options.value === 'string' && options.value ? options.value : first());
    showChosen();
    return api;
  }

  // env: { call(method, params) -> Promise, root, rootElement, elementAt({x, y}), localPoint(clientX, clientY),
  // applyTheme(theme) }.
  // Returns { host, emit }: `emit` is how the host pushes an event to the module.
  function createHost(env) {
  const listeners = new Map();
  let info = null;
  const call = env.call;
  ensureTooltips();
  // The one toolbar row: its view switches and toolbar buttons (host.ui.viewSwitch, host.ui.toolbarButton) in the order
  // they were made lead it, then the module's own items (host.toolbar.set), so a switch never moves when the module's
  // tools change. Any of them changing draws the row again; the same row twice is not sent.
  const switches = [];
  let ownToolbar = [];
  let toolbarSig = '';
  function drawToolbar() {
    const items = [...switches.map((s) => s.item()), ...ownToolbar];
    const sig = JSON.stringify(items);
    if (sig === toolbarSig) return Promise.resolve(true);
    toolbarSig = sig;
    return call('toolbar.set', { items });
  }
  const drawSwitches = () => { drawToolbar().catch(() => {}); };
  // A toolbar item's zone: 'start' (the left, the default) or 'end' (the right, after the search and Filters); anything else is left out.
  const zoneOf = (z) => (z === 'start' || z === 'end' ? { zone: z } : {});

  // An "open this object" from the host can arrive before the module has said what to do with one.
  let pendingOpen = null;

  // The values of an event that names keys only: ONE storage.list for the keys' common prefix, not a get for each. A key the
  // list does not hold is gone (deleted). A list that fails is asked once more; if it fails again nothing is dropped silently:
  // the person is told to reload, and null comes back (the module hears none of that event, never a part of it).
  async function readKeysOnly(changes, scope, spaceId) {
    const at = scope === 'spaces' && spaceId ? { scope, space: spaceId } : scope ? { scope } : undefined;
    const need = changes.filter((c) => !c.deleted && c.value === undefined);
    let prefix = need[0].key;
    for (const c of need) while (!c.key.startsWith(prefix)) prefix = prefix.slice(0, -1);
    let items = null;
    for (let tries = 0; tries < 2 && !items; tries += 1) {
      try { items = await call('storage.list', { prefix, ...opts(at) }); } catch (err) { items = null; }
    }
    if (!Array.isArray(items)) {
      call('ui.toast', { text: 'Some changes did not load. Reload the page to see them.' }).catch(() => {});
      return null;
    }
    const byKey = new Map(items.map((i) => [i.key, i]));
    return changes.map((c) => {
      if (c.deleted || c.value !== undefined) return c;
      const got = byKey.get(c.key);
      return got ? { ...c, value: got.value, version: got.version } : { ...c, deleted: true };
    });
  }

  function emit(event, data) {
    // The environment's facts changed (a picture map set, replaced or cleared): host.environment answers the new ones
    // before anyone listening hears it.
    if (event === 'environment' && info && data && typeof data === 'object') info.environment = { ...(info.environment || {}), pictureMap: data.pictureMap && typeof data.pictureMap === 'object' ? data.pictureMap : null };
    if (event === 'objectopen' && !(listeners.get(event) && listeners.get(event).size)) pendingOpen = data;
    // Many keys at once (a Clear, its Undo): a module listening for 'changes' hears it once, to draw once; any other
    // hears each key as its own 'change'.
    // The replay is one pass, and each 'change' of it carries `batch` ({ count, last }) so a module that draws on each one can
    // draw on the last only. An event that names keys only (a big one comes without values) has its values read first, a few
    // at a time, so a 'change' always has its value.
    if (event === 'changes' && !(listeners.get(event) && listeners.get(event).size)) {
      const { changes = [], scope, spaceId } = data || {};
      const replay = (list) => list.forEach((c, i) => emit('change', { ...c, scope, spaceId, batch: { count: list.length, last: i === list.length - 1 } }));
      if (!changes.some((c) => !c.deleted && c.value === undefined)) { replay(changes); return; }
      readKeysOnly(changes, scope, spaceId).then((full) => { if (full) replay(full); });
      return;
    }
    for (const fn of listeners.get(event) || []) {
      try {
        fn(data);
      } catch (err) {
        console.error(err);
      }
    }
  }

  // The words a person reads for each level and role, by their code names (WORD_KEYS, server/words.js's KEYS in its
  // order): each { one, many, a }, `a` the singular with its article. These are the defaults; an environment's own come
  // in host.locale().words. host.util.word applies them. `home` (the home page, the list of spaces) is the space word's
  // plural with a capital by default, "Spaces".
  const WORD_KEYS = ['host', 'environment', 'space', 'home', 'aside', 'canvas', 'module', 'object', 'admin', 'owner', 'moderator', 'member', 'guest'];
  const DEFAULT_WORDS = (() => {
    const plural = { host: 'hosts', environment: 'environments', space: 'spaces', aside: 'asides', canvas: 'canvases', module: 'modules', object: 'objects', admin: 'admins', owner: 'owners', moderator: 'moderators', member: 'members', guest: 'guests' };
    const article = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
    const out = {};
    for (const key of WORD_KEYS) {
      const one = key === 'home' ? plural.space.charAt(0).toUpperCase() + plural.space.slice(1) : key;
      const many = key === 'home' ? one : plural[key];
      out[key] = { one, many, a: article(one) };
    }
    return out;
  })();
  // How the server shows language, time and money, and the words it uses (Manage > Settings): known once hello has
  // answered, the defaults before.
  const locale = () => (info && info.locale) || { language: 'en', clock: '12', currency: 'USD', words: DEFAULT_WORDS };
  // A destination's part: the page's shared state, as the hello gave it and each 'destination' event since.
  let destinationState = null;
  const readyPromise = Promise.all([call('hello'), loadPhaseRule()]).then(([result]) => {
    info = result;
    if (result && result.destinationState && typeof result.destinationState === 'object') destinationState = result.destinationState;
    if (env.applyTheme) env.applyTheme(result.theme);
    // How the content fills the host's slot (the manifest's `content`): "flush" (edge to edge, a map) or "padded".
    if (result && env.rootElement && (result.content === 'flush' || result.content === 'padded')) env.rootElement.setAttribute('data-content', result.content);
    return result;
  });

  // Scope: 'context' (the default) is wherever the module is showing, the whole
  // environment on its page and one space on a space's canvas. On a space's canvas a module may also ask
  // for 'environment'; its environment page may read across the viewer's spaces with 'spaces', and read and write
  // one of them with { space: <id> }; 'person' is the viewer's own. A module in a space reaches only that space.
  const opts = (o) => ({ scope: (o && o.scope) || 'context', ...(o && o.space ? { space: String(o.space) } : {}) });
  // Library files (host.files.resolve, link, unlink; host.ui.fileChips). What one pointer's answer says about the file.
  function fileFacts(ref, s) {
    if (!s || s.error) return { ref, state: s && s.state === 'gone' ? 'removed' : 'hidden' };
    if (s.missing) return { ref, name: String(s.title || ''), state: 'missing' };
    return { ref, name: String(s.title || ''), group: s.group || '', type: s.type || '', size: Number(s.size) || 0, icon: s.icon || 'file', ...(s.viewable === false ? { viewable: false } : {}) };
  }
  async function resolveFiles(pointers) {
    const list = (Array.isArray(pointers) ? pointers : [pointers]).map(cleanRef).filter((r) => r && r.kind === 'file');
    if (!list.length) return [];
    const got = await host.objects.resolve(list);
    return list.map((ref, i) => fileFacts(ref, got[i]));
  }
  function fileLinks(object, pointers, op) {
    const list = (Array.isArray(pointers) ? pointers : [pointers]).map(cleanRef).filter((r) => r && r.kind === 'file');
    if (!list.length) return Promise.resolve({ links: 0 });
    return host.objects.setLinks(object, list, { kind: 'file', op });
  }
  const fileSize = (bytes) => (bytes >= 1073741824 ? `${Math.round(bytes / 107374182.4) / 10} GB` : bytes >= 1048576 ? `${Math.round(bytes / 104857.6) / 10} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  // The names modules used before the product's rename, refused with the word to use instead (no module is translated).
  const OLD_WORDS = { server: 'scope "environment"', boxWidth: '{ space }', rooms: 'scope "spaces"' };
  function refuseOld(o, what) {
    if (!o) return;
    const old = o.room !== undefined ? 'room' : OLD_WORDS[o.scope] ? o.scope : null;
    if (old) throw Object.assign(new Error(`${what}: "${old}" is an old name; use ${OLD_WORDS[old]}`), { status: 400 });
  }

  // The tooltip's script (public/tooltip.js): the page has it already (brand.js); a module in a sandboxed frame asks for it once.
  // It is found beside this file (../tooltip.js from where host.js was loaded); a frame the app serves has the SDK inline and asks the app for /tooltip.js.
  // A frame that already has it (the design-system page puts it in) asks for nothing. Without it a control still has its name (aria-label); only the label on hover is missing.
  function ensureTooltips() {
    try {
      if (window.__sdkTooltip || window.__sdkTooltipAsked || !document.head) return;
      window.__sdkTooltipAsked = true;
      const t = document.createElement('script');
      t.src = SDK_SCRIPT_SRC ? new URL('../tooltip.js', SDK_SCRIPT_SRC).href : '/tooltip.js';
      document.head.appendChild(t);
    } catch (err) {
      // no label on hover; the control keeps its name
    }
  }

  // A menu's own icons, cached per module instance the same way a module drawing its own would (see
  // assistant.js and others): a menu opened often should not re-fetch the same SVG every time.
  const menuIconSvg = new Map();
  const menuIconWait = new Map();
  function menuIcon(name, style) {
    const key = `${style || 'solid'}:${name}`;
    if (menuIconSvg.has(key)) return Promise.resolve(menuIconSvg.get(key));
    if (!menuIconWait.has(key)) menuIconWait.set(key, call('icons.svg', { name, style: style || 'solid' }).then((svg) => { menuIconSvg.set(key, svg); return svg; }).catch(() => { menuIconSvg.set(key, ''); return ''; }));
    return menuIconWait.get(key);
  }

  // The editor windows (host.ui.editor) this module has open, in the order they opened: dialog -> { reopen }.
  const openEditors = new Map();
  // The open editor window a control is in (an anchor inside it), else this module's topmost open one, else null. A
  // popover opened from inside an editor goes into that dialog, so it is in the top layer with it rather than inert
  // under it, and is placed against the window rather than the module's box.
  function editorAt(el) {
    const own = el && typeof el.closest === 'function' ? el.closest('dialog.sdk-editor[open]') : null;
    if (own) return own;
    let top = null;
    for (const d of openEditors.keys()) if (d.open) top = d;
    return top;
  }
  const editorDeps = { root: env.root, rootElement: env.rootElement, icon: (name) => menuIcon(name), opened: openEditors, editorAt, lift: env.lift, get moduleId() { return (info && info.module && info.module.id) || ''; } };

  // The module's box in the window, for the popovers (position: fixed). Where the module's root is the document's own element (a
  // sandboxed frame, a host page), the box is the window: that element's rect moves up by the scroll, while a popover does not.
  function rootBox() {
    const el = env.rootElement;
    if (el === document.documentElement) return { left: 0, top: 0, w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, w: el.clientWidth || 400, h: el.clientHeight || 400 };
  }

  // Only one host.menu is ever open at once (per module): { id, cleanup }.
  let openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    const { cleanup } = openMenu;
    openMenu = null;
    cleanup();
  }
  // A category's entries flying out beside its row (host.menu.show's `items`): the same rules as the page's own menu,
  // public/menu-flyout.js, whose block between the markers this is a copy of (tools/check-host-menu.mjs keeps it so).
  // --- menu-flyout ---
  // A category's entries fly out beside its row, or drill in (the same menu shows them, Back first) on a phone or a narrow
  // window (640px and below). In a module's frame the frame's own width is the module's, not the window's: there it drills
  // in only on a touch screen, or when the module has no room for the menu and its flyout side by side.
  const MENU_NARROW = 640;
  function submenuStyle({ width = 0, framed = false, touch = false, boxWidth = Infinity, need = 0 } = {}) {
    if (width > MENU_NARROW) return 'flyout';
    if (!framed) return 'drill';
    return touch || boxWidth < need ? 'drill' : 'flyout';
  }

  // Where a flyout goes: beside its menu (`row`: the menu's left and right, the row's top), to the right when it fits, else
  // to the left, else on the side with more room and shifted to stay inside `view` ({ w, h }). Its first entry is level
  // with its row (both menus have 4px of padding). Answers { x, y, side }.
  function flyoutPlace({ row, size, view, gap = 2, margin = 4 }) {
    const fitsRight = row.right + gap + size.w <= view.w - margin;
    const fitsLeft = row.left - gap - size.w >= margin;
    const side = fitsRight ? 'right' : fitsLeft ? 'left' : view.w - row.right >= row.left ? 'right' : 'left';
    let x = side === 'right' ? row.right + gap : row.left - gap - size.w;
    x = Math.max(margin, Math.min(x, view.w - size.w - margin));
    const y = Math.max(margin, Math.min(row.top - 4, view.h - size.h - margin));
    return { x, y, side };
  }

  // Whether the pointer at `p` is on its way from `from` (where it left the category's row) to the open flyout (`rect`, on
  // `side` of the menu): inside the triangle from that point to the flyout's near edge. A row crossed on the way does not
  // close the flyout then.
  function inSafeZone(p, from, rect, side) {
    if (!p || !from || !rect) return false;
    const edge = side === 'left' ? rect.right : rect.left;
    const b = { x: edge, y: rect.top };
    const c = { x: edge, y: rect.bottom };
    const s = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    const d1 = s(p, from, b);
    const d2 = s(p, b, c);
    const d3 = s(p, c, from);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  // The row the arrow keys go to among `count` rows from `at` (-1: none has the keyboard): 1 or -1, around the ends, or
  // 'first' and 'last' (Home, End).
  function menuStep(count, at, step) {
    if (!count) return -1;
    if (step === 'first') return 0;
    if (step === 'last') return count - 1;
    if (at < 0) return step < 0 ? count - 1 : 0;
    return (at + step + count) % count;
  }

  // What a key does in a menu with categories: 'next', 'prev', 'first', 'last' (move), 'open' (a category's entries),
  // 'back' (close the flyout, or leave a drilled-in category, the keyboard back on its row), 'close' (the whole menu), or
  // null (the key is not the menu's: Enter and Space press the row itself).
  function menuKeyAction(key, { inFlyout = false, onCategory = false, drilled = false } = {}) {
    if (key === 'ArrowDown') return 'next';
    if (key === 'ArrowUp') return 'prev';
    if (key === 'Home') return 'first';
    if (key === 'End') return 'last';
    if (key === 'ArrowRight') return onCategory && !inFlyout ? 'open' : null;
    if (key === 'ArrowLeft') return inFlyout || drilled ? 'back' : null;
    if (key === 'Escape') return inFlyout ? 'back' : 'close';
    if (key === 'Tab') return 'close';
    return null;
  }
  // --- end menu-flyout ---

  // A menu row's accessible name when it is not its label: `ariaLabel`, else a `tip` that holds the label (its full
  // wording, "Add a flight" for "Flight"), so what is heard still has the word on screen. Null: the row's own words.
  function menuItemName(item) {
    const label = String(item.label || '').trim();
    if (item.ariaLabel) return String(item.ariaLabel);
    const tip = String(item.tip || '').trim();
    return tip && label && tip !== label && tip.toLowerCase().includes(label.toLowerCase()) ? tip : null;
  }

  function showMenu({ id, items, at, anchor, className, maxWidth, onClose } = {}) {
    const reopening = openMenu && openMenu.id === id;
    closeMenu();
    if (reopening) return { close: closeMenu }; // the same trigger clicked again: toggle off, do not reopen
    const list = (items || []).filter(Boolean);
    if (!list.length) return { close: closeMenu };
    const menu = document.createElement('div');
    menu.className = `sdk-menu${className ? ` ${className}` : ''}`;
    menu.setAttribute('role', 'menu');
    if (maxWidth) menu.style.maxWidth = `${maxWidth}px`;
    let rows = [];
    let sub = null; // { items, back, label } while a category is drilled into
    let fly = null; // { el, rows, row, side, exit } while a category's flyout is open
    let hoverTimer = 0;
    const entriesOf = (item) => { const e = item && (item.items || item.submenu); const l = typeof e === 'function' ? e() : e; return Array.isArray(l) ? l.filter(Boolean) : null; };
    const isCategory = (item) => Boolean(item && !item.disabled && (item.items || item.submenu));
    // Inside an open editor window (host.ui.editor) the menu goes into the dialog and is clamped to the window.
    const editor = editorAt(anchor);
    const container = editor || (env.root === document ? document.body : env.root);
    // The box the menu and its flyout stay in: the module's own root, or the window inside an editor.
    const bounds = () => {
      const modBox = rootBox();
      return {
        modBox,
        box: editor ? { left: 0, top: 0 } : modBox,
        w: editor ? window.innerWidth : modBox.w,
        h: editor ? window.innerHeight : modBox.h,
      };
    };
    let framed = false;
    try { framed = window.parent !== window && env.root === document; } catch (err) { framed = true; }
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches;
    const drills = () => submenuStyle({ width: window.innerWidth, framed, touch, boxWidth: bounds().w, need: menu.offsetWidth + 180 }) === 'drill';
    // A module box of a phone's width gets the 44px rows, whatever the window is.
    const narrow = bounds().w <= 640;
    if (narrow) menu.classList.add('narrow');

    const closeFly = ({ refocus = false } = {}) => {
      clearTimeout(hoverTimer);
      if (!fly) return;
      const { el, row } = fly;
      fly = null;
      el.remove();
      row.setAttribute('aria-expanded', 'false');
      row.classList.remove('open');
      if (refocus) row.focus();
    };
    const openFly = (item, row, { focus = false } = {}) => {
      clearTimeout(hoverTimer);
      if (fly && fly.row === row) { if (focus && fly.rows[0]) fly.rows[0].focus(); return; }
      closeFly();
      const entries = entriesOf(item);
      if (!entries || !entries.length) return;
      const el = document.createElement('div');
      el.className = `sdk-menu sdk-menu-flyout${narrow ? ' narrow' : ''}${className ? ` ${className}` : ''}`;
      el.setAttribute('role', 'menu');
      el.setAttribute('aria-label', item.label || '');
      const flyRows = [];
      for (const entry of entries) addEntry(el, entry, flyRows, true);
      container.appendChild(el);
      const { box, w, h } = bounds();
      const m = menu.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const spot = flyoutPlace({ row: { left: m.left - box.left, right: m.right - box.left, top: r.top - box.top }, size: { w: el.offsetWidth, h: el.offsetHeight }, view: { w, h } });
      el.style.left = `${box.left + spot.x}px`;
      el.style.top = `${box.top + spot.y}px`;
      el.dataset.side = spot.side;
      el.addEventListener('pointerenter', () => clearTimeout(hoverTimer));
      row.setAttribute('aria-expanded', 'true');
      row.classList.add('open');
      fly = { el, rows: flyRows, row, side: spot.side, exit: null };
      if (focus && flyRows[0]) flyRows[0].focus();
    };
    const hover = (item, b, e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return; // a touch opens on the tap
      if (sub || drills()) return;
      clearTimeout(hoverTimer);
      if (fly && fly.row === b) return;
      const onWay = fly && inSafeZone({ x: e.clientX, y: e.clientY }, fly.exit, fly.el.getBoundingClientRect(), fly.side);
      hoverTimer = setTimeout(() => {
        if (!openMenu || openMenu.menu !== menu) return;
        if (isCategory(item)) openFly(item, b); else closeFly();
      }, onWay ? 320 : 120);
    };

    function addEntry(into, item, rowList, inFlyout) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'sdk-menu-sep';
        sep.setAttribute('role', 'separator');
        into.appendChild(sep);
        return;
      }
      if (item.heading) {
        const hd = document.createElement('div');
        hd.className = 'sdk-menu-heading';
        hd.setAttribute('role', 'presentation');
        hd.textContent = item.heading;
        into.appendChild(hd);
        return;
      }
      const category = !inFlyout && isCategory(item);
      // A real link (item.href) is an <a>, not a button: a menu item that just goes somewhere keeps the
      // browser's own affordances (hover preview, middle-click a new tab, copy link address) rather than
      // faking navigation from a click handler.
      const b = item.href && !category ? document.createElement('a') : document.createElement('button');
      b.className = `sdk-menu-item${item.danger ? ' danger' : ''}${category ? ' sdk-menu-category' : ''}`;
      b.setAttribute('role', 'menuitem');
      if (item.current) b.setAttribute('aria-current', 'true');
      if (category) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); }
      if (item.href && !category) {
        b.href = item.href;
        b.target = item.target || '_blank';
        b.rel = 'noopener';
      } else {
        b.type = 'button';
      }
      if (item.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      if (item.icon) {
        const ic = document.createElement('span');
        ic.className = 'sdk-menu-icon';
        if (item.iconColor) ic.style.color = item.iconColor;
        b.appendChild(ic);
        menuIcon(item.icon, item.regular ? 'regular' : 'solid').then((svg) => { if (svg) ic.innerHTML = svg; });
      }
      const label = document.createElement('span');
      label.className = 'sdk-menu-label';
      label.textContent = item.label;
      b.appendChild(label);
      // `tip`: the tooltip; and the accessible name when it is the label's full wording ("Flight" heard as "Add a
      // flight"), or `ariaLabel` when given. The same rule as the page's menu (host-menu.js).
      if (item.tip) b.title = item.tip;
      const spoken = menuItemName(item);
      if (spoken) b.setAttribute('aria-label', spoken);
      if (category) {
        const caret = document.createElement('span');
        caret.className = 'sdk-menu-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M5.3 1.9 11.4 8l-6.1 6.1-1.4-1.4L8.6 8 3.9 3.3z"/></svg>';
        b.appendChild(caret);
      }
      if (item.hint) {
        const hn = document.createElement('div');
        hn.className = 'sdk-menu-hint';
        hn.textContent = item.hint;
        b.appendChild(hn);
      }
      if (category) {
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // A phone or a module with no room beside the menu drills in; else the flyout, the keyboard in it when a key
          // pressed the row.
          if (drills()) { sub = { items: entriesOf(item) || [], back: rows.indexOf(b), label: item.label }; draw(1); return; }
          openFly(item, b, { focus: e.detail === 0 });
        });
      } else if (!item.disabled && (item.onClick || item.href)) {
        b.addEventListener('click', async () => {
          let result;
          if (item.onClick) {
            try {
              result = await item.onClick(item, b);
            } catch (err) {
              console.error(err);
            }
          }
          if (result !== false) closeMenu(); // exactly `false` means the item armed itself and changed its own row; anything else closes (a plain href item just closes, letting the click through to the link)
        });
      }
      if (!inFlyout) {
        b.addEventListener('pointerenter', (e) => hover(item, b, e));
        if (category) b.addEventListener('pointerleave', (e) => { if (fly && fly.row === b) fly.exit = { x: e.clientX, y: e.clientY }; });
      }
      into.appendChild(b);
      if (!item.disabled) rowList.push(b);
    }

    // The menu's entries: the list, or a drilled-in category's with Back and its name first. `focus`: the row (by its
    // place among the rows) to put the keyboard on.
    function draw(focus) {
      closeFly();
      menu.replaceChildren();
      rows = [];
      const current = sub
        ? [{ label: 'Back', icon: 'arrow-left', back: true }, { heading: sub.label }, ...sub.items]
        : list;
      for (const item of current) {
        if (item.back) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-menu-item sdk-menu-back';
          b.setAttribute('role', 'menuitem');
          const ic = document.createElement('span');
          ic.className = 'sdk-menu-icon';
          b.appendChild(ic);
          menuIcon('arrow-left').then((svg) => { if (svg) ic.innerHTML = svg; });
          const label = document.createElement('span');
          label.className = 'sdk-menu-label';
          label.textContent = 'Back';
          b.appendChild(label);
          b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const at = sub.back; sub = null; draw(at); });
          menu.appendChild(b);
          rows.push(b);
          continue;
        }
        addEntry(menu, item, rows, false);
      }
      placeMenu();
      const target = rows[Math.max(0, Math.min(rows.length - 1, focus || 0))];
      if (target) target.focus();
    }

    // Positioned like host.actions.pick's own menu and the date picker's popover: clamped inside the
    // module's own root, by a point (a drop's own coordinates) or under an element (a "..." button),
    // flipped above it when there is no room below.
    function placeMenu() {
      const { modBox, box, w, h } = bounds();
      let x = ((at && at.x) || 0) + (editor ? modBox.left : 0);
      let y = ((at && at.y) || 0) + (editor ? modBox.top : 0);
      if (anchor && anchor.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        x = r.left - box.left;
        y = r.bottom - box.top + 4;
        if (y + menu.offsetHeight > h) y = r.top - box.top - menu.offsetHeight - 4;
      }
      x = Math.max(4, Math.min(x, w - menu.offsetWidth - 4));
      y = Math.max(4, Math.min(y, h - menu.offsetHeight - 4));
      menu.style.left = `${box.left + x}px`;
      menu.style.top = `${box.top + y}px`;
    }

    container.appendChild(menu);
    draw(-1);
    // Keys: Up, Down, Home and End move in the menu or its flyout; Right (or Enter) opens a category, Left or Escape
    // closes just its flyout (or leaves a drilled-in category); Escape closes only the menu: stopped and prevented, so
    // an editor window around it does not close too.
    const active = () => (env.root && env.root.activeElement) || document.activeElement;
    const onKey = (e) => {
      const now = active();
      const inFlyout = Boolean(fly && fly.el.contains(now));
      const onCategory = Boolean(now && rows.includes(now) && now.classList.contains('sdk-menu-category'));
      const action = menuKeyAction(e.key, { inFlyout, onCategory, drilled: Boolean(sub) });
      if (!action) return;
      if (action === 'close') {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } else closeMenu();
        return;
      }
      if (!now || !(menu.contains(now) || inFlyout)) return; // the keyboard is not in the menu: the keys are not its
      e.preventDefault();
      e.stopPropagation();
      if (action === 'open') { now.click(); return; }
      if (action === 'back') {
        if (inFlyout) closeFly({ refocus: true });
        else if (sub) { const back = sub.back; sub = null; draw(back); }
        return;
      }
      const set = inFlyout ? fly.rows : rows;
      const next = menuStep(set.length, set.indexOf(now), action === 'next' ? 1 : action === 'prev' ? -1 : action);
      if (set[next]) set[next].focus();
    };
    let outside = false; // closed by a press elsewhere: the person put the focus there
    const onOutside = (e) => { if (!menu.contains(e.target) && !(fly && fly.el.contains(e.target)) && e.target !== anchor) { outside = true; closeMenu(); } };
    document.addEventListener('keydown', onKey, true);
    env.root.addEventListener('pointerdown', onOutside, true);
    openMenu = {
      id,
      menu,
      cleanup: () => {
        closeFly();
        menu.remove();
        document.removeEventListener('keydown', onKey, true);
        env.root.removeEventListener('pointerdown', onOutside, true);
        if (anchor && anchor.focus) { try { anchor.focus(); } catch (err) { /* not focusable */ } }
        else if (!outside && framed) { const now = document.activeElement; if (!now || now === document.body) Promise.resolve(call('focus.opener', {})).catch(() => {}); } // no anchor: the host control that opened it
        if (typeof onClose === 'function') { const done = onClose; onClose = null; try { done(); } catch (err) { console.error(err); } } // once, whatever closed it
      },
    };
    return { close: closeMenu };
  }

  // ---- The colour picker (host.ui.colorPicker and host.ui.colorField; plan-colour-picker.md, step 2) ----
  // Drawn by the SDK in the module's own page, like host.menu.show, and one of the same "one open at a time": opening it closes any
  // menu, a menu closes it, and the same call again while it is open closes it (a toggle). Placed under `anchor` (flipped above when
  // there is no room below) or at the point `at`, clamped inside the module's box, and scrolling inside itself when the box is short.
  // The pure parts (cleaning, hue and back, the palette and its check, the answer, contrast) are the block between colour:start and
  // colour:end above. The colours in the area, the sliders and the swatches are data, set as custom properties (--sw, --cp-*); the
  // picker itself is theme tokens only (the Pickers block of system.css, colourpicker part).
  const COLOUR_ICONS = {
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.4 7.8l1.4-1.4 2.4 2.4 6-6 1.4 1.4z"/></svg>',
    dropper: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 1.3a2 2 0 0 0-2.8 0L8.9 3l-.7-.7-1.4 1.4.7.7-5.2 5.2a1 1 0 0 0-.3.7V13h2.7a1 1 0 0 0 .7-.3l5.2-5.2.7.7 1.4-1.4-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM4.3 11.5h-.8v-.8l5.1-5.1.8.8z"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.3 5.3 8 11l5.7-5.7-1.4-1.4L8 8.2 3.7 3.9z"/></svg>',
    plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7 2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>',
  };
  // The ends of the area (no colour at the top right is "white", the bottom is "black") and the hue track's stops, worked out from the
  // colour maths, so no colour is written in a stylesheet or a style string.
  const COLOUR_WHITE = colourFromHsv({ h: 0, s: 0, v: 100 });
  const COLOUR_BLACK = colourFromHsv({ h: 0, s: 0, v: 0 });
  const COLOUR_AREA = `linear-gradient(to top, ${COLOUR_BLACK}, transparent), linear-gradient(to right, ${COLOUR_WHITE}, transparent)`;
  const COLOUR_HUES = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => colourFromHsv({ h: h % 360, s: 100, v: 100 })).join(', ')})`;
  const COLOUR_HEX_HINT = 'Type six hex digits, like #2f6cbf'; // the hex field's error line
  let colourSeq = 0;
  // The person's colour grid as the page last answered it ({ colors: [...] | null, editable }), so the next picker draws it at once and
  // only redraws when the page's answer differs. Asked through the page each time a picker opens (ui.colorGrid): the SDK never fetches
  // the route itself, since a sandboxed frame has no session.
  let colourGridSeen = null;
  const colourGridAsk = () => Promise.resolve()
    .then(() => call('ui.colorGrid', {}))
    .then((a) => {
      const colors = a && a.colors === null ? null : colourGridClean(a && a.colors);
      colourGridSeen = a && (a.colors === null || colors) ? { colors, editable: a.editable === true } : { colors: null, editable: false };
      return colourGridSeen;
    }, () => (colourGridSeen = { colors: null, editable: false }));
  // The person's Recent colours likewise (decision 27): asked through the page each time a picker opens (ui.colorRecent), kept as last
  // answered so the next picker draws them at once, and sent whole after a choice (ui.colorRecent.set). Where they can't be kept
  // (not editable) nothing is sent: no session, a guest or an agent has none to show; a module in a sandboxed frame shows the person's
  // Recent read-only (decision 28). The sends go one after another, each from the page's list as it is then.
  let colourRecentSeen = null;
  const colourRecentAsk = () => Promise.resolve()
    .then(() => call('ui.colorRecent', {}))
    .then((a) => {
      const colors = a && a.colors === null ? null : colourRecentClean(a && a.colors);
      colourRecentSeen = a && (a.colors === null || colors) ? { colors, editable: a.editable === true } : { colors: null, editable: false };
      return colourRecentSeen;
    }, () => (colourRecentSeen = { colors: null, editable: false }));
  let colourRecentSaving = Promise.resolve();
  const colourRecentKeep = (entry) => {
    colourRecentSaving = colourRecentSaving
      .then(() => colourRecentAsk()) // the page's copy, which another module on the page may have changed
      .then((now) => {
        if (!now.editable) return null;
        const next = colourRecentAdd(now.colors, entry);
        colourRecentSeen = { colors: next, editable: true };
        return call('ui.colorRecent.set', { colors: next }).then((answer) => {
          const k = colourRecentClean(Array.isArray(answer) ? answer : answer && answer.colors);
          if (k) colourRecentSeen = { colors: k, editable: true };
        });
      })
      .catch(() => { colourRecentSeen = null; }); // not kept: the next picker asks the page again
  };
  let colourLastOutside = null; // { at, time }: a module in the page whose picker (opened at a point) a press on its own toolbar or title bar closed
  // The browser's eyedropper: offered where it exists; the first time it refuses (a frame it may not work in), it is hidden from then on.
  let colourDropper = typeof window.EyeDropper === 'function';
  // Any CSS colour the page computed (the menu's surface: rgb(), color(srgb ...)) as #rrggbb, through a 1px canvas; null if it cannot.
  function colourOfCss(css) {
    try {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g || !css) return null;
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      if (d[3] < 128) return null;
      return colourClean([d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''));
    } catch (err) {
      return null;
    }
  }

  function showColourPicker(o) {
    const opt = o && typeof o === 'object' ? o : {};
    const anchor = opt.anchor && opt.anchor.nodeType === 1 && typeof opt.anchor.getBoundingClientRect === 'function' ? opt.anchor : null;
    const at = opt.at && typeof opt.at === 'object' && Number.isFinite(opt.at.x) && Number.isFinite(opt.at.y) ? { x: opt.at.x, y: opt.at.y } : null;
    if (!anchor && !at) throw new Error('host.ui.colorPicker needs an anchor or a point');
    // No palette: the person's own grid (decisions 22 to 26). A module's palette: its groups, in place of the grid and not editable.
    const own = opt.palette === undefined;
    const palette = own ? null : colourPaletteCheck(opt.palette);
    const keeps = opt.opacity !== false;
    const label = typeof opt.label === 'string' && opt.label.trim() ? opt.label.trim().slice(0, 80) : 'Colour';
    const onInput = typeof opt.onInput === 'function' ? opt.onInput : null;
    // The same call again while it is open closes it (null): the same anchor element, or the same point (a toolbar button pressed
    // twice gives the same x). A picker at another point (another toolbar button) closes the first and opens.
    const same = openMenu && openMenu.id === 'sdk-colour' ? openMenu : null;
    const reopening = Boolean(same && (anchor ? same.anchor === anchor : !same.anchor && same.at && same.at.x === at.x && same.at.y === at.y));
    // A module in the page: a press on its own toolbar or title bar (the host's, outside the module's root) closed a picker opened at
    // this same point just before this call; that press was the toolbar button's toggle, so it does not open again. Only for a point:
    // a host button is never an anchor.
    const last = colourLastOutside;
    colourLastOutside = null;
    const justClosed = Boolean(!same && !anchor && last && Date.now() - last.time < 600 && last.at && last.at.x === at.x && last.at.y === at.y);
    closeMenu();
    if (reopening || justClosed) return Promise.resolve(null);

    return new Promise((resolve) => {
      const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
      const editor = editorAt(anchor);
      const container = editor || (env.root === document ? document.body : env.root);
      const bounds = () => {
        const modBox = rootBox();
        return {
          modBox,
          box: editor ? { left: 0, top: 0 } : modBox,
          w: editor ? window.innerWidth : modBox.w,
          h: editor ? window.innerHeight : modBox.h,
        };
      };
      // What had the focus before the picker took it: in a module in the page the element inside its shadow root, not the root's host.
      const opener = (env.root !== document && env.root.activeElement) || document.activeElement;
      const uid = `sdk-cp-${++colourSeq}`;
      const names = new Map();
      for (const g of own ? [{ colours: COLOUR_GRID_START }] : palette) for (const c of g.colours) if (!names.has(c.color)) names.set(c.color, c.name);
      // The grid as last seen (the starting colours, not editable, until the page answers).
      let grid = own ? { ...(colourGridSeen || { colors: null, editable: false }) } : null;
      const gridList = () => (grid.colors || COLOUR_GRID_START.map((c) => ({ color: c.color, opacity: c.opacity })));
      const editable = () => Boolean(own && grid.editable);
      // The person's Recent colours as last seen (none until the page answers); recent: false leaves them out.
      const showsRecent = opt.recent !== false;
      let recentList = showsRecent && colourRecentSeen ? colourRecentSeen.colors || [] : [];

      const startHex = colourClean(opt.value) || (own ? (colourGridOrder(gridList())[0] || COLOUR_GRID_START[0]).color : palette[0].colours[0].color);
      let hsv = colourToHsv(startHex);
      let hex = startHex;
      let alpha = keeps ? colourOpacity(opt.opacity === undefined ? 100 : opt.opacity) : 100;
      let result = null;
      let outside = false;
      let dropping = false;
      let mine = null; // this picker's own entry as the open menu (openMenu), once it is open
      let sent = `${hex}/${alpha}`;
      let touched = false; // the person changed the colour or the opacity since it opened

      const pop = make('div', 'sdk-popover sdk-popover-dense sdk-picker-pop sdk-cp');
      pop.id = uid;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', label);
      pop.tabIndex = -1; // a press on a part that takes no focus (a heading, the gaps) leaves the focus in the picker, not on the page
      pop.style.setProperty('--cp-area', COLOUR_AREA);
      pop.style.setProperty('--cp-hue-track', COLOUR_HUES);

      // The area: saturation across, brightness up. One slider for the keyboard.
      const area = make('div', 'sdk-cp-area');
      area.tabIndex = 0;
      area.setAttribute('role', 'slider');
      area.setAttribute('aria-label', 'Saturation and brightness');
      area.setAttribute('aria-valuemin', '0');
      area.setAttribute('aria-valuemax', '100');
      area.appendChild(make('span', 'sdk-cp-handle'));
      const slider = (cls, name, max) => {
        const s = make('div', `sdk-cp-slider ${cls}`);
        s.tabIndex = 0;
        s.setAttribute('role', 'slider');
        s.setAttribute('aria-label', name);
        s.setAttribute('aria-valuemin', '0');
        s.setAttribute('aria-valuemax', String(max));
        s.setAttribute('aria-orientation', 'horizontal');
        s.append(make('span', 'sdk-cp-track'), make('span', 'sdk-cp-thumb'));
        return s;
      };
      const hue = slider('sdk-cp-hue', 'Hue', 359);
      // Opacity only where it is kept: where it is not, there is no slider at all (what cannot be set is not shown).
      const opac = keeps ? slider('sdk-cp-alpha', 'Opacity', 100) : null;
      pop.append(area, hue);
      if (opac) pop.appendChild(opac);
      else pop.classList.add('sdk-cp-solid');

      // The row: the colour as it is, the hex, and the eyedropper.
      const row = make('div', 'sdk-cp-row');
      const current = make('span', 'sdk-cp-current');
      current.setAttribute('aria-hidden', 'true');
      const hexLabel = make('label', 'sdk-cp-hex');
      const hexWord = make('span', 'sdk-cp-hex-word', 'Hex');
      const hexIn = make('input', 'sdk-cp-hexin');
      hexIn.type = 'text';
      hexIn.autocomplete = 'off';
      hexIn.spellcheck = false;
      hexIn.maxLength = 9;
      hexIn.setAttribute('autocapitalize', 'off');
      hexLabel.append(hexWord, hexIn);
      const dropper = make('button', 'sdk-icon-btn btn-small btn-quiet sdk-cp-dropper');
      dropper.type = 'button';
      dropper.setAttribute('aria-label', 'Pick from the screen');
      dropper.dataset.tip = 'Pick from the screen';
      dropper.innerHTML = COLOUR_ICONS.dropper;
      dropper.hidden = !colourDropper;
      row.append(current, hexLabel, dropper);
      const error = make('p', 'sdk-error sdk-cp-error');
      error.id = `${uid}-error`;
      error.setAttribute('aria-live', 'polite');
      pop.append(row, error);

      // The swatches, each group one radio group (one Tab stop, the arrows inside). The person's grid: one group with no headings, sorted
      // by colour, a "+" at its end where it can be edited (the next Tab stop). A module's palette: its groups under their headings.
      // Then Recent. A grid swatch carries its opacity (data-opacity); one below 100 is drawn half over the checked ground.
      const groups = [];
      const swatchCell = (c) => {
        const b = make('button', 'sdk-swatch');
        b.type = 'button';
        b.tabIndex = -1;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', 'false');
        const said = c.label || c.name || c.color;
        b.setAttribute('aria-label', said);
        b.dataset.tip = c.name ? `${c.name}, ${c.color}` : said;
        b.dataset.color = c.color;
        if (c.opacity !== undefined) {
          b.dataset.opacity = String(c.opacity);
          if (c.opacity < 100) { b.classList.add('sdk-cp-see'); b.style.setProperty('--cp-sw-alpha', `${c.opacity}%`); }
        }
        b.style.setProperty('--sw', c.color);
        b.innerHTML = `<i aria-hidden="true">${COLOUR_ICONS.check}</i>`;
        return b;
      };
      const swatchGroup = (name, headings) => {
        const g = make('div', 'sdk-cp-swatches');
        g.setAttribute('role', 'radiogroup');
        g.setAttribute('aria-label', name);
        for (const { heading, colours } of headings) {
          if (heading) { const hd = make('div', 'sdk-cp-head', heading); hd.setAttribute('aria-hidden', 'true'); g.appendChild(hd); }
          const cells = make('div', 'sdk-swatch-grid');
          cells.setAttribute('role', 'presentation');
          for (const c of colours) cells.appendChild(swatchCell(c));
          g.appendChild(cells);
        }
        groups.push(g);
        return g;
      };
      const gridGroup = swatchGroup('Colours', own ? [] : palette.map((p) => ({ heading: p.heading, colours: p.colours })));
      pop.appendChild(gridGroup);
      // "+": adds the colour showing, with its opacity, to the grid (decision 23); not shown at 48 or where the grid can't be edited.
      const plus = own ? make('button', 'sdk-cp-add') : null;
      if (plus) {
        plus.type = 'button';
        plus.setAttribute('aria-label', 'Add this colour');
        plus.dataset.tip = 'Add this colour';
        plus.innerHTML = COLOUR_ICONS.plus;
      }
      // The line under the grid: a save the server refused, in its own words.
      const gridError = own ? make('p', 'sdk-error sdk-cp-error sdk-cp-grid-error') : null;
      if (gridError) { gridError.setAttribute('aria-live', 'polite'); pop.appendChild(gridError); }
      const drawGrid = () => {
        const cells = make('div', 'sdk-swatch-grid');
        cells.setAttribute('role', 'presentation');
        for (const e of colourGridOrder(gridList())) cells.appendChild(swatchCell({ color: e.color, opacity: e.opacity, name: colourGridName(e), label: colourGridLabel(e) }));
        if (editable() && gridList().length < COLOUR_GRID_MAX) cells.appendChild(plus);
        gridGroup.replaceChildren(cells);
        current.draggable = editable();
      };
      if (own) drawGrid();
      // Recent: one group, drawn again when the page's answer differs; hidden while it is empty. Each colour carries its opacity, named
      // by its name in what this picker shows (at 100), else by its hex, with the percent below 100.
      const recentGroup = showsRecent ? swatchGroup('Recent', []) : null;
      const drawRecent = () => {
        if (!recentGroup) return;
        const cells = make('div', 'sdk-swatch-grid');
        cells.setAttribute('role', 'presentation');
        for (const e of recentList) {
          const name = e.opacity === 100 ? names.get(e.color) || '' : '';
          cells.appendChild(swatchCell({ color: e.color, opacity: e.opacity, name, label: name || (e.opacity < 100 ? `${e.color}, ${e.opacity} percent` : e.color) }));
        }
        const hd = make('div', 'sdk-cp-head', 'Recent');
        hd.setAttribute('aria-hidden', 'true');
        recentGroup.replaceChildren(...(recentList.length ? [hd, cells] : []));
        recentGroup.hidden = !recentList.length;
      };
      if (recentGroup) { drawRecent(); pop.appendChild(recentGroup); }
      // What a screen reader hears once the colour settles: "Teal, #00796b" or "#2f6cbf".
      const live = make('div', 'sdk-cp-live');
      live.setAttribute('aria-live', 'polite');
      pop.appendChild(live);
      const swatches = () => [...pop.querySelectorAll('.sdk-swatch')];

      const say = () => `${names.has(hex) ? `${names.get(hex)}, ` : ''}${hex}`;
      let sayTimer = 0;
      const announce = (now) => { clearTimeout(sayTimer); const go = () => { live.textContent = say(); }; if (now) go(); else sayTimer = setTimeout(go, 700); };
      const tell = (text) => { clearTimeout(sayTimer); live.textContent = text; }; // an add or a remove in the grid, said at once
      const markBad = (bad) => {
        if (bad) { hexIn.setAttribute('aria-invalid', 'true'); hexIn.setAttribute('aria-describedby', error.id); error.textContent = COLOUR_HEX_HINT; } else { hexIn.removeAttribute('aria-invalid'); hexIn.removeAttribute('aria-describedby'); error.textContent = ''; }
      };
      const round = (n) => Math.round(n);
      const paint = (from) => {
        hex = colourFromHsv(hsv);
        pop.style.setProperty('--cp-hue', colourFromHsv({ h: hsv.h, s: 100, v: 100 }));
        pop.style.setProperty('--cp-color', hex);
        pop.style.setProperty('--cp-alpha', `${alpha}%`);
        pop.style.setProperty('--cp-x', String(hsv.s / 100));
        pop.style.setProperty('--cp-y', String(1 - hsv.v / 100));
        hue.style.setProperty('--cp-at', String(Math.min(hsv.h, 359) / 359));
        area.setAttribute('aria-valuenow', String(round(hsv.s)));
        area.setAttribute('aria-valuetext', `Saturation ${round(hsv.s)} percent, brightness ${round(hsv.v)} percent`);
        const h = Math.min(359, round(hsv.h));
        hue.setAttribute('aria-valuenow', String(h));
        hue.setAttribute('aria-valuetext', `Hue ${h} degrees`);
        if (opac) {
          opac.style.setProperty('--cp-at', String(alpha / 100));
          opac.setAttribute('aria-valuenow', String(alpha));
          opac.setAttribute('aria-valuetext', `Opacity ${alpha} percent`);
        }
        if (from !== 'hex') { hexIn.value = hex; markBad(false); }
        for (const g of groups) {
          const cells = [...g.querySelectorAll('.sdk-swatch')];
          let stop = null;
          // The chosen one: a grid swatch of this colour at this opacity, else the first of this colour (a palette or Recent swatch has
          // no opacity of its own).
          const exact = cells.find((b) => b.dataset.color === hex && b.dataset.opacity !== undefined && Number(b.dataset.opacity) === alpha);
          const chosen = exact || cells.find((b) => b.dataset.color === hex) || null;
          for (const b of cells) { const on = b === chosen; b.setAttribute('aria-checked', String(on)); if (on && !stop) stop = b; }
          const focused = cells.find((b) => b.tabIndex === 0 && b === ((env.root && env.root.activeElement) || document.activeElement));
          stop = focused || stop || cells[0];
          for (const b of cells) b.tabIndex = b === stop ? 0 : -1;
        }
      };
      const answer = () => colourAnswer(hex, alpha, keeps);
      const changed = (from) => {
        paint(from);
        const key = `${hex}/${alpha}`;
        if (key === sent) return;
        sent = key;
        touched = true;
        if (onInput) { try { onInput(answer()); } catch (err) { console.error(err); } }
      };
      // A colour from a hex, a swatch or the eyedropper. A grey keeps the hue where it was, black keeps the saturation too, so the
      // hue slider and the handle do not jump.
      const setHex = (c, from) => {
        const n = colourToHsv(c);
        if (n.v === 0) { n.h = hsv.h; n.s = hsv.s; } else if (n.s === 0) n.h = hsv.h;
        hsv = n;
        changed(from);
      };
      const finish = (keep) => { if (!openMenu || openMenu.menu !== pop) return; result = keep ? answer() : null; closeMenu(); };

      // Dragging: the area, Hue and Opacity follow the pointer (touch-action: none on them only, so the page does not scroll).
      const clamp = (n) => Math.max(0, Math.min(1, n));
      const drag = (el, move) => {
        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          el.focus({ preventScroll: true });
          try { el.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is gone */ }
          move(e);
        });
        el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) move(e); });
        el.addEventListener('lostpointercapture', () => announce(true));
      };
      drag(area, (e) => {
        const r = area.getBoundingClientRect();
        hsv = { h: hsv.h, s: clamp((e.clientX - r.left) / (r.width || 1)) * 100, v: (1 - clamp((e.clientY - r.top) / (r.height || 1))) * 100 };
        changed();
      });
      const along = (el, e) => {
        const r = el.getBoundingClientRect();
        const t = el.querySelector('.sdk-cp-thumb');
        const tw = (t && t.offsetWidth) || 0;
        return clamp((e.clientX - r.left - tw / 2) / Math.max(1, r.width - tw));
      };
      drag(hue, (e) => { hsv = { ...hsv, h: Math.min(359, along(hue, e) * 359) }; changed(); });
      if (opac) drag(opac, (e) => { alpha = round(along(opac, e) * 100); changed(); });

      // The keys of "Keyboard and screen reader": arrows by 1, Shift by 10; on the sliders Page Up and Page Down by 10, Home and End to
      // the ends; on the area Left and Right are saturation, Up and Down brightness, Home and End the ends of saturation.
      const by = (e) => (e.shiftKey ? 10 : 1);
      const lim = (n, max) => Math.max(0, Math.min(max, n));
      area.addEventListener('keydown', (e) => {
        let { s, v } = hsv;
        if (e.key === 'ArrowLeft') s = round(s) - by(e);
        else if (e.key === 'ArrowRight') s = round(s) + by(e);
        else if (e.key === 'ArrowUp') v = round(v) + by(e);
        else if (e.key === 'ArrowDown') v = round(v) - by(e);
        else if (e.key === 'Home') s = 0;
        else if (e.key === 'End') s = 100;
        else return;
        e.preventDefault();
        hsv = { h: hsv.h, s: lim(s, 100), v: lim(v, 100) };
        changed();
        announce();
      });
      const sliderKey = (e, now, max) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') return lim(round(now) - by(e), max);
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') return lim(round(now) + by(e), max);
        if (e.key === 'PageUp') return lim(round(now) + 10, max);
        if (e.key === 'PageDown') return lim(round(now) - 10, max);
        if (e.key === 'Home') return 0;
        if (e.key === 'End') return max;
        return null;
      };
      hue.addEventListener('keydown', (e) => {
        const next = sliderKey(e, hsv.h, 359);
        if (next === null) return;
        e.preventDefault();
        if (next === Math.min(359, round(hsv.h))) return; // the reading does not move (359.76 at the end): the colour stays
        hsv = { ...hsv, h: next };
        changed();
        announce();
      });
      if (opac) opac.addEventListener('keydown', (e) => {
        const next = sliderKey(e, alpha, 100);
        if (next === null) return;
        e.preventDefault();
        alpha = next;
        changed();
      });

      // Hex: a whole hex as it is typed shows at once; Enter takes it and closes; leaving the field takes a good one and marks a bad
      // one with its line, the colour unchanged.
      hexIn.addEventListener('input', () => { const c = colourClean(hexIn.value); if (c) { markBad(false); setHex(c, 'hex'); } });
      hexIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        const c = colourClean(hexIn.value);
        if (!c) { markBad(true); return; }
        setHex(c);
        finish(true); // Enter is a choice, as a swatch is, even on the colour it opened with
      });
      hexIn.addEventListener('change', () => {
        if (!pop.isConnected) return;
        const c = colourClean(hexIn.value);
        if (!c) { markBad(true); return; }
        setHex(c);
        announce(true);
      });

      dropper.addEventListener('click', async () => {
        if (dropping || typeof window.EyeDropper !== 'function') return;
        dropping = true;
        try {
          const got = await new window.EyeDropper().open();
          const c = got && (colourClean(got.sRGBHex) || colourOfCss(got.sRGBHex));
          if (c && pop.isConnected) { setHex(c); announce(true); }
        } catch (err) {
          // The person backed out (AbortError); anything else means it does not work here: hide it from now on.
          if (!err || err.name !== 'AbortError') { colourDropper = false; dropper.hidden = true; if (pop.isConnected) hexIn.focus(); }
        } finally {
          dropping = false;
        }
      });

      // A swatch answers and closes. The arrows move between the swatches of a group (Up and Down by rows), Home and End to its ends;
      // Enter or Space chooses (the button's own click).
      for (const g of groups) {
        g.addEventListener('click', (e) => {
          const b = e.target.closest('.sdk-swatch');
          if (!b || !g.contains(b)) return;
          if (keeps && b.dataset.opacity !== undefined) alpha = colourOpacity(Number(b.dataset.opacity)); // a grid colour answers its own opacity
          setHex(b.dataset.color);
          finish(true);
        });
        g.addEventListener('keydown', (e) => {
          const cells = [...g.querySelectorAll('.sdk-swatch')];
          const now = e.target.closest('.sdk-swatch');
          if (!now || !cells.length) return;
          if (g === gridGroup && editable()) {
            // Delete or Backspace removes the focused grid colour; the context-menu key or Shift+F10 opens its Remove menu.
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); removeCell(now); return; }
            if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); removeMenu(now); return; }
          }
          let next = null;
          const i = cells.indexOf(now);
          if (e.key === 'ArrowRight') next = cells[Math.min(cells.length - 1, i + 1)];
          else if (e.key === 'ArrowLeft') next = cells[Math.max(0, i - 1)];
          else if (e.key === 'Home') next = cells[0];
          else if (e.key === 'End') next = cells[cells.length - 1];
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const down = e.key === 'ArrowDown';
            const r = now.getBoundingClientRect();
            const mid = r.left + r.width / 2;
            const rows = cells.map((c) => ({ c, r: c.getBoundingClientRect() })).filter(({ r: q }) => (down ? q.top > r.top + 2 : q.top < r.top - 2));
            if (rows.length) {
              const top = down ? Math.min(...rows.map(({ r: q }) => q.top)) : Math.max(...rows.map(({ r: q }) => q.top));
              const line = rows.filter(({ r: q }) => Math.abs(q.top - top) < 2);
              next = line.reduce((a, b) => (Math.abs(b.r.left + b.r.width / 2 - mid) < Math.abs(a.r.left + a.r.width / 2 - mid) ? b : a)).c;
            } else next = now;
          } else return;
          e.preventDefault();
          for (const c of cells) c.tabIndex = c === next ? 0 : -1;
          next.focus();
        });
      }

      // ---- Editing the grid (decision 23): "+", a drag of the colour showing, Delete and the Remove menu. Each add or remove is saved
      // at once through the page (ui.colorGrid.set, the whole list); a refused save puts the grid back and shows the server's sentence
      // under it. Never a choice: the picker stays open and the colour is not picked.
      const focusedNow = () => (env.root && env.root.activeElement) || document.activeElement;
      const gridCells = () => [...gridGroup.querySelectorAll('.sdk-swatch')];
      const cellOf = (entry) => gridCells().find((b) => b.dataset.color === entry.color && Number(b.dataset.opacity) === entry.opacity) || null;
      const entryOf = (b) => ({ color: b.dataset.color, opacity: Number(b.dataset.opacity) });
      const faint = (list) => {
        const surface = colourOfCss(getComputedStyle(pop).backgroundColor);
        if (surface) for (const b of list) if (colourContrast(b.dataset.color, surface) < 3) b.classList.add('sdk-cp-faint');
      };
      // Draws the grid again, and puts the focus on `to` (an entry, or 'plus'), else where it was (the same colour, or "+").
      const redraw = (to) => {
        const was = focusedNow();
        const inGrid = Boolean(was && gridGroup.contains(was));
        const before = inGrid && was !== plus && was.dataset.color ? entryOf(was) : null;
        drawGrid();
        faint(gridCells());
        paint();
        place();
        let target = null;
        if (to === 'plus' || (!to && inGrid && !before)) target = plus.isConnected ? plus : gridCells().at(-1) || null;
        else if (to || before) target = cellOf(to || before);
        if (!target && inGrid) target = plus.isConnected ? plus : gridCells()[0] || null;
        if (target) {
          if (target !== plus) for (const b of gridCells()) b.tabIndex = b === target ? 0 : -1;
          target.focus({ preventScroll: true });
        }
      };
      let saving = Promise.resolve();
      let kept = grid ? grid.colors : null; // the list the server last kept (null: never edited)
      const save = (next) => {
        grid = { colors: next, editable: true };
        colourGridSeen = { colors: next, editable: true };
        if (gridError) gridError.textContent = '';
        saving = saving.then(() => call('ui.colorGrid.set', { colors: next })).then((answer) => {
          const k = colourGridClean(answer) || next;
          kept = k;
          colourGridSeen = { colors: k, editable: true };
        }, (err) => {
          colourGridSeen = { colors: kept, editable: true };
          if (!pop.isConnected) return;
          grid = { colors: kept, editable: true };
          redraw();
          gridError.textContent = (err && err.message) || "Your colours weren't saved.";
        });
      };
      const addCurrent = (from) => {
        if (!editable()) return;
        const entry = { color: hex, opacity: keeps ? alpha : 100 };
        const r = colourGridAdd(gridList(), entry);
        if (r.how === 'there') { const b = cellOf(entry); if (b) { for (const c of gridCells()) c.tabIndex = c === b ? 0 : -1; b.focus({ preventScroll: true }); } tell('Already in your colours'); return; }
        if (r.how === 'full') { tell('Your colours are full. Remove one first.'); return; }
        save(r.list);
        redraw(from === 'plus' ? 'plus' : undefined);
        tell(`Added ${colourGridLabel(entry)}`);
      };
      function removeCell(b) {
        if (!editable() || !b || !gridGroup.contains(b) || !b.dataset.opacity) return;
        const entry = entryOf(b);
        const cells = gridCells();
        const i = cells.indexOf(b);
        const near = cells[i + 1] || cells[i - 1] || null;
        save(colourGridRemove(gridList(), entry));
        redraw(near ? entryOf(near) : 'plus');
        tell(`Removed ${colourGridLabel(entry)}`);
      }
      // The Remove menu: the SDK's own menu (host.menu.show's), opened over the picker, which stays open under it. While it is open the
      // picker is not the open menu, so the menu's own ways out (a pick, Escape, a press elsewhere) close the menu only; then the picker
      // is the open one again, unless something else opened meanwhile, which closes it.
      function removeMenu(b) {
        if (!editable() || !mine || openMenu !== mine) return;
        openMenu = null;
        showMenu({
          id: 'sdk-colour-remove',
          anchor: b,
          items: [{ label: 'Remove', icon: 'trash', onClick: () => { removeCell(b); } }],
          onClose: () => {
            Promise.resolve().then(() => {
              if (!mine || !pop.isConnected) return;
              if (openMenu === null) openMenu = mine;
              else if (openMenu !== mine) { outside = true; mine.cleanup(); } // the focus stays with what opened
            });
          },
        });
      }
      if (own) {
        plus.addEventListener('click', () => addCurrent('plus'));
        gridGroup.addEventListener('contextmenu', (e) => {
          const b = e.target.closest('.sdk-swatch');
          if (!b || !gridGroup.contains(b) || !editable()) return;
          e.preventDefault();
          removeMenu(b);
        });
        // A drag of the colour showing (the swatch beside Hex) onto the grid adds it; where it drops does not set its place.
        const DRAG = `application/x-host-colour-${uid}`;
        current.addEventListener('dragstart', (e) => {
          if (!editable() || !e.dataTransfer) { e.preventDefault(); return; }
          e.dataTransfer.setData(DRAG, hex);
          e.dataTransfer.setData('text/plain', hex);
          e.dataTransfer.effectAllowed = 'copy';
        });
        const ours = (e) => Boolean(editable() && e.dataTransfer && [...e.dataTransfer.types].includes(DRAG));
        const over = (e) => { if (!ours(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; gridGroup.classList.add('sdk-cp-drop'); };
        gridGroup.addEventListener('dragenter', over);
        gridGroup.addEventListener('dragover', over);
        gridGroup.addEventListener('dragleave', (e) => { if (!gridGroup.contains(e.relatedTarget)) gridGroup.classList.remove('sdk-cp-drop'); });
        gridGroup.addEventListener('drop', (e) => {
          gridGroup.classList.remove('sdk-cp-drop');
          if (!ours(e)) return;
          e.preventDefault();
          addCurrent('drop');
        });
        current.addEventListener('dragend', () => gridGroup.classList.remove('sdk-cp-drop'));
      }

      // Placed like a menu: under the anchor (above it when there is no room below) or at the point, inside the module's box; taller
      // than the box, it scrolls inside itself.
      const place = () => {
        const { modBox, box, w, h } = bounds();
        pop.style.maxHeight = `${Math.max(120, h - 8)}px`;
        pop.style.maxWidth = `${Math.max(120, w - 8)}px`;
        let x = (at ? at.x : 0) + (editor ? modBox.left : 0);
        let y = (at ? at.y : 0) + (editor ? modBox.top : 0);
        if (anchor) {
          const r = anchor.getBoundingClientRect();
          x = r.left - box.left;
          const below = h - (r.bottom - box.top + 4) - 4;
          const above = r.top - box.top - 4 - 4;
          // Under the anchor, else above it; where it fits on neither side, on the side with more room, scrolling inside itself
          // there, so it never covers the control it came from.
          if (pop.offsetHeight > below && pop.offsetHeight > above) pop.style.maxHeight = `${Math.max(120, Math.max(below, above))}px`;
          y = pop.offsetHeight <= below || below >= above ? r.bottom - box.top + 4 : r.top - box.top - pop.offsetHeight - 4;
        }
        x = Math.max(4, Math.min(x, w - pop.offsetWidth - 4));
        y = Math.max(4, Math.min(y, h - pop.offsetHeight - 4));
        pop.style.left = `${box.left + x}px`;
        pop.style.top = `${box.top + y}px`;
      };

      container.appendChild(pop);
      paint();
      // A swatch whose colour has under 3:1 against the menu's own surface (White on a light menu, Black on a dark one) gets the stronger edge.
      faint(swatches());
      place();
      // The person's grid as the page has it now: drawn again when it differs from what was drawn.
      if (own) {
        colourGridAsk().then((g) => {
          if (!pop.isConnected || (JSON.stringify(g.colors) === JSON.stringify(grid.colors) && g.editable === grid.editable)) return;
          grid = { colors: g.colors, editable: g.editable };
          kept = g.colors;
          redraw();
        });
      }
      // The person's Recent colours as the page has them now: drawn again when they differ. Focus in Recent stays on the same colour
      // (else the chosen or first one there).
      if (recentGroup) {
        colourRecentAsk().then((r) => {
          const next = r.colors || [];
          if (!pop.isConnected || JSON.stringify(next) === JSON.stringify(recentList)) return;
          const was = focusedNow();
          const before = was && recentGroup.contains(was) ? { color: was.dataset.color, opacity: Number(was.dataset.opacity) } : null;
          recentList = next;
          drawRecent();
          faint([...recentGroup.querySelectorAll('.sdk-swatch')]);
          paint();
          place();
          if (before) {
            const cells = [...recentGroup.querySelectorAll('.sdk-swatch')];
            const target = cells.find((b) => b.dataset.color === before.color && Number(b.dataset.opacity) === before.opacity) || cells.find((b) => b.tabIndex === 0) || null;
            if (target) { for (const b of cells) b.tabIndex = b === target ? 0 : -1; target.focus({ preventScroll: true }); } else hexIn.focus({ preventScroll: true });
          }
        });
      }
      const first = groups.length ? groups[0].querySelector('.sdk-swatch[aria-checked="true"]') : null;
      // The first focus is ours, not the person's: the chosen swatch's label (data-tip) would cover its heading, so it waits until
      // the keyboard leaves that swatch.
      if (first && first.dataset.tip) {
        const tip = first.dataset.tip;
        first.removeAttribute('data-tip');
        const back = () => { first.dataset.tip = tip; first.removeEventListener('blur', back); first.removeEventListener('pointerover', back); };
        first.addEventListener('blur', back);
        first.addEventListener('pointerover', back); // before the tooltip's own listener on the document, so a hover shows it
      }
      (first || hexIn).focus({ preventScroll: true });

      // Escape answers null; Tab goes round inside the picker; a press outside answers what is showing (the anchor's own press is the
      // toggle, so it is left to the call).
      const active = () => (env.root && env.root.activeElement) || document.activeElement;
      const onKey = (e) => {
        if (openMenu !== mine) return; // the grid's Remove menu is open over the picker: the keys are the menu's
        if (e.key === 'Escape') {
          if (dropping) return;
          const here = active();
          if (!here || !pop.contains(here)) { outside = true; finish(false); return; } // typed elsewhere: close, leave the focus where it is
          e.preventDefault();
          e.stopPropagation();
          finish(false);
          return;
        }
        if (e.key !== 'Tab') return;
        const now = active();
        if (!now || !pop.contains(now)) return;
        const stops = [area, hue, opac, hexIn, dropper.hidden ? null : dropper, gridGroup.querySelector('.sdk-swatch[tabindex="0"]'), plus && plus.isConnected ? plus : null, ...groups.slice(1).map((g) => g.querySelector('.sdk-swatch[tabindex="0"]'))].filter(Boolean);
        const i = stops.indexOf(now);
        if (now === pop) { e.preventDefault(); stops[e.shiftKey ? stops.length - 1 : 0].focus(); return; } // after a press on a part with no focus
        if (e.shiftKey && i === 0) { e.preventDefault(); stops[stops.length - 1].focus(); } else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
      };
      const onOutside = (e) => {
        if (openMenu !== mine) return; // a press while the grid's Remove menu is open closes that menu only
        if (dropping || pop.contains(e.target) || (anchor && anchor.contains(e.target))) return;
        outside = true;
        finish(touched); // nothing changed since it opened: null, so an empty field is not given a colour nobody chose
      };
      // A module in the page: a press on the page outside the module's root closes it too (inside the root, onOutside above has it).
      const onPage = (e) => {
        if (env.root === document || openMenu !== mine) return;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        if (path.includes(env.rootElement) || path.includes(pop)) return;
        // The module's own frame (module-frame.js: a section.mf around the module's content) and its toolbar or title bar.
        const frame = env.rootElement && typeof env.rootElement.closest === 'function' ? env.rootElement.closest('.mf') : null;
        const chrome = Boolean(frame) && path.some((n) => n && n.classList && (n.classList.contains('mf-toolbar') || n.classList.contains('mf-titlebar')) && n.closest('.mf') === frame);
        if (!anchor && chrome) colourLastOutside = { at, time: Date.now() };
        onOutside(e);
      };
      document.addEventListener('keydown', onKey, true);
      env.root.addEventListener('pointerdown', onOutside, true);
      if (env.root !== document) document.addEventListener('pointerdown', onPage, true);
      openMenu = mine = {
        id: 'sdk-colour',
        anchor,
        at,
        menu: pop,
        cleanup: () => {
          mine = null;
          clearTimeout(sayTimer);
          pop.remove();
          document.removeEventListener('keydown', onKey, true);
          env.root.removeEventListener('pointerdown', onOutside, true);
          document.removeEventListener('pointerdown', onPage, true);
          if (result && showsRecent) colourRecentKeep(result);
          if (anchor && anchor.focus && !outside) { try { anchor.focus(); } catch (err) { /* not focusable */ } }
          // A point (a toolbar button, a title-bar action), focus left on nothing: back to what had it when the picker opened (a module in
          // the page, a host page: the toolbar button itself), else, in a frame, the host control that opened it (focus.opener).
          // Not when another picker or menu took its place (a second toolbar button): that one has the focus, and keeps it.
          else if (!anchor && !outside) {
            Promise.resolve().then(() => {
              if (openMenu) return;
              const now = document.activeElement;
              if (now && now !== document.body) return;
              if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus(); } catch (err) { /* not focusable */ } }
              const after = document.activeElement;
              if (!after || after === document.body) return call('focus.opener', {});
              return null;
            }).catch(() => {});
          }
          resolve(result);
        },
      };
    });
  }

  // A colour field: a trigger (.sdk-picker: a swatch, the hex in words, a chevron) on an <input> the module or page has, which stays,
  // hidden, holding '#rrggbb'. The picker opens under the trigger; a choice sets the input and sends `input` and `change` from it.
  function colourField(input, o) {
    if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT') throw new Error('host.ui.colorField needs an <input>');
    const opt = o && typeof o === 'object' ? o : {};
    // A module's palette, or (none given) the person's grid, whose starting colours carry the names.
    const palette = opt.palette !== undefined ? colourPaletteCheck(opt.palette) : [{ heading: '', colours: COLOUR_GRID_START }];
    const keeps = opt.opacity !== false;
    let alpha = keeps ? colourOpacity(opt.opacity === undefined ? 100 : opt.opacity) : 100;
    const names = new Map();
    for (const g of palette) for (const c of g.colours) if (!names.has(c.color)) names.set(c.color, c.name);
    const own = input.labels && input.labels[0] ? input.labels[0].textContent.replace(/\s+/g, ' ').trim() : '';
    const label = (typeof opt.label === 'string' && opt.label.trim()) || input.getAttribute('aria-label') || own || 'Colour';
    const doc = input.ownerDocument;
    const trigger = doc.createElement('button');
    trigger.type = 'button';
    trigger.className = 'sdk-picker';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="sdk-picker-sw" aria-hidden="true"></span><span class="sdk-picker-value"><span class="sdk-hex"></span></span><span class="sdk-picker-icon" aria-hidden="true">${COLOUR_ICONS.chevron}</span>`;
    const sw = trigger.querySelector('.sdk-picker-sw');
    const words = trigger.querySelector('.sdk-hex');
    const was = { hidden: input.hidden, tabIndex: input.getAttribute('tabindex') };
    input.hidden = true;
    input.tabIndex = -1;
    input.before(trigger); // first, so a <label> around both leads to the trigger, not to the hidden input
    // A <label for="<the input's id>"> elsewhere leads to the trigger instead (its `for` moves to the trigger's id; destroy() puts it back).
    const pointed = input.id ? [...(input.labels || [])].filter((l) => l.htmlFor === input.id) : [];
    if (pointed.length) {
      let id = `${input.id}-colour`;
      const scope = typeof input.getRootNode === 'function' && typeof input.getRootNode().getElementById === 'function' ? input.getRootNode() : doc;
      for (let n = 2; scope.getElementById(id) || doc.getElementById(id); n += 1) id = `${input.id}-colour-${n}`;
      trigger.id = id;
      for (const l of pointed) l.htmlFor = trigger.id;
    }
    // What the input holds ('#rrggbb', or null when it holds no colour), and what the trigger shows (the palette's or the starting
    // grid's first colour then).
    const held = () => colourClean(input.value);
    const value = () => held() || palette[0].colours[0].color;
    // `none`: the words the trigger shows while the input holds no colour (an empty swatch then), for a field where no colour is a
    // choice the page offers beside it ("No colour"); set('') then empties the field. Without it the trigger shows the first colour.
    const none = typeof opt.none === 'string' ? opt.none.trim().slice(0, 40) : '';
    const show = (c) => {
      sw.removeAttribute('data-none');
      sw.style.setProperty('--sw', c);
      words.textContent = c;
      trigger.setAttribute('aria-label', `${label}, ${names.has(c) ? `${names.get(c)}, ` : ''}${c}. Change it`);
    };
    const showHeld = () => {
      if (held() || !none) { show(value()); return; }
      sw.dataset.none = '';
      sw.style.removeProperty('--sw');
      words.textContent = none;
      trigger.setAttribute('aria-label', `${label}, ${none}. Change it`);
    };
    showHeld();
    const sync = () => { trigger.disabled = Boolean(input.disabled); };
    sync();
    const watch = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null;
    if (watch) watch.observe(input, { attributes: true, attributeFilter: ['disabled'] });
    let opened = false;
    // onInput (for showing only, never for saving): each change while the picker is open, as the picker's own onInput; and when the
    // pick ends with nothing chosen after it was called, once more with what the field holds, so what was shown live goes back.
    const live = typeof opt.onInput === 'function' ? opt.onInput : null;
    let shownLive = false;
    const tellLive = (a) => { if (!live) return; shownLive = true; try { live({ color: a.color, opacity: a.opacity }); } catch (err) { console.error(err); } };
    const open = () => {
      if (input.matches(':disabled') && !opened) return Promise.resolve(null); // a disabled input, or one in a disabled fieldset
      const asked = showColourPicker({ anchor: trigger, value: value(), opacity: keeps ? alpha : false, palette: opt.palette !== undefined ? palette : undefined, recent: opt.recent, label, onInput: (a) => { show(a.color); tellLive(a); } });
      if (opened) return asked; // the same trigger again: that was the toggle, the picker is closed
      opened = true;
      shownLive = false;
      trigger.setAttribute('aria-expanded', 'true');
      return asked.then((a) => {
        opened = false;
        trigger.setAttribute('aria-expanded', 'false');
        if (!a) { showHeld(); if (shownLive) tellLive({ color: value(), opacity: alpha }); return null; }
        const moved = a.color !== held(); // an empty field takes any answer, the palette's first colour too
        const faded = a.opacity !== alpha;
        alpha = a.opacity;
        if (moved) {
          input.value = a.color;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        showHeld();
        if ((moved || faded) && typeof opt.onChange === 'function') { try { opt.onChange({ color: a.color, opacity: a.opacity }); } catch (err) { console.error(err); } }
        return a;
      });
    };
    const onClick = () => { open(); };
    trigger.addEventListener('click', onClick);
    return {
      // The colour the input holds, '#rrggbb', or '' when it holds none.
      get value() { return held() || ''; },
      // Shows a colour without telling anyone (no events, no onChange); anything that is not a hex is ignored, but '' empties a field
      // made with `none`.
      set: (c) => {
        const x = colourClean(c);
        if (!x && !(none && c === '')) return false;
        input.value = x || '';
        showHeld();
        return true;
      },
      open,
      close: () => { if (opened && openMenu && openMenu.id === 'sdk-colour' && openMenu.anchor === trigger) closeMenu(); },
      destroy: () => {
        if (opened && openMenu && openMenu.id === 'sdk-colour' && openMenu.anchor === trigger) closeMenu();
        if (watch) watch.disconnect();
        trigger.removeEventListener('click', onClick);
        for (const l of pointed) if (l.htmlFor === trigger.id) l.htmlFor = input.id;
        trigger.remove();
        input.hidden = was.hidden;
        if (was.tabIndex === null) input.removeAttribute('tabindex'); else input.setAttribute('tabindex', was.tabIndex);
      },
    };
  }

  const host = {
    // Resolves with { user, context, permissions, theme, module }. `context` is { scope: 'environment' | 'space' | 'keyed',
    // spaceId }: the module's own page, a space's canvas (with that space's id), or a keyed page.
    ready: () => readyPromise,
    // { language, clock: '12' | '24', currency, words, labels }: the environment's settings for how these are shown. See
    // host.util.time, host.util.hour12, host.util.money, host.util.word and host.util.label, which apply them. `words` is
    // every level's and role's word here, by code name: { space: { one: 'space', many: 'spaces', a: 'a space' }, ... };
    // `labels` the module's own renameable words (its manifest's `labels`), as this place's template reads them, the same shape.
    locale,

    // Where the module's page is: `root` is what to look elements up in (document.getElementById becomes
    // host.root.getElementById: in a frame it is the document, in the page it is the module's own
    // shadow root) and `rootElement` the element whose size is the module's (the frame's document element, or
    // its container). Use these rather than document, so the module runs in either place.
    root: env.root,
    rootElement: env.rootElement,

    // Small helpers more than one module needs, so each does not carry its own copy.
    util: {
      // Text made safe to put in HTML.
      esc,
      // A small, safe subset of Markdown to HTML (see the function above): headings, **bold**, *italic*, `code`,
      // fenced code, lists, [text](url) and bare https:// links, > quotes, paragraphs. The one place a module may
      // set innerHTML from text nobody here wrote, because the safety is already done inside it.
      markdown,
      // Markdown and HTML as plain text, for a field shown as plain text (see plainText above): plain('**Southwest**
      // [details](https://x.example)') is "Southwest details (https://x.example)". plain(text, { line: true }) makes it one line.
      // A field a module draws with markdown() keeps its Markdown instead.
      plain: plainText,
      // A local date and time from an object's `when` (see localWhen above): localWhen('2026-11-14T12:50') is
      // { date: '2026-11-14', time: '12:50' }; localWhen('15:25', '2026-11-14') takes the object's own date for a time alone.
      // The clock time stays as written: a zone or offset is dropped, never converted. Null when it says neither.
      localWhen,
      // An object's details as "Label: value" lines (see detailLines above), for the fields a module has no place for:
      // detailLines({ cabin: '4B', minutes: 150 }) is ['Cabin: 4B', 'Length: 2 h 30 min']. { skip: ['due'] } leaves out
      // the fields already used; { kind: 'car' } words a car's ends as Pick up and Drop off.
      detailLines,
      // A new id for something a module stores: short, and unlikely to repeat.
      id: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      // A pointer's identity as one string, for keeping and comparing them.
      objectKey: (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|'),
      // A time of day ("22:30", as modules store one) the way the server shows times: "10:30 PM" on a 12-hour clock
      // (the default, see host.locale()), "22:30" on a 24-hour one. Anything that is not HH:MM comes back as it is.
      time: (hhmm) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
        if (!m) return hhmm || '';
        if (locale().clock === '24') return `${m[1].padStart(2, '0')}:${m[2]}`;
        const h = Number(m[1]);
        return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
      },
      // Whether times are on a 12-hour clock, for toLocaleString's hour12 where a Date is shown.
      hour12: () => locale().clock !== '24',
      // The word a person reads here for a level or role, by its code name, so a module never types one:
      // word('space') "space", word('space', { many: true, cap: true }) "Spaces", word('aside', { a: true }) "an aside".
      // An environment may call its spaces trips; this says so. An unknown name throws.
      word: (key, o) => {
        const set = locale().words || {};
        const w = (set[key] && set[key].one && set[key].many ? set[key] : null) || DEFAULT_WORDS[key];
        if (!w) throw new Error(`host.util.word: there is no word called ${key}`);
        const text = o && o.a ? w.a || `${/^[aeiou]/i.test(w.one) ? 'an' : 'a'} ${w.one}` : o && o.many ? w.many : w.one;
        return o && o.cap ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text;
      },
      // One of the module's own renameable words (its manifest's `labels`), as this place reads it: the template's where
      // it renames it, else the manifest's. The twin of word: label('event') "meeting", label('event', { many: true, cap:
      // true }) "Meetings", label('event', { a: true }) "a meeting". A key the manifest does not declare (or before
      // ready) answers `fallback` when given, else the key itself. Plain text: set it with textContent, never as HTML.
      label: (key, o) => {
        const set = locale().labels;
        const w = set && typeof set === 'object' && Object.prototype.hasOwnProperty.call(set, key) && set[key] && typeof set[key].one === 'string' && typeof set[key].many === 'string' ? set[key] : null;
        if (!w) return o && typeof o.fallback === 'string' ? o.fallback : String(key);
        const text = o && o.a ? (typeof w.a === 'string' && w.a ? w.a : `${/^[aeiou]/i.test(w.one) ? 'an' : 'a'} ${w.one}`) : o && o.many ? w.many : w.one;
        return o && o.cap ? text.charAt(0).toLocaleUpperCase('en') + text.slice(1) : text;
      },
      // Fill every element marked data-word="<code name>" in `root` (an element, a fragment or the module's root) with
      // its word, as the host's own pages do: data-word-form takes any of many, cap and a, space-separated.
      // <span data-word="owner" data-word-form="a cap"></span> reads "An owner". Answers `root`.
      fillWords: (root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return root;
        const els = [...(typeof root.matches === 'function' && root.matches('[data-word]') ? [root] : []), ...root.querySelectorAll('[data-word]')];
        for (const el of els) {
          const form = ` ${el.dataset.wordForm || ''} `;
          el.textContent = host.util.word(el.dataset.word, { many: form.includes(' many '), cap: form.includes(' cap '), a: form.includes(' a ') });
        }
        return root;
      },
      // An amount of money in a currency (the server's unless one is given), formatted for the reader.
      money: (amount, currency) => {
        const code = currency || locale().currency;
        const n = Number(amount) || 0;
        try { return new Intl.NumberFormat([], { style: 'currency', currency: code }).format(n); } catch (err) { return `${n.toFixed(2)} ${code}`; }
      },
      // An order key that sorts between two neighbours (the shared outline pieces): order(before, after) with null for no neighbour on
      // that side; order(null, null) is the first key, order(last, null) one after the last. Keys are short strings of 0-9, A-Z, a-z
      // that never end in "0"; compare them as plain strings. Two people inserting between the same two entries may make the same key;
      // host.ui.outline lists equal keys by id, so nobody's list is renumbered. Throws RangeError for a key that is not one or a
      // `before` that does not sort before `after`.
      order: outlineOrder,
      // The progress of each parent in a list of entries { id, parent, done }: rollup(entries) is { <parent id>: { done, total } }, counted
      // over the entries below it at any depth that have no children of their own. `rollup(entries, { done(entry) })` says what counts as done.
      rollup: outlineRollup,
      // The WCAG 2 contrast ratio of two #rrggbb colours, a number: contrast('#ffffff', '#2f6cbf') is about 5.1. Throws for anything else.
      contrast: colourContrast,
      // The words to put on a fill: readableOn('#2f6cbf') is { color: '#ffffff', ratio, ok }, white or '#0a0a0a', whichever reads
      // better, and ok at 4.5:1 or more. The same pick as the theme editor's. Throws for anything that is not #rrggbb.
      readableOn: colourReadableOn,
      // Dates as "2026-09-24" (a local day): text from a Date, and back.
      ymd: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      // The phase timeline of the space this module is in (public/phases.js timelineOf, the rule the server runs; see
      // plan-one-bar.md): one band per template phase in order, [{ id, label, main, color, start, end, dated, current }]
      // (`color` the phase's own '#rrggbb', or its place's default; words on it take host.util.readableOn(color)),
      // from host.phases() and host.space().phases, the first phase starting on the day the space was created. `o`
      // may give `dates` and `created` (another space's, on an environment page: what host.spaces() lists) and
      // `today` (a day; today by default). [] with no phases. Throws when the rule did not load.
      phaseTimeline: (o) => {
        const rule = phaseRule();
        const here = (info && info.space) || null;
        const dates = o && o.dates !== undefined ? o.dates : (here && here.phases) || {};
        const created = o && o.created !== undefined ? o.created : here ? here.createdAt : null;
        return rule.timelineOf(host.phases(), dates, { today: (o && o.today) || host.util.ymd(new Date()), created });
      },
      // The words for a timeline on a day (chipWords, the bar's chip and the Planner's phase line): "Booking · day 2
      // of 3", "Planning · 12 days to go", or the label alone. '' with no bands.
      phaseWords: (bands, today) => phaseRule().chipWords(bands, today || host.util.ymd(new Date())),
      // Pull a date and a time out of what someone typed, and leave the rest as the title:
      // "meet with bob sep 29 at 7pm" gives { title: "meet with bob", date: "2026-09-29", time: "19:00" }. Understands
      // today, tomorrow, weekdays ("fri", "next fri"), "sep 29" and "29 sep", "9/29" and "2026-09-29"; times as
      // "7pm", "7:30 pm", "19:00", "at 7". A date already passed this year means next year. Anything it does
      // not recognise stays in the title; date and time are only there when found.
      parseWhen: (text, now) => {
        const base = now || new Date();
        let t = ' ' + String(text || '').trim() + ' ';
        const out = {};
        const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
        const ymd = host.util.ymd;
        const fix = (m, d, y) => {
          let year = y || base.getFullYear();
          let date = new Date(year, m, d);
          if (date.getMonth() !== m) return null;
          const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
          if (!y && date < today) date = new Date(year + 1, m, d);
          return ymd(date);
        };
        const take = (re, fn) => { const m = re.exec(t); if (!m) return false; const v = fn(m); if (v === null || v === undefined) return false; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return v; };
        // time first, so "7" in "at 7" is not read as a day
        let time = null;
        take(/\s(?:at\s+)?(noon|midday|midnight)\b/i, (m) => { time = /midnight/i.test(m[1]) ? '00:00' : '12:00'; return true; })
          || take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => { let h = Number(m[1]); const mi = Number(m[2] || 0); if (h < 1 || h > 12 || mi > 59) return null; const pm = m[3].toLowerCase() === 'pm'; h = (h % 12) + (pm ? 12 : 0); time = String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0'); return true; })
          || take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { time = m[1].padStart(2, '0') + ':' + m[2]; return true; })
          || take(/\sat\s+(\d{1,2})\b(?!\s*[/-])/i, (m) => { const h = Number(m[1]); if (h < 1 || h > 23) return null; time = String((h < 7 ? h + 12 : h)).padStart(2, '0') + ':00'; return true; });
        let date = null;
        const set = (v) => { date = v; return Boolean(v); };
        take(/\s(\d{4})-(\d{2})-(\d{2})\b/, (m) => set(fix(Number(m[2]) - 1, Number(m[3]), Number(m[1]))))
          || take(/\s(?:on\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/i, (m) => set(fix(months.indexOf(m[1].toLowerCase().slice(0, 3)), Number(m[2]), m[3] ? Number(m[3]) : 0)))
          || take(/\s(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i, (m) => set(fix(months.indexOf(m[2].toLowerCase().slice(0, 3)), Number(m[1]), 0)))
          || take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => set(fix(Number(m[1]) - 1, Number(m[2]), m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0)))
          || take(/\s(today|tonight)\b/i, () => set(ymd(base)))
          || take(/\stomorrow\b/i, () => set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))))
          || take(/\s(?:on\s+|next\s+|this\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i, (m) => { const want = days.indexOf(m[1].toLowerCase().slice(0, 3)); let ahead = (want - base.getDay() + 7) % 7; if (ahead === 0 || /next\s/i.test(m[0])) ahead = ahead === 0 ? 7 : ahead + (want > base.getDay() ? 7 : 0); return set(ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + ahead))); });
        if (date) out.date = date;
        if (time) out.time = time;
        out.title = t.replace(/\s+/g, ' ').trim().replace(/\s+(on|at|by|for|from)$/i, '').replace(/^(on|at|by)\s+/i, '').trim();
        if (!out.title) out.title = String(text || '').trim();
        return out;
      },
      parseYmd: (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); },
      // Places on the earth, for the modules that have them (a place, a map): coordinates checked and read, and the link
      // that opens a spot in the person's own maps app. Pure, so a check can run it without a browser.
      geo: (() => {
        const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const round6 = (n) => Math.round(n * 1e6) / 1e6;
        // Text on one line, without control characters, at most `max` long.
        const oneLine = (s, max) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
        // A latitude or longitude typed in a field (`max` is 90 or 180): a number in range, or null.
        const coord = (text, max) => {
          const t = String(text == null ? '' : text).trim().replace(',', '.');
          if (!/^[-+]?\d{1,3}(\.\d+)?$/.test(t)) return null;
          const n = Number(t);
          return Math.abs(n) <= max ? n : null;
        };
        // What was typed or pasted: a pair of coordinates ("38.7075, -9.1364"), or a map link that carries them (a geo: link,
        // ?ll= or ?q= or ?mlat=&mlon=, /@lat,lng, #map=zoom/lat/lng, !3dLAT!4dLNG). { lat, lng } or null.
        const parsePoint = (text) => {
          const t = String(text == null ? '' : text).trim();
          if (!t) return null;
          const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
          const pair = (re) => {
            const m = t.match(re);
            if (!m) return null;
            const lat = Number(m[1]);
            const lng = Number(m[2]);
            return inRange(lat, lng) ? { lat: round6(lat), lng: round6(lng) } : null;
          };
          if (/^[-+]?\d/.test(t) && !/[a-z]/i.test(t)) return pair(new RegExp(`^${NUM}\\s*[,;\\s]\\s*${NUM}$`));
          return (
            pair(new RegExp(`^geo:${NUM},${NUM}`, 'i')) ||
            pair(new RegExp(`[?&](?:ll|q|query|center|sll)=${NUM}(?:,|%2C)\\s*${NUM}`, 'i')) ||
            pair(new RegExp(`[?&]mlat=${NUM}&(?:amp;)?mlon=${NUM}`, 'i')) ||
            pair(new RegExp(`!3d${NUM}!4d${NUM}`)) ||
            pair(new RegExp(`/@${NUM},${NUM}`)) ||
            pair(new RegExp(`#map=\\d{1,2}(?:\\.\\d+)?/${NUM}/${NUM}`))
          );
        };
        const fmt = (n) => (Math.round(n * 1e5) / 1e5).toFixed(5);
        // "38.70750, -9.13640"
        const coordsText = (lat, lng) => `${fmt(lat)}, ${fmt(lng)}`;
        // The link that opens a spot in the person's own maps app: the platform's own link on Apple devices (`apple`
        // true), a geo: link on Android, which hands it to the maps app, and an ordinary web link everywhere else. A
        // desktop browser has nothing registered for geo:, so it would open nothing (Windows shows a blank page).
        // Directions are that app's business.
        const android = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
        const mapsLink = (lat, lng, name, apple) => {
          const n = oneLine(name, 80).replace(/[()]/g, ' ');
          if (apple) return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(n || 'Place')}`;
          if (android()) return `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(n || 'Place')})`;
          return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
        };
        // The same for a place with only a name or an address: the maps app searches for it.
        const mapsSearch = (text, apple) => {
          const q = encodeURIComponent(oneLine(text, 160));
          if (apple) return `https://maps.apple.com/?q=${q}`;
          if (android()) return `geo:0,0?q=${q}`;
          return `https://www.openstreetmap.org/search?query=${q}`;
        };
        return { inRange, round6, oneLine, coord, parsePoint, coordsText, mapsLink, mapsSearch };
      })(),
    },

    // Interface the modules share, drawn the same everywhere and following the theme.
    ui: {
      // A Font Awesome icon ("circle-right", style "solid", "regular" or "brands") as inline SVG text, coloured by
      // the text colour, for a module that cannot load the icon font. Resolves to the SVG, or rejects if there is no such icon.
      icon: (name, style) => call('icons.svg', { name, style: style || 'solid' }),
      // The files an object links to, drawn as the shared file chips (plan-attachments-vault.md, section 5; the Prototype's "In other modules"):
      // a type icon, the name and the size; a click opens the file window over the canvas (host.objects.open with the other chips' ids as
      // `list`, so Previous and Next walk them; one chip alone has none). A file that was removed reads "File removed", one whose bytes are
      // gone "File missing", one this person may not see "Not available to you" (the last three are muted and not links).
      //   host.ui.fileChips(container, pointers, { canEdit?, unlinkable?, live?, onOpen?(pointer), onRemoveLink?(pointer) }) -> { update(pointers), destroy() }
      // `canEdit` adds Remove link beside a removed or missing file, which calls onRemoveLink(pointer) (the module unlinks it with
      // host.files.unlink, updates its own list and calls update); with `unlinkable` as well, a file that is there gets Unlink too (an editor's
      // list). The chips look again by themselves when a file is renamed or removed (the 'library' event) and when links change, until the
      // container leaves the page; `live: false` turns that off. The container is cleared; pointers are checked, and only files are drawn.
      fileChips: (container, pointers, o) => {
        const opt = o || {};
        let list = [];
        let gen = 0;
        let dead = false;
        const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
        const icon = async (name) => { const span = make('span', 'ic sdk-file-chip-ic'); span.setAttribute('aria-hidden', 'true'); try { span.innerHTML = await menuIcon(name); } catch (err) { /* no icon */ } return span; };
        async function draw() {
          const mine = ++gen;
          const facts = list.length ? await resolveFiles(list).catch(() => list.map((ref) => ({ ref, state: 'hidden' }))) : [];
          if (dead || mine !== gen) return;
          const there = facts.filter((f) => !f.state);
          const ids = there.length > 1 ? there.map((f) => f.ref.id) : null;
          const rows = [];
          for (const f of facts) {
            const wrap = make('span', 'sdk-file-chipwrap');
            const state = f.state || 'ok';
            const chip = make(state === 'ok' ? 'button' : 'span', 'sdk-chip-tag sdk-file-chip');
            chip.dataset.state = state;
            if (state === 'ok') {
              chip.type = 'button';
              chip.append(await icon(f.icon), make('span', 'sdk-file-chip-name', f.name), make('span', 'sdk-file-chip-size', fileSize(f.size)));
              chip.setAttribute('aria-label', `${f.name}, ${fileSize(f.size)}. Open the file.`);
              chip.addEventListener('click', () => { if (typeof opt.onOpen === 'function') opt.onOpen(f.ref); else host.objects.open(f.ref, ids ? { list: ids } : undefined).catch((err) => host.ui.toast(err.message)); });
            } else if (state === 'removed') {
              chip.append(await icon('file-circle-xmark'), make('span', 'sdk-file-chip-state', 'File removed'));
            } else if (state === 'missing') {
              chip.dataset.tone = 'warn';
              chip.append(await icon('triangle-exclamation'), make('span', 'sdk-file-chip-name', f.name), make('span', 'sdk-file-chip-state', 'File missing'));
            } else {
              chip.append(await icon('lock'), make('span', 'sdk-file-chip-state', 'Not available to you'));
            }
            wrap.append(chip);
            if (opt.canEdit === true && (state === 'removed' || state === 'missing' || (state === 'ok' && opt.unlinkable === true))) {
              const remove = make('button', 'btn btn-small btn-quiet sdk-file-chip-remove', state === 'ok' ? 'Unlink' : 'Remove link');
              remove.type = 'button';
              if (state === 'ok') remove.setAttribute('aria-label', `Unlink ${f.name}`);
              remove.addEventListener('click', () => { if (typeof opt.onRemoveLink === 'function') opt.onRemoveLink(f.ref); });
              wrap.append(remove);
            }
            rows.push(wrap);
          }
          if (dead || mine !== gen) return;
          container.classList.add('sdk-file-chips');
          container.replaceChildren(...rows);
        }
        const set = (next) => { list = (Array.isArray(next) ? next : []).map(cleanRef).filter((r) => r && r.kind === 'file'); return draw(); };
        const offs = [];
        const again = () => {
          if (dead) return;
          if (!container.isConnected) { dead = true; for (const off of offs) off(); return; } // the module drew something else over it
          if (list.length) draw();
        };
        if (opt.live !== false) offs.push(host.on('library', again), host.on('links', again));
        set(pointers);
        return { update: set, destroy: () => { dead = true; for (const off of offs) off(); container.replaceChildren(); } };
      },
      // A short note that appears for a few seconds and goes: for an instant confirmation ("Saved in X.") or a small refusal. Never
      // draw one inline in the module. Resolves true; the text is cut to 200 characters. `kind` (optional): 'info' (the default),
      // 'success', 'warning' (stays 6 s) or 'danger' (a refusal or a failure, 7 s); anything else is 'info'. Only the text and the kind go.
      toast: (text, opts) => call('ui.toast', { text: String(text ?? ''), kind: opts && typeof opts.kind === 'string' ? opts.kind : undefined }).then(() => true),
      // A question the person answers, in place of the browser's own confirm (never call window.confirm). Drawn by the page, over
      // everything, as the styled confirm: a title, a plain message, Cancel and the action. Resolves true (the action) or false
      // (Cancel, Escape, a click outside); rejects only when it is asked badly (no title, an unknown kind) or the page did not answer.
      // host.ui.confirm({ title, message?, action?, cancel?, kind?, typed? }):
      //   title    the question, short ("Delete this place?"); message: one or two plain lines of what happens ("\n\n" starts a paragraph).
      //   action   the button's word ("Delete"; default "OK"); cancel: default "Cancel".
      //   kind     'plain' (default: the main button; easy to take back), 'destructive' (soft red, focus on Cancel) or
      //            'final' (cannot be undone: solid red, focus on Cancel).
      //   typed    with kind 'final': a name the person types before the action turns on.
      // Escape cancels; focus is held in the dialog and goes back to where it was.
      confirm: (o) => {
        const t = o && typeof o === 'object' ? o : {};
        if (typeof t.title !== 'string' || !t.title.trim()) return Promise.reject(Object.assign(new Error('say what is being asked (title)'), { status: 400 }));
        return call('ui.confirm', { title: t.title, message: t.message, action: t.action, cancel: t.cancel, kind: t.kind, typed: t.typed }).then((r) => r === true);
      },
      // A one-line question the person answers by typing, in place of the browser's own prompt (never call window.prompt). Drawn by the
      // page like host.ui.confirm (the same dialog, over everything, with one text field). Resolves the text typed (a string, which may
      // be empty) or null (Cancel, Escape, a click outside, or another prompt already open: only one is open at a time).
      // host.ui.prompt({ title, label?, value?, action?, placeholder?, maxLength?, validate? }):
      //   title    the question, short ("Rename the map"); label: the field's name; value: what the field starts with.
      //   action   the button's word (default "OK"); placeholder: the grey hint in an empty field.
      //   maxLength  default 200, at most 2000; the field stops there.
      //   validate  optional function (answer) => string | falsy, run here in the module, never sent. A string is an error message:
      //            the page asks again with that message under the field and what was typed in it, until it passes or the person cancels.
      // Text only (no HTML anywhere); the strings are cut to a length (title 200, label 200, placeholder 200, action 40). The module cannot style it.
      // Rejects only when it is asked badly (no title) or the page did not answer. Escape cancels; focus is held in the dialog and goes back.
      prompt: async (o) => {
        const t = o && typeof o === 'object' ? o : {};
        if (typeof t.title !== 'string' || !t.title.trim()) throw Object.assign(new Error('say what is being asked (title)'), { status: 400 });
        const str = (v) => (typeof v === 'string' ? v : undefined);
        const validate = typeof t.validate === 'function' ? t.validate : null;
        let value = str(t.value);
        let error;
        for (;;) {
          const r = await call('ui.prompt', { title: t.title, label: str(t.label), value, action: str(t.action), placeholder: str(t.placeholder), maxLength: Number.isFinite(t.maxLength) ? t.maxLength : undefined, error });
          if (typeof r !== 'string') return null;
          const problem = validate ? await validate(r) : '';
          if (typeof problem !== 'string' || !problem.trim()) return r;
          value = r;
          error = problem;
        }
      },
      // A date picker for a date field: a small month grid under it, weekdays across the top, so the day a date
      // falls on is visible while choosing. The typed field keeps working; a button opens the grid and the
      // weekday of what is in the field shows under it. Works on <input type="date"> and
      // <input type="datetime-local"> (which keeps its time, or takes 12:00 when it has none).
      // datePicker(input, { range: () => [from, to], clearable, list: { label, items, none } }): highlight a span of days, and offer Clear.
      // The field is a .sdk-datefield: the input with the calendar button inside its trailing edge (a small quiet icon button; the Fields block of
      // system.css). In a .sdk-form it is also a .sdk-group and the weekday is the field's .sdk-hint.
      // `list` adds a second button (in a .sdk-form only) that opens the module's own list of days: items(set) returns host.menu.show
      // entries, an entry `{ label, day: 'YYYY-MM-DD' }` sets that day, `none: 'Unscheduled'` adds a first entry that clears the field.
      // Returns { close, destroy }.
      datePicker: (input, o) => {
        const options = o || {};
        const u = host.util;
        const inForm = Boolean(input.closest('.sdk-form'));
        const wrap = document.createElement('span');
        wrap.className = inForm ? 'sdk-datefield sdk-group' : 'sdk-datefield';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const icon = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
        const mkBtn = (title, d) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-icon-btn btn-small btn-quiet';
          b.dataset.tip = title;
          b.setAttribute('aria-label', title);
          b.innerHTML = icon(d);
          wrap.appendChild(b);
          return b;
        };
        const btn = mkBtn('Pick a date', 'M4 0v2H2.5A1.5 1.5 0 0 0 1 3.5v10A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 13.5 2H12V0h-1.5v2h-5V0zM2.5 5h11v8.5h-11z');
        // The weekday: in a form, the field's hint slot (a .sdk-hint after the field's group, reused when the form has one); else the old line.
        const field = inForm ? wrap.closest('.sdk-field') : null;
        let hint = field ? field.querySelector(':scope > .sdk-hint') : null;
        const ownHint = !hint;
        if (!hint) {
          hint = document.createElement('span');
          hint.className = inForm ? 'sdk-hint' : 'tv-dow-hint';
          (field || wrap.parentNode).insertBefore(hint, wrap.nextSibling);
        }
        // `list: { label, items, none }`: a second button that opens the module's own list of days under the field (the Planner's
        // days by phase, the spots between days). items(set) gives host.menu.show entries; an entry with a `day` ('YYYY-MM-DD') sets
        // that day when chosen, one with `onClick` does its own. `none` (a word, "Unscheduled") adds a first entry that clears the field.
        // A list needs a .sdk-form field; elsewhere it is ignored.
        const listBtn = inForm && options.list && typeof options.list.items === 'function'
          ? mkBtn(options.list.label || 'Pick from the list', 'M2 3h12v1.6H2zm0 4.2h12v1.6H2zm0 4.2h12V13H2z') : null;
        const dayOf = () => String(input.value || '').slice(0, 10);
        const showDow = () => { hint.textContent = dayOf() ? u.parseYmd(dayOf()).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
        input.addEventListener('input', showDow);
        input.addEventListener('change', showDow);
        showDow();
        let pop = null;
        const close = () => { if (pop) pop.remove(); pop = null; document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); };
        // Escape closes only the picker: stopped and prevented, so an editor window around it does not close too.
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
        const away = (e) => { if (pop && !pop.contains(e.target) && !wrap.contains(e.target)) close(); };
        // A disabled field (a read-only form) has no picker: the button is disabled with it and open() does nothing.
        const syncDisabled = () => { btn.disabled = Boolean(input.disabled); if (listBtn) listBtn.disabled = Boolean(input.disabled); };
        syncDisabled();
        const open = () => {
          if (pop) return close();
          if (input.disabled) return;
          const seed = dayOf() || u.ymd(new Date());
          let month = new Date(u.parseYmd(seed).getFullYear(), u.parseYmd(seed).getMonth(), 1);
          pop = document.createElement('div');
          pop.className = 'sdk-dp';
          pop.setAttribute('role', 'dialog');
          pop.setAttribute('aria-label', 'Choose a day');
          const draw = () => {
            const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
            const [from, to] = options.range ? options.range() : [];
            const today = u.ymd(new Date());
            let cells = '';
            for (let i = 0; i < 42; i += 1) {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
              const k = u.ymd(d);
              cells += `<button type="button" class="sdk-dp-day${d.getMonth() !== month.getMonth() ? ' other' : ''}${k === today ? ' today' : ''}${k === dayOf() ? ' sel' : ''}${from && to && k >= from && k <= to ? ' inrange' : ''}" data-day="${k}">${d.getDate()}</button>`;
            }
            const monthName = u.esc(month.toLocaleDateString([], { month: 'long', year: 'numeric' }));
            const chevron = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
            pop.innerHTML = `<div class="sdk-dp-head"><button type="button" class="sdk-icon-btn btn-quiet btn-small" data-dp="prev" aria-label="Previous month">${chevron('M10.7 1.9 4.6 8l6.1 6.1 1.4-1.4L7.4 8l4.7-4.7z')}</button><span class="sdk-dp-title">${monthName}</span><button type="button" class="sdk-icon-btn btn-quiet btn-small" data-dp="next" aria-label="Next month">${chevron('M5.3 1.9 11.4 8l-6.1 6.1-1.4-1.4L8.6 8 3.9 3.3z')}</button></div>
              <div class="sdk-dp-grid" role="group" aria-label="${monthName}">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n) => `<span class="sdk-dp-dow" aria-hidden="true">${n}</span>`).join('')}${cells}</div>
              <div class="sdk-dp-foot">${options.clearable ? '<button type="button" class="btn btn-quiet btn-small" data-dp="clear">Clear</button>' : '<span></span>'}<button type="button" class="btn btn-small" data-dp="today">Today</button></div>`;
          };
          pop.addEventListener('click', (e) => {
            e.stopPropagation();
            const set = (day) => {
              input.value = !day ? '' : input.type === 'datetime-local' ? day + 'T' + ((input.value.split('T')[1]) || '12:00') : day;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              close();
            };
            const day = e.target.closest('[data-day]');
            if (day) return set(day.dataset.day);
            const nav = e.target.closest('[data-dp]');
            if (!nav) return;
            if (nav.dataset.dp === 'prev') month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
            else if (nav.dataset.dp === 'next') month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
            else if (nav.dataset.dp === 'today') return set(u.ymd(new Date()));
            else if (nav.dataset.dp === 'clear') return set('');
            draw();
          });
          draw();
          // Inside an open editor window (host.ui.editor) the popover goes into the dialog and is kept inside the window.
          const editor = editorAt(input);
          (editor || (env.root === document ? document.body : env.root)).appendChild(pop);
          // Under the field, by the page's coordinates, kept on screen.
          const r = input.getBoundingClientRect();
          const box = editor ? { left: 0, top: 0 } : env.rootElement.getBoundingClientRect();
          const w = editor ? window.innerWidth : env.rootElement.clientWidth || 400;
          let top = r.bottom + 4;
          if (editor && top + pop.offsetHeight > window.innerHeight - 4) top = Math.max(4, r.top - pop.offsetHeight - 4);
          pop.style.top = top + 'px';
          pop.style.left = box.left + Math.max(editor ? 4 : 8, Math.min(r.left - box.left, w - pop.offsetWidth - (editor ? 4 : 8))) + 'px';
          document.addEventListener('keydown', key, true);
          env.root.addEventListener('pointerdown', away, true);
        };
        btn.addEventListener('click', open);
        const setDay = (day) => {
          input.value = !day ? '' : input.type === 'datetime-local' ? day + 'T' + ((input.value.split('T')[1]) || '12:00') : day;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        if (listBtn) {
          listBtn.addEventListener('click', () => {
            if (input.disabled) return;
            close();
            const raw = options.list.items(setDay) || [];
            const entries = raw.map((e) => (e && e.day !== undefined && !e.onClick ? { ...e, onClick: () => setDay(e.day) } : e));
            if (options.list.none) entries.unshift({ id: 'none', label: String(options.list.none), icon: 'xmark', onClick: () => setDay('') });
            host.menu.show({ id: 'sdk-datelist', anchor: listBtn, items: entries });
          });
        }
        return { close, refresh: () => { close(); showDow(); syncDisabled(); }, destroy: () => { close(); if (ownHint) hint.remove(); wrap.parentNode.insertBefore(input, wrap); wrap.remove(); } };
      },
      // An editor window: the module's Add or Edit form, a <dialog> in its root, shown modal over everything (the top
      // layer: above every module and the header, never clipped by the module's box), 560 px wide ('medium', the default)
      // or 880 px ('large'), a full-screen sheet on a phone. The SDK adds a Close button in its corner; Escape or Close
      // asks "Discard your changes?" when `isDirty()` says true. A click outside does nothing. The dialog scrolls; a
      // button row marked `sdk-editor-actions` sticks to its bottom. The module's own popovers (host.menu.show, the date
      // picker, host.actions.pick) open inside it. Styles in /sdk/host.css.
      //   editor(dialog, { size, isDirty, onClose }) -> { open({ focus, returnTo }), close(), cancel(), isOpen, element }
      //   close(): after a save, at once. cancel(): the module's own Cancel button; asks "Discard your changes?" first
      //   when isDirty() says so. onClose(reason): 'cancel' (Escape, Close, Cancel, Discard) or 'done' (close()).
      //   open() a second time only moves focus.
      //   returnTo: an element, or a function giving one, focused on close (a microtask after onClose, so a list the
      //   module redraws then is the one searched; else what had focus before, else the module).
      // Anything but a <dialog> throws "host.ui.editor needs a <dialog> element".
      editor: (dialogEl, o) => createEditor(dialogEl, o, editorDeps),
      // A kind picker: one row (--bar-control-h tall) naming the chosen kind of thing with its icon in its colour on a chip,
      // a chevron at its end; a click, typing, Down or Alt+Down opens the list of kinds in their groups, each with its icon
      // and colour, recently chosen first; typing filters by name and `words` (the start of any word). The ARIA combobox
      // pattern: Up and Down move, Home and End jump, Enter or Tab chooses, Escape closes only the list. A sheet on a phone.
      // Inside an open editor window the list goes into the dialog. Styles in /sdk/host.css (.sdk-kind).
      //   kindPicker(el, { label, groups: [{ label, options: [{ id, label, icon, color, words }] }], value, recent: { key, max }, onChange })
      //   -> { value, set(id), setGroups(groups), remember(id), disabled, focus(), open(), close(), element, input, destroy() }
      //   `color` any CSS colour (set as --kind-color). `recent` keeps the choices in this browser for this module, as
      //   host.actions.pick's remember does; `start: 'recent'` starts on the kind chosen last in this browser when there
      //   is one, else on `value`. set() chooses without onChange; onChange(id) fires for a person's choice of a different kind.
      //   A `value` or set() id that is not in the groups shows an empty field saying "Unknown kind", never another kind;
      //   setGroups() dropping the chosen kind reports it as onChange(value). remember(id) records a kind as recently used.
      // Anything but an element throws "host.ui.kindPicker needs an element".
      kindPicker: (el, o) => createKindPicker(el, o, editorDeps),
      // A currency choice in a <select> the module already has: "Common" then "All currencies" by name, from the codes the
      // server takes (host.locale().currencies), with the current value kept and selected even when the server would not
      // take it now. currencySelect(select, { value, empty, onChange, currencies }): `currencies` overrides the server's list (a page that has its own); `empty` true adds a first "" choice labelled
      // "Default (<the server's currency>)", or give the label as text; onChange(code) on each change ("" for the default).
      // Call it once ready has resolved. Returns { set(value), value, destroy() }; set() refills with that value selected.
      currencySelect: (select, o) => {
        const options = o || {};
        const fill = (value) => {
          const loc = locale();
          const empty = options.empty === true ? `Default (${loc.currency || 'USD'})` : options.empty;
          return fillCurrencySelect(select, { value, currencies: options.currencies || loc.currencies, empty });
        };
        fill(options.value);
        const changed = () => { if (typeof options.onChange === 'function') options.onChange(select.value); };
        select.addEventListener('change', changed);
        // A person sees the kind picker's field and list (a styled, searchable list: the Pickers family); the select stays in the
        // form, hidden, as the value (it is what the module reads and the form sends), and a choice sets it and sends `change`.
        const doc = select.ownerDocument;
        const groupsOf = () => [...select.children].map((n) => (n.tagName === 'OPTGROUP'
          ? { label: n.label, options: [...n.children].map((x) => ({ id: x.value, label: x.textContent })) }
          : { label: '', options: [{ id: n.value, label: n.textContent }] }));
        let quiet = false; // set() chooses without telling the module, as filling the select always did
        const box = doc.createElement('div');
        select.after(box);
        select.hidden = true;
        const field = select.closest('label, .sdk-field');
        const name = ((field && field.querySelector('.sdk-label') && field.querySelector('.sdk-label').textContent) || select.getAttribute('aria-label') || 'Currency').trim();
        const picker = createKindPicker(box, {
          label: name,
          groups: groupsOf(),
          value: select.value,
          onChange: (id) => { if (quiet) return; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); },
        }, editorDeps);
        picker.disabled = select.disabled;
        const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => { picker.disabled = select.disabled; }) : null;
        if (watch) watch.observe(select, { attributes: true, attributeFilter: ['disabled'] });
        return {
          set: (value) => { quiet = true; try { fill(value); picker.setGroups(groupsOf()); picker.set(select.value); } finally { quiet = false; } },
          get value() { return select.value; },
          destroy: () => { select.removeEventListener('change', changed); if (watch) watch.disconnect(); picker.destroy(); box.remove(); select.hidden = false; },
        };
      },
      // A time field that follows the environment's clock (host.locale().clock: 12 or 24 hours) instead of the browser's own, on an
      // <input type="time"> the module already has. The input becomes a text field that shows "10:30 PM" or "22:30" and reads what is
      // typed ("1030", "10:30 pm", "7p", "22:30"); input.value stays "HH:MM" in 24 hours ('' when empty), set or read, so a module's
      // stored values and code do not change. Up and Down move by `step` minutes (5; PageUp and PageDown by an hour), Enter and leaving
      // the field accept what was typed, Escape puts back the last good time (and only then; with nothing to put back it goes on to
      // close the window around it). Text that is not a time is '' and aria-invalid; a time outside min or max is aria-invalid too.
      // `input` and `change` fire once per accepted time, never per typed letter. 44px tall and 16px on a touch screen.
      // The accessible name is the field's <label> (kept live) or `label`.
      //   timeField(input, { label?, min?, max?, step?, onChange? }) -> { value, set(hhmm), min, max, focus(), refresh(), destroy() }
      // `refresh()` redraws the shown time (call it if the clock setting changes while a form is open). Anything but an input throws
      // "host.ui.timeField needs an <input>".
      timeField: (input, o) => {
        if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT') throw new Error('host.ui.timeField needs an <input>');
        const options = o || {};
        const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        const clean = (v) => { const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(v ?? '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
        let min = clean(options.min !== undefined ? options.min : input.getAttribute('min'));
        let max = clean(options.max !== undefined ? options.max : input.getAttribute('max'));
        const step = Number.isFinite(options.step) && options.step >= 1 ? Math.min(Math.round(options.step), 720) : 5;
        let value = clean(native.get.call(input));
        let bad = false;
        let internal = false;
        const clock = () => (locale().clock === '24' ? '24' : '12');
        input.removeAttribute('min');
        input.removeAttribute('max');
        input.type = 'text';
        input.classList.add('sdk-timefield');
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'off');
        if (options.label) input.setAttribute('aria-label', String(options.label));
        else if (!input.closest('label') && !(input.labels && input.labels.length) && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) input.setAttribute('aria-label', 'Time');
        const show = () => {
          input.placeholder = clock() === '24' ? 'HH:MM' : 'h:mm AM';
          native.set.call(input, clockText(value, clock()));
        };
        const judge = () => {
          const out = Boolean(value) && ((min && value < min) || (max && value > max));
          if (bad || out) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
          input.setCustomValidity(bad ? 'Type a time, like 10:30' : out ? 'That time is outside the allowed hours' : '');
        };
        const fire = () => {
          internal = true;
          try {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } finally { internal = false; }
          if (typeof options.onChange === 'function') options.onChange(value);
        };
        // Accept what is in the field: a time, or '' (empty is allowed; text that is not a time is '' and flagged).
        const commit = () => {
          const text = native.get.call(input).trim();
          const next = text ? parseClockText(text, clock(), value) : '';
          bad = Boolean(text) && !next;
          const changed = next !== value;
          value = next;
          if (!bad) show();
          judge();
          if (changed) fire();
        };
        const minutesOf = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
        const nudge = (by) => {
          commit();
          const from = value ? minutesOf(value) : min ? minutesOf(min) - by : 12 * 60 - by;
          const t = (((from + by) % 1440) + 1440) % 1440;
          value = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
          bad = false;
          show();
          judge();
          fire();
        };
        const onInput = (e) => { if (!internal) e.stopImmediatePropagation(); }; // typing is not a change until it is accepted
        const onChange = (e) => { if (!internal) { e.stopImmediatePropagation(); commit(); } };
        const onKey = (e) => {
          if (input.disabled || input.readOnly) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge((e.key === 'ArrowUp' ? 1 : -1) * step); } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); nudge(e.key === 'PageUp' ? 60 : -60); } else if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            if (native.get.call(input) === clockText(value, clock()) && !bad) return; // nothing to put back: Escape goes on (closes the window)
            e.preventDefault();
            e.stopPropagation();
            bad = false;
            show();
            judge();
          }
        };
        const onBlur = () => commit();
        input.addEventListener('input', onInput, true);
        input.addEventListener('change', onChange, true);
        input.addEventListener('keydown', onKey);
        input.addEventListener('blur', onBlur);
        // The module sets and reads input.value as it did on a time input: "HH:MM" in, "HH:MM" out.
        Object.defineProperty(input, 'value', {
          configurable: true,
          get: () => value,
          set: (v) => { value = clean(v); bad = false; show(); judge(); },
        });
        show();
        judge();
        return {
          get value() { return value; },
          set: (v) => { input.value = v; },
          get min() { return min; },
          set min(v) { min = clean(v); judge(); },
          get max() { return max; },
          set max(v) { max = clean(v); judge(); },
          focus: () => input.focus(),
          refresh: show,
          destroy: () => {
            input.removeEventListener('input', onInput, true);
            input.removeEventListener('change', onChange, true);
            input.removeEventListener('keydown', onKey);
            input.removeEventListener('blur', onBlur);
            delete input.value;
            input.type = 'time';
            native.set.call(input, value);
            input.classList.remove('sdk-timefield');
            input.removeAttribute('aria-invalid');
            input.setCustomValidity('');
          },
        };
      },
      // The colour picker (plan-colour-picker.md): an area of saturation and brightness, Hue, Opacity (only where it is kept), the colour as it is,
      // a Hex field, Pick from the screen (only where the browser has an eyedropper that works here), the palette's groups and Recent (the
      // last 8 chosen in this browser for this module, newest first). Drawn in the module's own page, one at a time with host.menu.
      //   colorPicker({ anchor | at, value?, opacity?, palette?, recent?, label?, onInput? }) -> Promise<{ color, opacity } | null>
      //   anchor   an element of the module's page to open under; or at: { x, y } in the module's area, as host.menu.show takes it
      //            (from a toolbar button: { x: e.x, y: 4 }). Clamped inside the module's box; it scrolls inside itself when the box is short.
      //   value    '#rrggbb' to start from (anything else starts on the palette's first colour). opacity: 0 to 100 (default 100), or
      //            false where the opacity is not kept: no Opacity slider is drawn, and the answer's opacity is always 100.
      //   palette  [{ heading, colours: [{ name, color }] }] in place of the default (at most 6 groups, 48 colours). recent: false leaves
      //            Recent out. label: what the dialog is called ("Fill colour"; default "Colour").
      //   onInput  (answer) on each change while it is open, to show it live; save the answer, not these.
      // The answer is { color: '#rrggbb' lower case, opacity: 0..100 }. A swatch or a recent colour answers and closes; Enter in the hex
      // field or a press outside answers what is showing; Escape, or the same call again while it is open (a toggle), answers null.
      // Throws at once: "host.ui.colorPicker needs an anchor or a point"; a bad palette with the palette check's sentence.
      colorPicker: (o) => showColourPicker(o),
      // A colour field on an <input> (type color or text) the module has: the input stays, hidden, holding '#rrggbb'; a trigger (a
      // swatch, the hex in words, a chevron) opens the picker under it. A choice sets the input and sends `input` and `change`;
      // onChange({ color, opacity }) gives both (the input never holds the opacity). Follows a disabled input. onInput({ color, opacity })
      // is for showing live only, as the picker's: each change while it is open, and once more with the field's own colour when the
      // pick ends with nothing chosen, so a preview goes back. Save on the input's change (or onChange), never on onInput.
      //   colorField(input, { palette?, opacity?, recent?, label?, none?, onChange?, onInput? }) -> { value, set(hex), open(), close(), destroy() }
      // none: the words shown while the input holds no colour ("No colour"; an empty swatch); set('') then empties it. Anything but an input throws "host.ui.colorField needs an <input>".
      colorField: (input, o) => colourField(input, o),
      // A view or filter switch, drawn in the toolbar (see host.toolbar.set) -- its most common tool, so
      // this is the one built for every module rather than each writing its own diffing and event wiring.
      // { id, options: [{ id, label?, icon?, regular?, iconOnly? }], value, onChange }: an option needs a
      // label, an icon, or both (see host.toolbar.set's 'tabs' item for what each does). Draws once, then
      // only redraws when the value or the options actually change (call set() every render; it no-ops
      // when nothing did). Returns { set(value, options?), destroy() }.
      // A module may have more than one (whose items, and how they are laid out): every live switch shares the
      // toolbar, drawn in the order they were made, and any one changing redraws the row.
      // Each choice shows its icon and its word, and only its icon while the switch's row is too narrow for the words
      // (the word stays its tooltip and accessible name); a choice with no icon always shows its word.
      // `label` names the switch (its accessible name and its heading in the "More" menu); the host's word is "Tools". Plain text, 30 characters
      // at most; anything else (HTML included) is ignored. Up to 12 options.
      // `zone: 'end'` (here and on host.ui.toolbarButton, and on the items of host.toolbar.set) puts a switch in the row's right zone.
      // The switch is always in the toolbar: the host draws that row wherever the module is drawn.
      viewSwitch: ({ id, options, value, onChange, zone, label }) => {
        let current = value;
        let opts = options;
        const off = host.on('toolbar', (e) => {
          if (e.id !== id) return;
          current = e.value;
          onChange(e.value);
        });
        const mine = { item: () => ({ type: 'tabs', id, value: current, options: opts, ...(typeof label === 'string' && label.trim() ? { label } : {}), ...zoneOf(zone) }) };
        switches.push(mine);
        drawSwitches();
        return {
          set(newValue, newOptions) {
            current = newValue;
            if (newOptions) opts = newOptions;
            drawSwitches();
          },
          destroy: () => {
            off();
            const at = switches.indexOf(mine);
            if (at >= 0) switches.splice(at, 1);
            drawSwitches();
          },
        };
      },
      // The shared outline (plan-templates-redesign.md): an ordered tree of the module's entries { id, parent, order } drawn in `el`, up to
      // `depth` levels (2). The module draws each row's words (row(entry, contentEl, { level, children, folded, canEdit })) and
      // writes a move; the outline only reports it: onMove({ id, parent, order }) (order from host.util.order), then the module calls
      // set(entries) with the new list. Moves: drag the handle, or the handle's menu (Move up, Move down, Indent, Outdent, and the
      // module's own items from menu(entry)), or Alt+Up, Alt+Down, Alt+Right (indent), Alt+Left (outdent) on the focused handle; Up, Down,
      // Home and End walk the handles, Left and Right fold and unfold. On a phone the handle shows as a "..." and only opens the menu.
      // { set(entries), fold(id, folded?), focus(id), destroy() }. See createOutline above for every option.
      outline: (el, o) => createOutline(el, o, { root: env.root, icon: (name) => menuIcon(name), menu: (args) => showMenu(args) }),
      // A small bar and the words "2 of 4": progress(el, { done, total, label?, words?(done, total) }) -> { set({ done, total }), destroy() }.
      progress: (el, o) => createProgress(el, o),
      // The people of the space as chips to tick (one or more): peoplePicker(el, { value, multiple?, onChange(keys) }) ->
      // { get(), set(keys), setPeople(list), ready, destroy() }. It asks host.people() unless `people` ([{ key, name }]) is given.
      peoplePicker: (el, o) => createPeoplePicker(el, o, { people: () => call('people') }),
      // A button in the same toolbar row as the view switches (a chooser that opens a menu, say: Research's Tags),
      // drawn after the switches made before it. { id, label?, icon?, iconOnly?, on?, disabled?, zone?, onClick }. `zone: 'end'`
      // puts it in the row's right zone, after the search and Filters, in the order made ('start' or none: the left; any other value is ignored). onClick gets the
      // 'toolbar' event, whose `x` (when the host gives it) puts a menu under the button: host.menu.show({ at: { x, y: 4 } }).
      // `on` left out: not a toggle (no pressed state, no tick in the folded More menu); on: true or false makes it a toggle, and set({ on }) later does too.
      // Returns { set({ label?, icon?, on?, disabled? }), destroy() }; set() redraws only when something changed.
      // The shared "..." button (ellipsis-vertical, icon centered): a card's menu, a day's, a poll's, a
      // place's. Pass a button you already have (its data-action and listeners stay); omit it to make one.
      // { label } is the accessible name (defaults to the button's aria-label, or "More").
      moreButton: (el, o) => {
        const btn = el && el.nodeType === 1 ? el : document.createElement('button');
        btn.type = 'button';
        btn.classList.add('sdk-icon-btn', 'btn-quiet', 'btn-small');
        const label = String((o && o.label) || btn.getAttribute('aria-label') || 'More');
        if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', label);
        if (!btn.dataset.tip) btn.dataset.tip = label;
        btn.setAttribute('aria-haspopup', 'menu');
        if (!btn.querySelector('[data-icon], .ic, i, svg')) {
          const ic = document.createElement('span');
          ic.className = 'ic';
          ic.setAttribute('aria-hidden', 'true');
          menuIcon('ellipsis-vertical').then((svg) => { if (svg) ic.innerHTML = svg; });
          btn.appendChild(ic);
        }
        return btn;
      },
      toolbarButton: ({ id, label, icon, iconOnly, on, disabled, onClick, zone }) => {
        let state = { label, icon, iconOnly: Boolean(iconOnly), on: on === undefined || on === null ? undefined : Boolean(on), disabled: Boolean(disabled) };
        const off = host.on('toolbar', (e) => {
          if (e.id === id && typeof onClick === 'function') onClick(e);
        });
        const mine = { item: () => ({ type: 'button', id, ...(state.iconOnly && state.icon ? { label: '', title: state.label } : { label: state.label }), icon: state.icon, ...(state.on === undefined ? {} : { on: Boolean(state.on) }), ...(state.disabled ? { disabled: true } : {}), ...zoneOf(zone) }) };
        switches.push(mine);
        drawSwitches();
        return {
          set(next) {
            state = { ...state, ...(next || {}) };
            drawSwitches();
          },
          destroy: () => {
            off();
            const at = switches.indexOf(mine);
            if (at >= 0) switches.splice(at, 1);
            drawSwitches();
          },
        };
      },
    },

    // Whether the viewer has one of this module's own permissions (by its
    // short key in module.json, such as "edit").
    can: (permission) => Boolean(info && info.permissions && info.permissions[permission]),

    get user() {
      return info && info.user;
    },
    // { scope, spaceId, environment: { name }, destination? }: `environment.name` is the environment's name as its header
    // shows it ('' when unknown), for naming the environment's own list (a keyed page has none).
    get context() {
      return info && info.context;
    },

    storage: {
      get: (key, o) => call('storage.get', { key, ...opts(o) }),
      // set(key, value, { version }) -- pass the version you read to detect a
      // change made since; a conflict rejects with error.status 409 and
      // error.current holding what is stored now.
      // `tz`: the time zone the value's clock times are in (an IANA name), when it is not the person's own.
      set: (key, value, o) => call('storage.set', { key, value, version: o && o.version, ...(o && typeof o.tz === 'string' ? { tz: o.tz } : {}), ...opts(o) }),
      delete: (key, o) => call('storage.delete', { key, version: o && o.version, ...opts(o) }),
      list: (prefix, o) => call('storage.list', { prefix: prefix || '', ...opts(o) }),
    },

    // The spaces the viewer belongs to that have this module on, on a module's environment page:
    // [{ id, name, icon, svg }] (`svg` is the space's icon as inline SVG, since a module cannot
    // load the icon font). Read stored data across them with storage.list(prefix, { scope: 'spaces' }),
    // which returns each item with its `spaceId`; 'change' events for those spaces carry `spaceId` too.
    spaces: () => call('spaces'),
    // The space this module is open in: { id, name, createdAt, phases }, or null on an environment page or a keyed page.
    // `phases` is the dates set on the space's timeline, { <id>: { start?, end? } } ({} while none; the template's phases
    // themselves are host.phases(), the rule public/phases.js). Answered from the hello, so it is there once host.ready()
    // has resolved. `budget` is the space's budget target, { amount, currency? } (set by an owner in Set up; `currency`
    // absent means the module's own currency), or null while none is set (always null for a guest); kept current, and
    // host.on('space', fn) hears ({ budget }) when it changes. A module that reads it says `"budget": true` in its
    // module.json, so Set up offers the target while it is on.
    space: () => (info && info.space) || null,
    // Facts about the environment this module is in, answered from the hello, so they are there once host.ready() has
    // resolved. `pictureMap`: while the owner has set a picture map (an invented world drawn from a picture, Maps'
    // "Picture map" setting), { file, minZoom, maxZoom, tileType } -- `file` is the PMTiles file's name in the module's
    // `image-map` folder, read with host.files.url(file, { folder: 'image-map' }); else null. Every module is told, so
    // one that shows real-world things (a place search, a link to a maps app) can leave them out on an invented world.
    // An object, not a function: `host.environment.pictureMap`. { pictureMap: null } until the hello has answered. Live:
    // when the owner sets, replaces or clears the picture map, this answers the new value and host.on('environment', fn)
    // hears it ({ pictureMap }), so a module redraws what depends on it without a reload.
    get environment() { return { pictureMap: (info && info.environment && info.environment.pictureMap) || null }; },
    // The environment's template's phases, [{ id, label, main?, icon?, color }], or [] when it has none (`color` the phase's own
    // '#rrggbb', or its place's default, public/phases.js colorOf), with their state under the
    // template's measure. The list has a `measure` property: 'dates' (the default; no state), 'progress' (each phase has
    // `done`, the owner's Done switch) or 'goals' (`done` too, and `goals: { done, total }` while planner entries name the phase: it is
    // done when they all are; else the switch). Under progress and goals the first phase not done has `current: true`.
    // Live: a template edit is in the next hello, a switch or an entry in the next look; host.on('phaseStates', ({ phases,
    // measure })) says when it changed. Answered from the hello, so it is there once host.ready() has resolved.
    phases: () => Object.assign((info && Array.isArray(info.phases) ? info.phases : []).map((p, i) => (global.Phases ? { ...p, color: global.Phases.colorOf(p, i) } : { ...p })), { measure: (info && info.phaseMeasure) || 'dates' }),
    // The main phase's end moved later to cover `day` (YYYY-MM-DD), every later boundary shifted with it (POST
    // /api/spaces/:id/phases/cover; plan-one-bar.md step 2), for anyone with write in a module on in this space.
    // Resolves with the space's new phases, or null when nothing moved (the day is covered already, is before the
    // main phase, or the main phase has no start). host.space().phases is kept current.
    phasesCover: async (day) => {
      const result = await call('phases.cover', { day });
      const phases = result && result.phases && typeof result.phases === 'object' ? result.phases : null;
      if (phases && info && info.space) info.space.phases = phases;
      return phases;
    },

    // The space's budget target, for a module that reads it (`"budget": true` in its module.json). `can()` resolves true when
    // this person may change the target: the space's owner, the admin, or a moderator of this space (false for everyone
    // else, a guest included, and outside a space). `set({ amount?, currency? })` saves it and resolves with the target the
    // server kept (host.space().budget is current and 'space' is heard); `set(null)` clears it. The server replaces the
    // WHOLE target with what it is sent, so a currency sent alone drops the stored amount: send the amount with it. A refusal
    // rejects with the server's sentence.
    budget: {
      can: async () => (await call('budget.can')) === true,
      // Whether another module that reads the budget target (it says `"budget": true`) is on in this space and open to this
      // person. The Planner uses it to step its own money aside for the module that pulls its costs in. Never names a module.
      elsewhere: async () => (await call('budget.elsewhere')) === true,
      set: async (target) => {
        if (target === undefined) throw new Error('say the target, or null to clear it');
        const kept = await call('budget.set', { budget: target });
        if (info && info.space) info.space.budget = kept && typeof kept === 'object' ? kept : null;
        return kept && typeof kept === 'object' ? kept : null;
      },
    },

    // Files an admin placed for this module (a `file` setting names one). `url(name)` is the address to read it from,
    // range requests included, for a module running in the page (a frame cannot fetch).
    // `url(name, { folder })`: pass the setting's folder too when two of the module's folders could hold the same name
    // (Maps' picture map is in `image-map`, its map data in `map-tiles`).
    // `open(pointer, { list, name })` opens a library file (the Vault's, a pointer of kind `file`) in a file window over the page (the
    // app's own viewer; several can be open, at most four). `list` is the ids of the files to walk with Previous and Next, in the order
    // to walk them (the Vault's list as filtered); without it the window has no Previous and Next. It answers true when a window
    // opened or came forward, false at the cap (the person is told). It refuses (status 403) a pointer to a file in another space than this
    // module's own, and a module that is not the library itself unless its manifest consumes the file kind and an owner approved it. When the window closes, focus returns to the module's frame
    // and the module hears the event 'fileclosed' ({ id }), so it can put focus back on what opened the file.
    files: {
      url: (name, o) => call('files.url', { name, ...(o && o.folder ? { folder: o.folder } : {}) }),
      open: (pointer, o) => call('files.open', { ref: pointer, list: o && o.list, name: o && o.name, info: Boolean(o && o.info) }),
      // Files of the space's library (the Vault; plan-attachments-vault.md, sections 4 and 5), for a module that links its objects to
      // them. The module's manifest consumes the file kind (`"vault:file"` or `"*"`) and an owner approved it, as for any object; a
      // module that was not approved is refused (403) and finds, resolves and links nothing. Nothing here names the library module.
      //
      //   pick({ multiple?, title? }) -> pointers[]   The object picker, kept to files: search, tick, Pick. Resolves the chosen
      //                                               pointers ([] when the person cancels; at most one without `multiple`). Rejects with
      //                                               "There is no Vault in this {space}." when no library is on here for this module.
      //   link(object, pointers)   Add files to what the object points at (`object` from host.objects.make()), whatever else it points at.
      //   unlink(object, pointers) Take them out. Both go through host.objects.setLinks, so "Where it is used" (the Vault's Remove
      //                            question, host.library.uses) comes from them. The module keeps its own list of the pointers it shows.
      //   resolve(pointers) -> [{ ref, name, group, type, size, icon, viewable?, state? }]  in the same order. `state` is 'removed' (the file is
      //                            gone: its link stays and reads "File removed"), 'missing' (its bytes are gone: "File missing"),
      //                            'hidden' ("Not available to you"); without it the file is there. Only `ref` and `state` for the last two.
      //   open(pointer, { list })  (above) -- also what host.objects.open does for a file pointer.
      pick: async (o) => {
        const t = o && typeof o === 'object' ? o : {};
        const kinds = await call('objects.kinds', {});
        if (!Array.isArray(kinds) || !kinds.some((k) => k && k.kind === 'file')) throw Object.assign(new Error(`There is no Vault in this ${locale().words.space.one}.`), { status: 404 });
        const got = await host.objects.pick({ kinds: ['file'], multiple: t.multiple === true, title: t.title === undefined ? 'Add a file' : String(t.title).slice(0, 120) });
        const list = got === null || got === undefined ? [] : Array.isArray(got) ? got : [got];
        return list.map(cleanRef).filter((r) => r && r.kind === 'file');
      },
      link: (object, pointers) => fileLinks(object, pointers, 'add'),
      unlink: (object, pointers) => fileLinks(object, pointers, 'remove'),
      resolve: (pointers) => resolveFiles(pointers),
    },

    // AI, asked of the server (declare the `ai` hook; the admin approves it like the others). The admin chooses the service and
    // keeps its key on the server; a page never sees either. `available()` -> { available, why } (say why a button is hidden);
    // `ask({ task, question, objects })` where task is 'summarise', 'ask' or 'tags' and objects are pointers ({ module, kind, scope, id }),
    // read by the server as the person asking. Answers: { text, summaries, used, tags, tokens }. `text` holds the model's words with a
    // line {{summary:0}} where each summary goes; `summaries` are checked ({ icon, title, content, tags, place, date, links, sources },
    // sources as pointers). Nothing is kept by the server. The model has no tools and nothing it says is run.
    ai: {
      available: () => call('ai.available'),
      ask: (o) => {
        // The hard break (plan-names step 7): the pointers are `objects`; `items` is refused, never translated.
        if (o && o.items !== undefined) return Promise.reject(Object.assign(new Error('host.ai.ask: "items" is an old name; use objects'), { status: 400 }));
        return call('ai.ask', { task: o && o.task, question: o && o.question, objects: o && o.objects });
      },
      // Bookings read out of pasted text (a confirmation email, a ticket), in a space only: `extract({ text, trip, kinds })`.
      // `text` up to 30,000 characters; `trip` optional { name, first, last, timeZone, currency } (days as YYYY-MM-DD, an IANA
      // zone, a three-letter code); `kinds` optional, narrowing the kinds read. Answers { objects, notes, unread, dropped, cut,
      // tokens }: `objects` in the objects format (hand each to an action that takes it), `notes[i]` the sentences object i's row
      // should show, `unread` what could not be read, `dropped` how many were left out. Nothing is written and the text is not
      // kept; show the person the result before anything is added. No booking in the text rejects with status 422, the error's `unread` holding the sentences it could not read.
      extract: (o) => {
        const t = o && typeof o === 'object' ? o : {};
        if (typeof t.text !== 'string') return Promise.reject(Object.assign(new Error('host.ai.extract: text must be a string'), { status: 400 }));
        return call('ai.extract', { text: t.text, trip: t.trip, kinds: t.kinds });
      },
    },

    // The person's own other calendars (declare the `external` hook; the admin approves it like the others). Each person
    // adds theirs on Profile by a private address; the server reads them and keeps the events in memory. Read only, and
    // only ever the signed-in person's own: never store them, publish them or send them anywhere.
    //   events({ from, to })  from and to as YYYY-MM-DD (or ISO times), either optional ->
    //                         { calendars: [{ id, name }], events: [{ calendar, uid, title, start, end, allDay }] }
    //                         An all-day event's start and end are YYYY-MM-DD, `end` its last day; a timed event's are ISO
    //                         times, `end` possibly null. A repeating event comes once per occurrence, with the same uid.
    //                         A guest, or the environment's switch off: both lists empty.
    // The 'external' event (host.on('external', fn)) says they changed: ask again.
    external: {
      events: (o) => call('external.events', { from: o && o.from, to: o && o.to }),
    },

    // Ask in Chat on a space's canvas: posts a private /ai question (the reply shows only to the person who asked).
    // `refs` are optional objects the answer may use, the same pointers host.ai.ask takes as `objects`. With a ref and no
    // question (`question: ''`) the server asks its own: What should I know about <the object's title>?
    //   available()  -> { available }   false off a space's canvas (a module's own page), where ask rejects: hide the button there.
    //   attach({ label, text } or { label, ref })  -> { attached: true }
    //                 Puts words or an object in Chat's box as one chip the person can take off, opens the Assistant view and
    //                 sends NOTHING: the person presses Send, with or without a question, and only then does it go (an empty
    //                 question with attached words asks "Explain this."). `label` is the chip's name (up to 60 characters);
    //                 `text` is plain text up to 8,000 characters (control and direction characters are taken out, and it is
    //                 drawn as text, never HTML); `ref` is a pointer to an object of this space. Exactly one of text or ref. It
    //                 needs no permission. A second attach of words replaces the first. Rejects with a sentence off a space's
    //                 canvas, for a guest or a space with the AI off, over the limit, or another space's object. A picture is
    //                 not yet attachable. ask() never carries what attach held.
    chat: {
      available: () => call('chat.available', {}),
      // ask() sends at once and takes a question and objects only; words or a picture given to it are refused (use attach).
      ask: (o) => call('chat.ask', { question: o && o.question, refs: o && o.refs, attached: o && o.attached, text: o && o.text, picture: o && o.picture }),
      attach: (o) => call('chat.attach', { label: o && o.label, text: o && o.text, ref: o && o.ref, picture: o && o.picture }),
    },

    // Pictures people add (a module declares `uploads` in module.json). The server checks each from its own bytes and takes out
    // what rides along (text, thumbnails, maker notes); a photo's position is dropped unless `keepPosition` is true. Make the
    // picture the size you want first (about 2000 px on the long edge) and a thumbnail (about 400 px) in the page.
    //   put(blob, { name, keepPosition, scope })  -> { id, name, type, size, by, at, taken, camera, hasPosition, position, hasThumb }
    //   thumb(id, blob, { scope })                the thumbnail for a file you put
    //   list({ scope }), remove(id, { scope }), url(id, { thumb, scope })  (the address to use as an <img> source)
    // `hasPosition` says the photo carried one, so you can offer to keep it (put it again with keepPosition). Remove a file when
    // you remove the object that shows it.
    uploads: {
      put: (file, o) => call('uploads.put', { file, name: o && o.name, keepPosition: !!(o && o.keepPosition), scope: o && o.scope }),
      inspect: (file, o) => call('uploads.inspect', { head: file, scope: o && o.scope }), // -> { type, taken, camera, hasPosition, position }: read before you resize, which loses them
      thumb: (id, file, o) => call('uploads.thumb', { id, file, scope: o && o.scope }),
      list: (o) => call('uploads.list', { scope: o && o.scope }),
      remove: (id, o) => call('uploads.remove', { id, scope: o && o.scope }),
      url: (id, o) => call('uploads.url', { id, thumb: !!(o && o.thumb), scope: o && o.scope }),
    },

    // A library's files (a module that declares `library: true`, the Vault; plan-attachments-vault.md): the space's files, kept by the
    // server, each checked from its own bytes. All in the space the frame is in.
    //   list()                       -> { files: [{ id, name, type, group, size, by, at, taken?, hasThumb, uses, viewable? }], usage: { bytes, maxBytes } }
    //       `viewable: false` is only on a PDF kept as download only (the server could not check it): never open it in the
    //       app, show "This PDF can't be opened here. Download it." with download(id). Every other file has no `viewable`.
    //   add(blob, { name, keepPosition, visibility, people, onProgress })  -> the file. `onProgress({ loaded, total })` while it is sent; the promise has `.cancel()`.
    //       A picture keeps where it was taken only when `keepPosition` is true. Rejects with the server's sentence (a type or limit refused).
    //       `visibility` is who may see it: 'everyone' (the default), 'only-me' or 'people' (with `people`, the user keys of
    //       members of this space, at most 200). The server refuses anything else. Owners and the admin always see every file.
    //   pickPeople({ chosen })       opens the people picker over the page ("Who can see this": search, tick, at most 200) and resolves the
    //       user keys the person chose, or null when they cancel. `chosen` are the keys ticked when it opens. The adder is always in.
    //       A file's visibility and `people` come back in its record only for the person who added it, owners and the admin.
    //   rename(id, name), remove(id), uses(id) -> { uses: [summary], hidden }, thumb(id, blob) (the small picture you made, of at most 300 KB)
    //   url(id, { thumb, download }) the address; blob(id, { thumb }) -> a Blob of the file or its small picture.
    //       A PDF is never shown from its address (it is always sent as a download): blob(id) its bytes and hand them to
    //       the app's PDF viewer (GET /viewer/pdf in a sandboxed frame; its protocol is at the top of
    //       public/sdk/pdf-viewer.mjs) as { type: 'open', data: await blob.arrayBuffer() }. blob(id) of a download-only
    //       PDF rejects with status 404: check `viewable` first.
    //   download(id)                 the host saves the file (a frame cannot start a download itself); needs `download`
    //   share([id])                  opens the share sheet over the page for these files (the person needs the `share` permission);
    //       Make link shows the address once, with Copy. Resolves when the sheet is up; the module hears 'sharechanged' when a link
    //       is made, changed or turned off, and asks list() again (each file then has `shared: true|false`, for people with `share`).
    //   shares()                     opens the list of the space's share links over the page (Turn off, Edit, Choose files);
    //       the module hears 'sharechoose' when the person presses Choose files there (start choosing files).
    library: {
      list: () => call('library.list'),
      add: (file, o) => {
        const opts = o || {};
        const token = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
        const off = typeof opts.onProgress === 'function' ? host.on('libraryprogress', (e) => { if (e && e.token === token) opts.onProgress({ loaded: e.loaded, total: e.total }); }) : null;
        const out = call('library.add', { file, name: opts.name, keepPosition: Boolean(opts.keepPosition), visibility: opts.visibility, people: opts.people, token }).finally(() => { if (off) off(); });
        out.cancel = () => { call('library.cancel', { token }).catch(() => {}); };
        return out;
      },
      pickPeople: (o) => call('library.pickPeople', { chosen: o && o.chosen }),
      rename: (id, name) => call('library.rename', { id, name }),
      remove: (id) => call('library.remove', { id }),
      uses: (id) => call('library.uses', { id }),
      thumb: (id, blob) => call('library.thumb', { id, file: blob }),
      url: (id, o) => call('library.url', { id, thumb: Boolean(o && o.thumb), download: Boolean(o && o.download) }),
      blob: (id, o) => call('library.blob', { id, thumb: Boolean(o && o.thumb) }),
      download: (id) => call('library.download', { id }),
      // Opens the browser's print dialog for a picture or a PDF (Save as PDF is there too); needs the same right as download. Other kinds are refused.
      print: (id) => call('library.print', { id }),
      share: (ids) => call('library.share', { ids }),
      shares: () => call('library.shares'),
    },

    // The module's settings, as chosen for this viewer here: { key: value }, with the module's own default for what
    // nobody has chosen. Declared in module.json (`settings`); the host draws the forms (an owner's for the environment, a
    // space's moderators' for a space, each person's own) and keeps the values. `onChange(fn)` calls fn(values) when any of
    // them changes.
    settings: {
      get: () => call('settings.get'),
      onChange: (fn) => host.on('settings', () => call('settings.get').then(fn).catch(() => {})),
    },

    // Place search, asked of the server (for a module whose manifest declares `geocoder`). `search(q, near)` answers
    // { results: [{ key, title, sub, lat, lng, from }], configured, credit }; `used(key)` marks a result as picked.
    geocode: {
      search: (q, near) => call('geocode.search', { q, lat: near && near.lat, lon: near && near.lon }),
      used: (key) => call('geocode.used', { key }),
    },

    // Lookups asked of the server (for a module whose manifest declares `"lookups": ["flight"]`):
    //   flight(number, date)        -> { flights: [{ object, line, sameWeekday, lastSeen }] }, empty when nothing is known;
    //                                  throws with the server's error ("bad number", "bad date", or the limit's sentence)
    //   airport(code)               -> { code, name, city, tz }, or null when there is no such airport
    //   available('flight')         -> true or false (false when the environment turned the suggestions off, or on any failure)
    //   remember('flight', object)  a saved flight, in the objects format, taught to the server's schedule; never throws
    lookup: {
      flight: (number, date) => call('lookup.flight', { number, date }),
      airport: (code) => call('lookup.airport', { code }),
      available: (kind) => call('lookup.available', { kind: kind || 'flight' }).then((r) => r === true, () => false),
      remember: (kind, object) => call('lookup.remember', { kind: kind || 'flight', object }).then(() => undefined, () => undefined),
    },

    // A page's title, description and image, read by the server for a link someone is adding. Answers
    // { enabled, title, description, image }. `enabled` is false until the module's link previews setting is on.
    preview: {
      link: (url) => call('preview.link', { url }),
      image: (url) => call('preview.image', { url }),
    },

    // The people of the space this module is in: [{ key, name }] (empty outside a space's canvas). For choosing a person
    // ("whose is it"): store their `key`, never the name.
    people: () => call('people'),

    // Who is online right now, everyone, for a page that follows people (a keyed page about one of them):
    // { people: [{ key, name, online, space, aside, asidePrivate, elsewhere, inCall, isOwner }], spaces: [{ id, name }],
    //   asides: [{ id, origin, private }], activeSpace, ownerOnline, reactions: [{ id, glyph }] }.
    // A person's place is as this viewer may know it: `space` is a space or aside they share with the viewer, else null;
    // `aside` is true while they are in an aside (`space` is then the aside's id, or the space it came out of), and
    // `asidePrivate` whether that aside is a private conversation (never with whom);
    // `elsewhere` is true when they are online somewhere the viewer is not told of. `activeSpace` may be null.
    // An aside's `origin` is the space it came out of.
    // `onChange(fn)` asks every 5 seconds (`{ every }` in ms to change that) and calls fn(presence) when anything
    // differs, once at the start; it returns a function that stops asking.
    // `get({ space })` answers `reactions` as that space reads them (its template's additions too), for a space the viewer may enter.
    presence: {
      get: (o) => call('presence.get', { space: o && o.space }),
      onChange: (fn, o) => {
        let last = '';
        let on = true;
        const tick = async () => {
          if (!on) return;
          try {
            const p = await call('presence.get');
            const sig = JSON.stringify(p);
            if (sig !== last) {
              last = sig;
              fn(p);
            }
          } catch {
            // the next tick asks again
          }
        };
        tick();
        const timer = setInterval(tick, (o && o.every) || 5000);
        return () => { on = false; clearInterval(timer); };
      },
    },

    // One person's picture in a slot, as a blob URL to show (null when they have none there), and release it when
    // done. Slots are the profile's: profile, background, player, playerOffline, playerTalking, playerMuted, playerAside,
    // playerPrivate, character, characterOffline, talking, muted, characterAside, characterPrivate. `{ space }` asks for
    // that space's own picture set first, the way the call page shows them.
    // The profile slot always answers (an initials plate when no photo is set); `{ fallback: 'none' }` asks for the real
    // photo only, null otherwise, for a page that wants it only as a last resort behind the Participant pictures.
    images: {
      get: (key, slot, o) => { try { refuseOld(o, 'host.images.get'); } catch (err) { return Promise.reject(err); } return call('images.get', { key, slot, space: o && o.space, fallback: o && o.fallback }); },
      release: (url) => call('images.release', { url }),
    },

    // Watch one person's camera and microphone, read-only, following them from space to space (a module that runs
    // in the page only). `watch(key, { video, audio, space }, handlers)` connects as a viewer and calls
    // handlers.state({ online, cameraOn, micOn, speaking, name }), handlers.video(element or null) and
    // handlers.audio(element or null) with elements to place, handlers.reaction(id) as they react, and
    // handlers.connection({ connected, space }). It resolves to { follow(spaceId), stop() }. With `video: false` and
    // `audio: false` only the state is followed.
    media: {
      watch: (key, o, handlers) => (o && o.room !== undefined ? Promise.reject(Object.assign(new Error('host.media.watch: "room" is an old name; use { space }'), { status: 400 })) : call('media.watch', { key, video: !(o && o.video === false), audio: Boolean(o && o.audio), space: (o && o.space) || 'lobby', handlers: handlers || {} })),
    },

    // The server's access key, the one a keyed page's link carries (`/<path>/<key>?s=<access key>`): null unless the
    // viewer runs the environment (an owner, or the host admin). `regenerate()` makes a new one, so every link made with the old one stops working.
    access: {
      key: () => call('access.key'),
      regenerate: () => call('access.regenerate'),
    },

    // The module's own page. `open(hash, { newTab })` asks the host to open it at a place in it ("day=2026-09-24":
    // letters, digits and = & _ . : , - only), which a widget uses for a click that means "show me this in full" (on
    // home, where the tile's heading goes: the destination it is a part of while that shows); `newTab: true` for a click
    // that asked for a new tab (Ctrl or Cmd, the middle button);
    // `onHash(fn)` is called on the page with that place when it is opened that way (and again if it changes).
    page: {
      open: (hash, o) => call('page.open', { hash, newTab: Boolean(o && o.newTab) }),
      onHash: (fn) => host.on('pagehash', (e) => fn(e.hash)),
    },

    // Objects: pointing at another module's objects without reaching into its data. A module lists what
    // it shares (produces) and what it wants to link to (consumes) in module.json (its `refs` section); an admin approves
    // the latter. A pointer is { module, kind, id, scope: 'space' | 'environment' | 'person', space? }: store it, never
    // a copy of the object. resolve() asks the host for the object's summary (title, subtitle, when, end,
    // allDay, done, module) or an { error, status } when it is gone or the viewer may not see it, so
    // a pointer is only ever as revealing as the viewer's own access.
    objects: {
      // A pointer to one of this module's own objects, for a drag or to store.
      make: (kind, id, o) => {
        refuseOld(o, 'host.objects.make');
        const ctx = (info && info.context) || {};
        // { space } names another space's object (a module's environment page showing the spaces it belongs to).
        const otherSpace = o && o.space;
        const personal = o && o.scope === 'person';
        const environment = !personal && !otherSpace && ((o && o.scope === 'environment') || ctx.scope !== 'space');
        const ref = { module: info && info.module && info.module.id, kind, id: String(id), scope: personal ? 'person' : environment ? 'environment' : 'space' };
        if (!environment && !personal) ref.space = otherSpace || ctx.spaceId;
        return ref;
      },
      // One pointer, or a list, to summaries. A list keeps its order.
      resolve: async (pointers) => {
        const list = Array.isArray(pointers) ? pointers : [pointers];
        // the host answers up to 50 at a time.
        const summaries = [];
        for (let i = 0; i < list.length; i += 50) summaries.push(...await call('objects.resolve', { refs: list.slice(i, i + 50) }));
        return Array.isArray(pointers) ? summaries : summaries[0];
      },
      // The kinds of other modules' objects this module may link to: [{ module, moduleName, icon, kind, name, open }].
      // A module written after this one appears here with no change to this one, so use it (and the
      // summaries' own module and kind) rather than naming other modules in your code.
      kinds: () => call('objects.kinds', {}),
      // Show an object in the module that owns it (it opens on the canvas, and it is asked to show the object). The
      // summary says whether it can: summary.open. `{ newTab: true }` for a click that asked for a new tab (Ctrl or Cmd,
      // the middle button): a page that can (home) opens it in one; any other shows it as usual.
      // A pointer to a library file (kind `file`) opens the file window over the canvas instead, after the same check as host.files.open;
      // `{ list }` is the ids of the files linked on the object it was opened from, so Previous and Next walk those (else they are hidden).
      open: (ref, o) => call('objects.open', { ref, newTab: Boolean(o && o.newTab), ...(o && Array.isArray(o.list) ? { list: o.list.filter((id) => typeof id === 'string').slice(0, 2000) } : {}) }),
      // For a module that owns objects: called when someone asks to see one of them (host.objects.open from
      // another module): open it. The pointer is checked for shape and points at one of your own objects.
      onOpen: (fn) => {
        const off = host.on('objectopen', (e) => {
          const ref = e && e.ref && cleanRef(e.ref);
          if (ref) fn(ref);
        });
        if (pendingOpen) {
          const p = pendingOpen;
          pendingOpen = null;
          setTimeout(() => { const ref = p.ref && cleanRef(p.ref); if (ref) fn(ref); }, 0);
        }
        return off;
      },
      // Tell the host what one of your objects points at (`from` is a pointer to it, from make(); `to` is the
      // list of pointers it now points at, replacing the last), so the objects pointed at can ask what points
      // at them. Only pointers are kept, and only what the viewer may see is ever shown.
      // `{ space }` says the object is in that space (a module's environment page linking one of a space's objects);
      // the pointer from make() already carries it, so it is only a check.
      // `{ kind: 'file' }` changes only the links to objects of that kind and leaves the rest as they are; with it `{ op: 'add' }` or
      // `{ op: 'remove' }` adds `to` to those links or takes it out instead of replacing them (host.files.link and unlink do this).
      setLinks: (from, to, o) => call('objects.setLinks', { from, to, ...(o && o.space ? { space: String(o.space) } : {}), ...(o && o.kind ? { kind: String(o.kind) } : {}), ...(o && (o.op === 'add' || o.op === 'remove') ? { op: o.op } : {}) }),
      // What points at one of your objects (its kind must have "backlinks": true in module.json), and what
      // one points at: summaries. The 'links' event says when to ask again.
      linksTo: (ref) => call('objects.links', { ref, dir: 'to' }),
      linksFrom: (ref) => call('objects.links', { ref, dir: 'from' }),
      // What points at each of several of this module's objects, in one request: [{ ref, summaries }] (only those something points at).
      linksToAll: (refs) => call('objects.linksToAll', { refs }),
      // Other modules' objects that show on a calendar as markers (a kind marked "marker": true beside "dated" in its
      // module.json): a task due on a day, a poll's closing time. Read through the kinds this module consumes (as
      // approved), in this module's place: in a space, that space's; on the environment's page, the environment's and
      // each space the viewer belongs to. from and to are YYYY-MM-DD or ISO times, at most 92 days apart. Resolves to
      // [{ ref, kind, title, start, allDay, due, past, module: { id, name, icon, color, svg } }] (`due`: the kind is dated
      // by a due day, not a moment; `color`: the module's tint or null; `svg`: its icon as inline SVG, or null): `start`
      // is YYYY-MM-DD when allDay, else
      // milliseconds. Done objects are left out; at most 500. Never store or edit them: open one with open(ref).
      // The 'markers' event (host.on('markers', fn)) says one changed: ask again.
      markers: (o) => call('objects.markers', { from: o && o.from, to: o && o.to }),
      // A linked object changed (`updated`) or was deleted (`deleted`). Only a module that points at it is told.
      onChange: (fn) => host.on('refchange', (e) => fn({ ref: e.ref, change: e.change })),
      // Objects this module may link to (kinds it consumes), matching the text, in this place
      // or (from a space) { scope: 'environment' }. Each is a summary with its pointer in summary.ref. On a module's
      // environment page { scope: 'spaces' } asks every space the viewer belongs to at once (each pointer carries its
      // space), and { has: 'place' } keeps only summaries with a place (up to 1,000 then, rather than 50).
      // { scope: 'environment', in: <space id> } finds the environment's objects marked for that space (plan-places-library.md).
      search: (text, o) => call('objects.search', { q: text || '', ...opts(o), ...(o && o.has ? { has: String(o.has) } : {}), ...(o && o.kind ? { kind: String(o.kind) } : {}), ...(o && o.in ? { in: String(o.in) } : {}) }),
      // A window the host draws to choose another module's object: a search box (the person's own permissions, the same search as
      // search() above), the results as rows with each kind's icon, and on a phone a full-height sheet. Keyboard: type to search,
      // Up and Down move, Enter chooses, Escape or Close cancels. Resolves with the object's pointer (a ref), or with a list of
      // pointers when `multiple` is true (chosen with ticks, then the Pick button), or null when the person cancels.
      //   pick({ modules?, kinds?, scope?, space?, title?, multiple? }) -> ref | ref[] | null
      //   modules: ['maps'] keeps only those modules' objects; kinds: ['place'] only those kinds ("kind" or "module:kind");
      //   scope and space are search()'s; title is the window's name (default "Pick an object", in the environment's word for it).
      // It does not store anything. Keep the ref (host.objects.setLinks if it should be linked) and resolve() it for its title.
      pick: (o) => {
        const t = o && typeof o === 'object' ? o : {};
        refuseOld(t, 'host.objects.pick');
        const list = (v, what) => {
          if (v === undefined || v === null) return [];
          if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) throw Object.assign(new Error(`host.objects.pick: ${what} is a list of names`), { status: 400 });
          return v.slice(0, 20);
        };
        try {
          return call('objects.pick', { modules: list(t.modules, 'modules'), kinds: list(t.kinds, 'kinds'), title: t.title === undefined ? '' : String(t.title).slice(0, 120), multiple: t.multiple === true, ...opts(t) });
        } catch (err) { return Promise.reject(err); }
      },
      // The costs other modules hold in this space (the summaries that carry an `amount` or a `planned` amount: title, when, amount, planned?, paidBy?,
      // sharedBy? (none: everyone), module, ref), as the person may read them: { summaries, withheld }. `withheld` is how many
      // priced objects were left out because the person may not read their module (a number, never a title or figure). Read
      // only; never copy them into storage. Open one with open(summary.ref). Empty outside a space.
      priced: () => call('objects.priced', {}),
      // The published objects format (instructions in this environment's words, and the schema).
      format: () => call('objects.format', {}),
      // Whether this person may bring objects into this place with this module.
      checkAvailable: () => call('objects.checkAvailable', {}),
      // Read objects out of a pasted answer (a string) or a file (a Blob or File). Stores nothing.
      check: (input) => {
        if (typeof input === 'string') return call('objects.check', { text: input });
        if (typeof Blob !== 'undefined' && input instanceof Blob) return call('objects.check', { file: input });
        return Promise.reject(Object.assign(new Error('paste an answer or choose a file first'), { status: 400 }));
      },
      // Start a drag carrying a pointer to one of this module's objects: call it from a dragstart handler.
      drag: (event, kind, id, o) => {
        const ref = host.objects.make(kind, id, o);
        event.dataTransfer.setData(OBJECT_MIME, JSON.stringify(ref));
        if (o && o.label) event.dataTransfer.setData('text/plain', String(o.label));
        event.dataTransfer.effectAllowed = 'copyLink';
        // Tell the host, which brokers the drop onto the other modules on the page (see dropTarget).
        call('objects.dragStart', { ref }).catch(() => {});
        event.target.addEventListener('dragend', () => call('objects.dragEnd', {}).catch(() => {}), { once: true });
        return ref;
      },
      // A line on the page's drag trace, when tracing is on (open the host with ?debug=1); does nothing otherwise.
      trace: (msg) => {
        if (info && info.debug) call('objects.trace', { msg: String(msg).slice(0, 160) }).catch(() => {});
      },
      // The element of this module under a point given by dropTarget (its own coordinates), or null.
      elementAt: (pt) => env.elementAt(pt),
      // Make objects draggable onto other modules: `root` holds them, and `resolve(target)` says what the pressed
      // element is: { kind, id, label, ...the options make() takes } for one of your objects, or, for something
      // you have not stored (an answer the AI wrote), { summary: { title, kind?, content?, place?, date? }, label? }, or null. The drag
      // is driven by the pointer (press, move a few pixels, let go), not the browser's drag and drop, which is
      // unreliable between sandboxed frames; the host shows the label at the pointer and hands the drop to
      // the module under it (see dropTarget). Mouse and pen; on a touch screen search is the way to link.
      draggable: (root, resolve) => {
        const say = (msg) => host.objects.trace(msg);
        // The pointer in the module's own coordinates (a frame's are already; in the page they are shifted).
        const local = (e) => (env.localPoint ? env.localPoint(e.clientX, e.clientY) : { x: e.clientX, y: e.clientY });
        say('draggable ready');
        let down = null;
        let dragging = false;
        let sent = 0;
        let payload = null;
        // Over this module's own frame the host has nothing to do (it hands a drag to the *other* modules): the
        // drag is delivered here directly, as dropTarget's over, leave and drop, so a module's own objects can be
        // dropped on itself (an object of a plan moved between its days) through the one dropTarget it already has.
        let insideOwn = false;
        const overOwn = (e) => {
          const r = env.rootElement && env.rootElement.getBoundingClientRect ? env.rootElement.getBoundingClientRect() : null;
          return Boolean(r) && e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
        };
        const own = (type, e) => emit('objectdrag', { type, ...(type === 'leave' ? {} : { ...local(e), ref: payload.ref || null, summary: payload.summary || null }) });
        root.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || e.pointerType === 'touch' || e.target.closest('input, textarea, select')) return;
          const pressed = resolve(e.target);
          say(pressed ? (pressed.summary ? 'pressed a summary' : `pressed ${pressed.kind} ${pressed.id}`) : 'pressed something that is not draggable');
          if (!pressed) return;
          down = { id: e.pointerId, x: e.clientX, y: e.clientY, pressed, el: e.target };
          // Follow the pointer from the first press, even when it leaves this module's frame at once.
          try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* it is followed while inside */ }
        });
        window.addEventListener('pointermove', (e) => {
          if (!down || e.pointerId !== down.id) return;
          if (!dragging) {
            if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) return;
            dragging = true;
            say('moved far enough: telling the page a drag began');
            // One of this module's objects ({ kind, id, ... }), or a summary of one it has not stored ({ summary: { title, ... } }).
            const { kind, id, summary, label, ...where } = down.pressed;
            payload = summary ? { summary, label: label || summary.title } : { ref: host.objects.make(kind, id, where), label };
            insideOwn = false;
            call('objects.ptrStart', { ...payload, ...local(e) }).catch(() => {});
          }
          const now = Date.now();
          if (now - sent < 30) return;
          sent = now;
          const inside = overOwn(e);
          if (inside) own('over', e);
          else if (insideOwn) own('leave', e);
          insideOwn = inside;
          call('objects.ptrMove', local(e)).catch(() => {});
        });
        const finish = (e, dropped) => {
          if (!down || e.pointerId !== down.id) return;
          say(dragging ? (dropped ? 'released: sending the drop' : 'pointer cancelled') : 'released without dragging');
          if (dragging) {
            if (dropped && overOwn(e)) { own('drop', e); call('objects.dragEnd', {}).catch(() => {}); }
            else if (dropped) call('objects.ptrDrop', local(e)).catch(() => {});
            else call('objects.dragEnd', {}).catch(() => {});
            if (insideOwn && !(dropped && overOwn(e))) own('leave', e);
            insideOwn = false;
            // The release would otherwise count as a click on the object.
            const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
            window.addEventListener('click', stop, { capture: true, once: true });
            setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 100);
          }
          down = null;
          dragging = false;
        };
        window.addEventListener('pointerup', (e) => finish(e, true));
        window.addEventListener('pointercancel', (e) => finish(e, false));
      },
      // Receive a pointer dragged from another module on the same page. over(point, ref) as it moves across
      // this module, leave() when it goes, drop(ref, point) when it is let go; the point is { x, y } in
      // this module's own page, for document.elementFromPoint. Call this rather than (or as well as)
      // listening for dragover and drop yourself: a drag between two module frames reaches only this.
      // `ref` is the pointer dragged, or null; the third argument is what was dragged in full, { ref } or
      // { summary } (a summary carried by a module with nothing stored), for dropMenu.
      dropTarget: (handlers) => host.on('objectdrag', (e) => {
        const ref = e.ref && cleanRef(e.ref);
        const dragged = { ref, summary: (!ref && e.summary && typeof e.summary.title === 'string') ? e.summary : null };
        const point = { x: e.x, y: e.y };
        if (e.type !== 'over') host.objects.trace(`drag ${e.type} received (${ref ? ref.module + ':' + ref.kind : dragged.summary ? 'a summary' : 'no valid pointer'})`);
        if (e.type === 'over') handlers.over && handlers.over(point, ref, dragged);
        else if (e.type === 'leave') handlers.leave && handlers.leave();
        else if (e.type === 'drop') {
          handlers.leave && handlers.leave();
          handlers.drop && handlers.drop(ref, point, dragged);
        }
      }),
      // The fill rules: what a drop can fill of an action's inputs, from what was dragged and what is under
      // the pointer (the drop context: { summary, target?, date?, time?, place? }). Returns the input to request
      // the action with, or null when a required input cannot be filled or nothing of the dropped object was
      // used (an action unrelated to the object is never offered just because a day was under the pointer).
      // Pure: tools/check-drop.mjs runs it against every case.
      fillFor: (action, dragged, context) => fillFor(action, dragged, context),
      // What the modules around this one can do with what was dropped: [{ id, label, hint, action, input }],
      // each ready to request. `dragged` is what dropTarget gave ({ ref } or { summary }); `context` is what
      // this module says is under the pointer. Resolves the ref into its summary unless context.summary is given.
      offersFor: async (dragged, context) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        if (!ctx.summary) {
          if (d.ref) {
            const summary = await host.objects.resolve(d.ref);
            if (!summary || summary.error) throw new Error((summary && summary.error) || `that ${host.util.word('object')} is not available`);
            ctx.summary = summary;
          } else ctx.summary = d.summary || {};
        }
        // A drop is about the object and what is here. Beyond what this module offers of its own (`own`, in dropMenu),
        // the only actions offered are the dropped object's own module's, taking it by its exact kind and doing something
        // with what is under the pointer: set this task's due date to this day, link this task to this event, put this
        // place at this spot on the map. A third module making something new of the object (an event from a note dropped
        // on a plan) is not about here; that belongs where the object lives, not in a drop between two other modules. A
        // summary the drag carried has no module of its own, so only this module's own offers apply to it.
        if (!d.ref) return [];
        let list = [];
        try { list = await host.actions.list({ accepts: `${d.ref.module}:${d.ref.kind}`, ref: d.ref }); } catch (err) { list = []; }
        const offers = [];
        const kindType = `ref:${d.ref.module}:${d.ref.kind}`;
        for (const a of list) {
          if (a.module !== d.ref.module) { host.objects.trace(`drop: ${a.action} not offered (not the object's own module's)`); continue; }
          if (!Object.values(a.input || {}).some((t) => String(t).replace(/\?$/, '') === kindType)) { host.objects.trace(`drop: ${a.action} not offered (takes the object only as any ref)`); continue; }
          // What the action says the object must have (a position, a date, text): declared as `needs` on the action.
          const lacks = (a.needs || []).find((f) => !ctx.summary[f]);
          if (lacks) { host.objects.trace(`drop: ${a.action} not offered (the object has no ${lacks})`); continue; }
          const input = fillFor(a, d, ctx);
          if (!input) { host.objects.trace(`drop: ${a.action} not offered (${whyNot(a, d, ctx)})`); continue; }
          if (!usesHere(input, ctx)) { host.objects.trace(`drop: ${a.action} not offered (nothing from under the pointer would be used)`); continue; }
          offers.push({ id: a.action, label: a.label, hint: a.moduleName, icon: a.icon, action: a, input });
        }
        return offers;
      },
      // The one decision, shared by every module: what dropping this here can do. Shows the module's own
      // offers (`own`, first: [{ id, label, hint?, run(ctx), when?(ctx) }], an offer whose `when` says no
      // for this summary is left out) and every action the modules around it can fill from the drop context,
      // lets the person choose (actions.pick, with `remember` as its key alongside the dropped kind), and
      // runs it. Resolves to the offer taken, or null if dismissed; throws when nothing can be done, or it failed.
      dropMenu: async (dragged, point, { context, own, remember, wait } = {}) => {
        const d = normalizeDragged(dragged);
        const ctx = { ...(context || {}) };
        // The summary first, once, so the module's own offers and the actions' fill see the same one.
        if (!ctx.summary) {
          if (d.ref) {
            const summary = await host.objects.resolve(d.ref);
            if (!summary || summary.error) throw new Error((summary && summary.error) || `that ${host.util.word('object')} is not available`);
            ctx.summary = summary;
          } else ctx.summary = d.summary || {};
        }
        // An own offer wears this module's icon unless it names one; the actions wear their module's.
        const mine = info && info.module && info.module.icon;
        const offers = (own || []).filter((o) => o && (!o.when || o.when(ctx))).map((o) => (o.icon || !mine ? o : { ...o, icon: mine }));
        offers.push(...await host.objects.offersFor(d, ctx));
        host.objects.trace(`drop offers: ${offers.map((o) => o.label).join(' | ') || 'none'}`);
        if (!offers.length) throw new Error('Nothing can be done with that here.');
        // A summary with nothing stored behind it keeps the key 'card' for the remembered choice, so a choice kept in a
        // browser before the rename is still offered first.
        const kind = d.ref ? `${d.ref.module}:${d.ref.kind}` : 'card';
        const chosen = await host.actions.pick(offers, point, remember ? { remember: `${kind}:${remember}` } : undefined);
        if (!chosen) return null;
        if (chosen.run) await chosen.run(ctx);
        else {
          const out = await host.actions.request(chosen.action.action, chosen.input, { wait: wait !== false });
          if (out.status === 'done' && out.result && out.result.ok === false) throw new Error(out.result.error || 'it could not be done');
        }
        return chosen;
      },
      // Whether a drag over this module carries a pointer (call preventDefault on dragover to accept it).
      accepts: (event) => Array.from((event.dataTransfer && event.dataTransfer.types) || []).includes(OBJECT_MIME),
      // The pointer dropped, checked for shape, or null. It says nothing about whether the viewer may
      // see the object: resolve() does that.
      parse: (event) => {
        try {
          return cleanRef(JSON.parse(event.dataTransfer.getData(OBJECT_MIME)));
        } catch (err) {
          return null;
        }
      },
    },

    // Events: a module says something happened, and other modules that were approved to hear it can react.
    // Neither side names the other. Declare what you publish in module.json (events.publishes: [{ name,
    // kind, label }]) and what you want to hear (events.subscribes: ["*"] or ["module:name"], approved by
    // the admin). By convention an event named `closed`, `done`, `completed` or `finished` means the item it
    // points at is finished.
    events: {
      // publish('closed', { ref, data }): `ref` (optional) is a pointer to one of your own items, `data` a small
      // plain object (under 2 KB) that means something to whoever listens.
      publish: (name, o) => call('events.publish', { name, ref: o && o.ref, data: o && o.data }),
      // Hear events: handler({ id, at, module, name, ref, data }) for each, in order, including those that
      // happened while this module was not open (from where it last got to; a module hears nothing from
      // before its first subscribe). More than one person may have the module open, so handle an event so
      // that doing it twice is harmless.
      subscribe: (handler) => {
        const CURSOR = '_cursor:events';
        let cursor = null;
        let chain = Promise.resolve();
        let waiting = 0; // events queued and not yet handled: the cursor is written once the batch is done, not after each one
        const writeCursor = async () => {
          try {
            await host.storage.set(CURSOR, { id: cursor });
          } catch (err) {
            // read-only here: the cursor is kept for this visit only
          }
        };
        const deliver = (e) => {
          waiting += 1;
          chain = chain.then(async () => {
            waiting -= 1;
            if (cursor !== null && e.id <= cursor) return;
            try {
              await handler(e);
            } catch (err) {
              console.error(err);
            }
            cursor = e.id;
            if (waiting === 0) await writeCursor();
          });
        };
        const off = host.on('bus', deliver);
        (async () => {
          let saved = null;
          try {
            // Asked as a list, not a get: a first visit has no cursor yet, and a get of a missing key is a 404 in the console.
            const item = (await host.storage.list(CURSOR)).find((i) => i.key === CURSOR);
            saved = item && item.value && item.value.id;
          } catch (err) {
            saved = null;
          }
          const r = await call('events.since', { after: saved == null ? 'now' : saved });
          if (saved == null) {
            if (cursor === null || cursor < r.latest) cursor = r.latest;
            await writeCursor();
          } else if (cursor === null || cursor < saved) {
            cursor = saved;
          }
          for (const e of r.events) deliver(e);
        })().catch((err) => console.error(err));
        return off;
      },
    },

    // Actions: one module asks another to do something, without either naming the other in the host. A module
    // lists what it can do in module.json (actions.provides: [{ name, label, input: { title: 'string',
    // due: 'date?' } }]; field types are string, text, date, datetime, boolean, number and ref, and a
    // trailing ? means optional) and what it wants to ask for (actions.uses: ["*"] or ["module:name"],
    // approved by the admin).
    actions: {
      // What this module may ask for here: [{ action, module, moduleName, icon, name, label, input }]. Offer
      // whichever you can fill in from what you have (an action that takes a `title`, say), and do not name modules.
      // { accepts: "module:kind" } keeps the ones that take a pointer to that kind of item; { self: true } also
      // lists this module's own, marked own: true.
      // { accepts, self, ref }: `ref` the object they would be about, so only the actions that can be carried out in its
      // own place are listed.
      list: (o) => call('actions.list', { accepts: o && o.accepts, self: Boolean(o && o.self), ref: o && o.ref }),
      // A small menu at a point (in your own coordinates, as a drop gives it) to let the person choose what to
      // do: pick([{ label, hint? }], point) resolves to the chosen item, or null if they dismiss it. With a single
      // item there is nothing to ask, and it resolves to it at once. With { remember: "some key" } the choice is
      // kept (in this browser, per module) and offered first, marked "last used", the next time the same key is
      // asked; give each item an `id` (its label is used if not) so the choice survives wording changes.
      pick: (items, at, o) => new Promise((resolve) => {
        let list = (items || []).filter(Boolean);
        const memory = o && o.remember ? `app:pick:${(info && info.module && info.module.id) || ''}:${String(o.remember).slice(0, 120)}` : '';
        const idOf = (it) => String(it.id || it.label);
        if (memory && list.length > 1) {
          let last = '';
          try { last = localStorage.getItem(memory) || ''; } catch (err) { last = ''; }
          const at0 = list.findIndex((it) => idOf(it) === last);
          if (at0 > 0) list = [{ ...list[at0], hint: list[at0].hint ? list[at0].hint + ' \u00b7 last used' : 'Last used' }, ...list.filter((_, i) => i !== at0)];
          else if (at0 === 0) list = [{ ...list[0], hint: list[0].hint ? list[0].hint + ' \u00b7 last used' : 'Last used' }, ...list.slice(1)];
        }
        const remember = (it) => { if (!memory || !it) return it; try { localStorage.setItem(memory, idOf(it)); } catch (err) { /* not kept */ } return it; };
        if (list.length < 2) return resolve(list[0] || null);
        // The same look as host.menu.show (its styles, an icon, the label, a hint): one menu, wherever it is asked.
        const rootEl = host.rootElement;
        const menu = document.createElement('div');
        menu.className = 'sdk-menu';
        menu.setAttribute('role', 'menu');
        // Inside this module's open editor window (host.ui.editor) when it has one: the menu goes into the dialog (see
        // below), and focus goes back to the dialog when the menu is dismissed, so it is not left on the page's body.
        const editor = editorAt(null);
        const done = (v) => { menu.remove(); document.removeEventListener('keydown', key, true); env.root.removeEventListener('pointerdown', away, true); if (editor && editor.open && !editor.contains(env.root.activeElement)) { try { editor.focus(); } catch (err) { /* not focusable */ } } resolve(remember(v)); };
        // Escape dismisses only the menu: stopped and prevented, so an editor window around it does not close too.
        const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
        const away = (e) => { if (!menu.contains(e.target)) done(null); };
        for (const item of list) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sdk-menu-item';
          b.setAttribute('role', 'menuitem');
          if (item.icon) {
            const ic = document.createElement('span');
            ic.className = 'sdk-menu-icon';
            b.appendChild(ic);
            menuIcon(item.icon, item.regular ? 'regular' : 'solid').then((svg) => { if (svg) ic.innerHTML = svg; });
          }
          const label = document.createElement('span');
          label.className = 'sdk-menu-label';
          label.textContent = item.label;
          b.appendChild(label);
          if (item.hint) { const h = document.createElement('div'); h.className = 'sdk-menu-hint'; h.textContent = item.hint; b.appendChild(h); }
          b.addEventListener('click', () => done(item));
          menu.appendChild(b);
        }
        // Inside the module's own root (a shadow root in the page), placed by the page's coordinates; inside this
        // module's open editor window when it has one, clamped to the window.
        (editor || (env.root === document ? document.body : env.root)).appendChild(menu);
        const modBox = rootEl.getBoundingClientRect();
        const box = editor ? { left: 0, top: 0 } : modBox;
        const w = editor ? window.innerWidth : rootEl.clientWidth || 400;
        const h = editor ? window.innerHeight : rootEl.clientHeight || 400;
        const ax = ((at && at.x) || 0) + (editor ? modBox.left : 0);
        const ay = ((at && at.y) || 0) + (editor ? modBox.top : 0);
        menu.style.left = box.left + Math.max(4, Math.min(ax, w - menu.offsetWidth - 4)) + 'px';
        menu.style.top = box.top + Math.max(4, Math.min(ay, h - menu.offsetHeight - 4)) + 'px';
        document.addEventListener('keydown', key, true);
        env.root.addEventListener('pointerdown', away, true);
        const first = menu.querySelector('button');
        if (first) first.focus();
      }),
      // Ask for one. the host checks the input against what the action takes and queues it for the module
      // that owns it, which carries it out the next time a person has it open (or at once if one does).
      // With { wait: true } this waits a few seconds for the answer: { status, result: { ok, ref?, error? } }.
      // With { here: true } (a `local` action) only the provider open in this same page may carry it out, and only within
      // those few seconds: never a page in another tab, never later (the provider declares "page": "string?" and
      // "pageUntil": "number?" in its input; the host fills them). host.actions.list says `open: true` for an action whose
      // module is open in this page.
      request: async (action, input, o) => {
        const name = String(action || '');
        if (name === 'assistant:askAssistant' || name === 'askAssistant') {
          const q = String(input?.question || '').trim();
          if (!q && !input?.ref) throw new Error('Type a question.');
          await call('chat.ask', { question: q, refs: input?.ref ? [input.ref] : [] });
          return { status: 'done', id: 0, result: { ok: true } };
        }
        const queued = await call('actions.request', { action, input, ...(o && o.here ? { here: true } : {}) });
        if (queued && queued.status === 'done') return queued;
        if (!(o && o.wait)) return queued;
        for (let i = 0; i < 10; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const s = await call('actions.status', { id: queued.id });
          if (s.status === 'done') return s;
        }
        return { status: 'queued', id: queued.id };
      },
      // Run the module's actions library here (const ACTION_HANDLERS in src/<id>-lib-actions.js, the code the server runs for
      // an agent's request to a bundled module): fromLibrary(ACTION_HANDLERS, { after?, only? }) answers handlers for provide,
      // each carrying a request out as the server's runner does, with the same ctx and the same answer (see libraryHandlers
      // above): host.actions.provide({ ...host.actions.fromLibrary(ACTION_HANDLERS, { after }), myView: async (input) => {} }).
      // Any module may use it, uploaded ones too (they keep the wait for an open page, and the page carries it out this way).
      fromLibrary: (handlers, o) => libraryHandlers(host, handlers, { ...(o || {}), module: () => (info && info.module) || null }),
      // Carry out the actions this module provides: provide({ createTask: async (input, { from, by, byKey }) => ({ ref }) }).
      // `by` is the asker's name; `byKey` is the asker's key (a person's key you may store and look up), or null for a guest.
      // Called for each request, once (only one page takes it), under the rules of whoever has the module open.
      provide: (handlers) => {
        let chain = Promise.resolve();
        const run = async (a) => {
          const fn = handlers[a.name];
          if (!fn) return;
          let claim;
          try {
            claim = await call('actions.claim', { id: a.id });
          } catch (err) {
            return;
          }
          if (!claim || !claim.ok) return;
          let result;
          try {
            // `credit` is who an object this request makes is recorded as made by: the asker (a person, or an agent) when the server
            // knows them, else the person whose page carries it out. A module stamps `credit`, so every module credits alike.
            const me = (info && info.user) || {};
            const byKey = claim.action.byKey || null;
            const credit = byKey ? { name: String(claim.action.by || ''), key: byKey } : { name: String(me.name || ''), key: String(me.key || '') };
            const out = await fn(claim.action.input, { from: claim.action.from, by: claim.action.by, byKey, credit });
            result = { ok: true, ref: out && out.ref, ...(out && out.data !== undefined ? { data: out.data } : {}) };
          } catch (err) {
            result = { ok: false, error: String((err && err.message) || err) };
          }
          try {
            await call('actions.complete', { id: a.id, result });
          } catch (err) {
            // the requester can still see it was claimed
          }
        };
        const queue = (a) => { chain = chain.then(() => run(a)); };
        host.on('action', queue);
        call('actions.pending', {}).then((list) => list.forEach(queue)).catch(() => {});
      },
    },

    // Ask the host to run something later, on your behalf. Needs "schedule" (and
    // "notify" for a notification) in the manifest's hooks. `at` is a time
    // (ms since 1970 or an ISO string); `key` names the schedule so setting it
    // again replaces it. When it fires the module is told (event "schedule")
    // if open, and `notify`, if given, is delivered. On a module's environment page, `space: <id>` sets it in that
    // space (as its storage calls take { space }), so it runs and notifies there.
    schedule: (spec) => call('schedule', spec),
    cancelSchedule: (key, o) => call('cancelSchedule', { key, ...opts(o) }),

    // { to: 'space' | 'environment' | a person's key, title, body }. Needs the "notify" hook. On a module's
    // environment page, `space: <id>` makes it that space's: `to: 'space'` is then that space's people.
    notify: (spec) => call('notify', spec),

    // A destination (a host page made of modules' parts, such as Calendar): present only on a destination's part,
    // null anywhere else. info.context.destination says which ({ id, part }: part 'main' or 'panel'), so a part can
    // draw itself for it, with no header or filter of its own. The page owns the shared state and gives it whole:
    //   onState(fn)  fn(state) now (once ready) and on each change. Returns the off. The calendar's state is
    //                { view: 'month' | 'week' | 'day', spaces: [<id>...], environment: true | false, externalOff: [<id>...],
    //                day, from, to } (`spaces`, `environment` and `externalOff`, the person's other calendars the filter
    //                has off, are the filter; `day` the selected day; `from` and `to` the period shown, YYYY-MM-DD, `to`
    //                the day after it).
    //   set(patch)   change what this part may: in the calendar only the main part, { day, from, to }; on the map
    //                either part, { selected }. The page passes it on to every part, this one included.
    get destination() {
      if (!info || !info.context || !info.context.destination) return null;
      return destinationApi;
    },

    // The old action bar, kept so a module written for it still works: use host.add (the "+") instead. Nothing is
    // drawn along the bottom of a module any more. set([{ id, label, icon, primary, disabled }]) folds the buttons into
    // the titlebar's "+" as plain entries (the primary first, the rest in order; `label` is the entry's words, `icon`
    // its icon), and a pick still arrives as the 'bar' event { id }. An item { id, type: 'quickadd', placeholder,
    // label } becomes an entry too; its 'bar' event carries { id, value: '' } (there is no field to type in), so open
    // an empty form for it. `overflow` and `iconOnly` are ignored. A module that calls host.add.set gets only that list.
    // Resolves true.
    bar: {
      set: (items) => call('bar.set', { items }),
    },

    // The "+" in the module's titlebar, after its own icons and before "...": the module's add actions.
    // set(entries), where an entry is a leaf { id, label, icon?, tint?, hint?, disabled? }, a category
    // { label, icon?, items: [leaf, ...] } (one level) or { divider: true }. Labels up to 40 characters; at most 8
    // top-level entries, 12 per category and 40 leaves (the host drops the rest); a category with one leaf is that leaf.
    // Exactly one leaf: the "+" runs it at once, its label the tooltip ("Add event"). More: the "+" ("Add") opens the
    // host's menu, a category's leaves in a flyout beside it (a drill-in on a phone). A pick arrives as the 'add' event
    // { id }. An empty list takes the "+" away: send one for a person who may not add. The host draws it wherever the
    // module is drawn (a window's titlebar, popped out too, the page bar on the module's own page and on a destination's
    // page, a composite's titlebar on a space's canvas) and resolves true; only a dashboard widget answers false.
    // Detect it with `if (host.add)`.
    add: {
      set: (entries) => call('add.set', { entries }),
      // Puts the keyboard on the "+" (after a panel the module opened from it closes with Escape). Resolves false where there is none.
      focus: () => call('add.focus', {}),
    },

    // The status bar: one slim read-only line at the bottom of the module's window, for counts and what is selected.
    // set(items), up to 4 of { text, icon?, title?, quiet?, end? }: `text` up to 60 characters; `title` its tooltip (else its
    // text); `quiet` keeps it out of what a screen reader hears (a ticking time); `end` puts it at the right end (one).
    // The others are the words at the start, a dot between, cut with an ellipsis when the bar is too narrow. Nothing in it
    // is a button. The host reads the non-quiet text out politely once it has been still a moment, and draws nothing for
    // the same items again, so call it on every render. set([]) hides it. Resolves true wherever the module is drawn (a
    // window, popped out too, its own page, a destination's page, a composite's window); only a dashboard widget answers
    // false. Detect it with `if (host.status)`.
    status: {
      set: (items) => call('status.set', { items }),
    },

    // What needs this person's action in this space, shown by the host in the space's status strip as "N need action"
    // (a button whose list opens your items). The host names no module: it adds every module's count. set({ count,
    // label, items }): `count` a whole number from 0 to 99 (0 clears), `label` up to 40 characters ("polls to vote
    // in"), `items` up to 20 of { title, object? } (`title` up to 120 characters; `object` an object reference from
    // host.objects.make, which a pick opens; none, a pick opens your module). The host keeps your last report for a
    // week, per person and space, so call it when you run and after each change; calling again with the same words
    // changes nothing. clear() drops it. Both resolve true when kept, false where there is no space (a module's
    // page outside a space, a dashboard widget, a guest) or this role may not write in the module; a bad shape rejects
    // with a sentence. Detect it with `if (host.attention)`.
    attention: {
      set: (report) => call('attention.set', report || {}),
      clear: () => call('attention.clear'),
    },

    // How this space stands, shown by the host as chips in the space's status strip ("$2,340 of $4,000", "Thu ·
    // SJC → ONT"; plan-space-story-strip.md, step 5). Facts are the space's, not a person's: the host keeps your module's
    // last list for the space for a week, whoever sent it, and shows it to everyone who may read your module there.
    // set([...]): at most 6 of { id, icon, text, value?, progress?, order?, budget?, when? }: `id` a short code name
    // unique in your module (`spent`), `icon` a Font Awesome Free solid icon's name, `text` up to 40 characters (the
    // chip's words; no invisible characters), `value` up to 24 (a short extra, shown when the chip is pressed),
    // `progress` 0 to 1 (drawn as a fill in the chip), `order` 0 to 99 (lower first), `budget: true` when the fact
    // reads the space's budget target (host.space().budget), which lets Set up offer that target, `when` a day
    // (YYYY-MM-DD) the fact is about: the host puts it in words in front of yours against each viewer's own today
    // ("Today", "Tomorrow", "Fri", "Oct 21") and leaves the fact out once that day has passed, so never put a relative
    // day in `text` yourself. The strip shows up to three. Call it when you run and
    // after each change; the same list again changes nothing. set([]) or clear() drops them. Both resolve true when
    // kept, false where there is no space (a module's page outside a space, a dashboard widget, a guest) or this role
    // may not write in the module; a bad shape rejects with a sentence. Detect it with `if (host.facts)`.
    facts: {
      set: (list) => call('facts.set', { facts: Array.isArray(list) ? list : [] }),
      clear: () => call('facts.clear'),
    },

    // The module's own actions in its title bar, beside the "+" and the host's menu:
    // set([{ id, icon, title, on, regular, disabled, overflow, danger }]), where `icon` is a Font Awesome name (solid, or
    // regular with `regular: true`), `title` its words (its tooltip and name) and `on` marks the current choice. Each is an
    // icon beside the menu; `overflow: true` puts it in the title bar's menu instead (the module's own actions come first
    // there, before a line and the host's standard actions), as do the icons past five and any the title bar has no room
    // for; `danger: true` (a destructive action) is always last in that menu, in red. A click arrives as the 'header' event
    // with its id. Resolves true wherever the module is drawn (a window, its own page, a destination's page, a composite's
    // window); only a dashboard widget answers false.
    //
    // One item may instead be a select, { kind: 'select', id, label, title?, disabled?, items }: a divider and a dropdown button after
    // the title, `label` (up to 40 characters, cut with an ellipsis when there is no room) the current choice's words, then a
    // caret. The HOST draws its menu directly under the button (the same menu as the title bar's "..."), from `items`, which is
    // data only (no functions): rows { id, label, current?, disabled?, items? }, { divider: true } and { heading: 'Words' }. A row
    // with `items` is a category whose children open in a flyout beside it (a drill-in with Back on a phone): ONE level, deeper is
    // dropped. `id` is 1 to 40 characters of a-z, 0-9, ".", "_" or "-", and none twice; `label` is plain text of up to 60
    // characters (no HTML, no icon or class names; control characters are removed); at most one row is `current` (drawn as the
    // chosen one of a set); at most 50 entries, children counted. A select with no row to pick is dropped, and only the first select
    // is kept; it is one of the ten items but not one of the five icons, and the label is cut before the title is. A pick arrives as
    // the 'header' event { id: <the select's id>, value: <the picked row's id> }; there is no event for the button itself. Escape or
    // a pick returns the keyboard to the button.
    header: {
      set: (items) => call('header.set', { items }),
    },

    // The standard actions a module handles itself: Settings, Share and Print, the same in every module. The host draws each
    // one you give a handler for in the title bar's menu, after your own actions, with the host's words, icon and order
    // (Settings, Share, Print), and leaves out the rest. set({ settings, share, print }), each a function (the handler) or
    // { run, disabled?, hint?, permission? } (`run` the handler; `disabled` shows it greyed, `hint` up to 40 characters
    // says why; `permission` one of your module.json permissions: it is left out for a person without it), or null to
    // leave it out. A set replaces the last; set({}) takes them all away.
    //   settings: run() opens your settings, wherever you keep them (an editor window, a view of your own).
    //   share: run() answers what to share, { url, title?, message? } (or a promise of it): `url` an https address or a path
    //     on this server, `title` the dialog's heading (else "Share"), `message` one plain line. The host shows its one
    //     Share dialog: the link, a Copy link button and your message. Answer null to share nothing.
    //   print: run() gets your page ready (or answers false to stop); the host then prints your content area alone, with
    //     no title bar, toolbar or status bar, in the light colours, and you hear 'printed' when the page is back.
    // Resolves true wherever the module has a frame (a window, popped out, its own page); false on a destination's part
    // and a dashboard widget.
    standard: {
      set: (spec) => setStandard(spec),
    },

    // The one row under the title bar, above the content: the tools about the module's current state -- a view switch,
    // the period's title, the way through it (back, Today, forward), a search, the filters -- not window-level actions
    // (those are the title bar's) and not the module's add actions (the title bar's "+"). The host draws it wherever the
    // module is drawn (a window, popped out, its own page, a destination's page) in one fixed order: on the left the view
    // switches, then the title and notes, then the buttons; on the right, always in the same place from the edge, the
    // search and then one Filters button, which holds every `chips` item as a group in its menu (with Clear filters at
    // the top) and shows how many filters are applied. It keeps the row one line, nothing ever cut: while it is too narrow
    // the switches show only their icons, then the buttons, then the search becomes a magnifier in its place, then the
    // left side's controls go into a "More" menu one at a time; the search and Filters stay. set([item, ...]):
    //   { type: 'title', text }                                            -- the row's title ("October 2026")
    //   { type: 'text', text }                                             -- a quieter note
    //   { type: 'tabs', id, value, options: [{ id, label?, icon?, regular?, iconOnly? }] } -- a segmented switch (prefer
    //       host.ui.viewSwitch); a click arrives as the 'toolbar' event { id, value: optionId }
    //   { type: 'search', id, value?, placeholder?, label? }               -- the row's search; typing arrives as { id, value },
    //       Enter as { id, value, submit: true }, Escape clears it ({ id, value: '' }). `value` is put in the field only when
    //       it differs from the last `value` you sent, never under the person's typing
    //   { type: 'chips', id, label?, single?, value?, options: [{ id, label, icon?, tint?, note?, count?, on?, default? }] }
    //       -- a group of filters in the Filters menu, under `label`. Switches, each turned on and off: a click arrives as
    //       { id, value: optionId, on }; an option is applied while `on` is not its `default` (on unless you say
    //       `default: false`), and that is what the Filters count counts. `single: true` makes it one choice, `value` the
    //       chosen option's id, the first option meaning "nothing applied" ("All"); a pick arrives as { id, value }.
    //       `count` is a number after the option; `note` a short word after it. Draw them again with the new state
    //   { type: 'button', id, label?, title?, icon?, regular?, on?, primary?, disabled?, overflow?, placement? } (the default
    //       type) -- a click arrives as { id, x } (x: its left edge across the module, for a menu under it); an icon with no
    //       label is an icon button, `title` its tooltip and name; `on` a pressed state. `placement: 'titlebar'` draws it as
    //       an icon in the title bar instead, `placement: 'menu'` puts it in the title bar's menu; `overflow: true` keeps it
    //       in the row's "More" menu
    // Every title, text, tabs and button item (and host.ui.viewSwitch, host.ui.toolbarButton) may say `zone: 'end'` for the row's
    // right zone: at the far right, after the search and Filters, in the order given, and kept in place while the left zone
    // folds. `zone` is 'start' (the left, the default) or 'end'; any other value is ignored.
    // Your view switches and toolbar buttons (host.ui.viewSwitch, host.ui.toolbarButton) come first, then your items;
    // call set on every render (the same row is not drawn twice). Resolves true wherever the module is drawn; only a
    // dashboard widget answers false.
    toolbar: {
      set: (items) => { ownToolbar = Array.isArray(items) ? items : []; return drawToolbar(); },
    },

    // The module's tools in the space's nav bar (the secondary nav, the row under the header on the call page), drawn by
    // the host in its own look while the module is open in that space and taken out when it closes. Not the
    // module's toolbar (host.toolbar.set, about the module's own state): these are the space's actions the module adds.
    // set([{ id, zone?, icon, label, title?, order?, group?, groupOrder?, href?, visible?, toggleable?, active?, badge? }]):
    //   id is letters, digits and hyphens, the module's own (the host namespaces it); `zone` is ignored (every module
    //   tool goes in the space bar's right zone, where it can fold); icon a Font Awesome name; label what a screen reader and the tooltip say; order and groupOrder
    //   in the module band (101-998, clamped); href a path on this server or an https address, for a real link.
    // The set replaces the last. A click arrives as the 'nav' event { id }. The host decides where a module's tools
    // go: always the space bar's right zone, never the top bar. `bar`, `system` and `zone` are ignored (a tool that sets them is placed like
    // any other). Resolves true when the host drew them, false when there is no space bar here (the module's own
    // page). setActive(id, on) and setBadge(id, n) change a tool in place; never set() again for that.
    nav: {
      set: (tools) => call('nav.set', { tools }),
      setActive: (id, on) => call('nav.setActive', { id, on }),
      setBadge: (id, n) => call('nav.setBadge', { id, n }),
    },

    // A menu of actions -- the shared shape for a row's "..." button, a right-click, a joint's +, anything
    // that is "here are some things you could do, pick one." Not for a single yes/no drop decision with
    // nothing more to say afterward (see host.actions.pick for that).
    //
    // show({ id, items, at, anchor, className, maxWidth }): items are [{ id?, label, icon?, iconColor?,
    // regular?, hint?, tip?, ariaLabel?, disabled?, danger?, separator?, href?, target?, onClick? }] (`tip` is the
    // row's tooltip and, when it holds the label ("Add a flight" for "Flight"), what a screen reader hears; `ariaLabel`
    // names the row for a screen reader outright; separator: true
    // ignores every other field and draws a divider; iconColor is a CSS color for that item's own icon,
    // for a fixed set of kinds people tell apart by color elsewhere in the module -- most menus don't need
    // it). An item that just goes somewhere gives `href` instead of `onClick` -- a real link (target
    // "_blank" unless given), not a click handler faking navigation, so hovering, copying and opening in a
    // new tab all still work. Position with `at: { x, y }` (a drop's own coordinates) or `anchor` (an element to open
    // under, like the button that opened it) -- give one, not both. `onClick(item)` runs on a click; unless
    // it returns exactly `false`, or a promise that resolves to exactly `false`, the menu closes afterward --
    // an item that needs to arm itself first ("Really delete?") returns false and changes its own label by
    // calling show() again with the same id.
    //
    // An item with `items` (or `submenu`: a list of items, or a function giving one) is a category: a caret at its
    // end, its entries in a flyout beside its row (on hover after a short wait, on a click or tap, on Right or Enter;
    // Left or Escape closes just the flyout, the keyboard back on its row; it flips or shifts to stay inside the
    // module). On a phone, or where the module has no room for both side by side, it drills in instead: the menu shows
    // Back, the category's name and its entries. One level: a category's entries are plain items. { heading } is a
    // small heading over the entries after it. Up, Down, Home and End move in either level.
    //
    // Only one of these is ever open at a time (per module): showing one closes whatever else was open
    // first. Showing the same id again while it is already open closes it instead of reopening it, so a
    // "..." button toggles rather than always opening a fresh copy. Returns { close }.
    menu: {
      // host.menu.show({ id, items, at?, anchor?, className?, maxWidth?, onClose? }) opens the one menu a module has open at a time.
      // `onClose()` is called once when the menu closes, however it closes: a pick, Escape, a press outside it, host.menu.close(),
      // the same `id` shown again (a toggle off) or another menu opening in its place. It gets no arguments, and a pick's own
      // onClick has run by then. The menu is drawn by the SDK in the module's own page, so this is a plain function, also in a sandboxed frame.
      show({ id, items, at, anchor, className, maxWidth, onClose } = {}) {
        return showMenu({ id, items, at, anchor, className, maxWidth, onClose });
      },
      close: () => closeMenu(),
    },

    // Layout: ask the host for a size, and set the title shown above the module.
    resize: (size) => call('resize', size),
    setTitle: (title) => call('setTitle', { title }),

    // Events: 'bar' ({ id }) when an action bar button is clicked, 'add' ({ id }) for one of the "+"'s actions, 'header' ({ id }) for a titlebar icon,
    // 'standard' ({ id }) for Settings, Share or Print (host.standard.set runs your handler for it), 'printed' once the page is back after Print,
    // 'toolbar' ({ id, value?, x? }) for a toolbar item (x: a button's left edge across the module, for a menu under it), 'nav' ({ id }) for one of the module's nav-bar tools,
    // 'change' ({ key, value, version, deleted, scope, spaceId, by })
    // whenever stored data changes, 'changes' ({ changes: [{ key, value, version, deleted, by }], cleared?, restored?, scope, spaceId, by })
    // when many keys changed at once (a Clear, its Undo; without a 'changes' listener each comes as a 'change' in one pass, with batch: { count, last }, so a module can draw on the last only), 'library' ({ op: 'added'|'renamed'|'removed'|'thumb', id, module, spaceId }) when a library file changed (to the library module itself, e.g. the Vault, and to a module approved to link to its files; host.ui.fileChips already listens), 'markers' when another module's marker objects changed (host.objects.markers), 'schedule' ({ key, payload }) when a schedule fires, 'theme' (the new theme),
    // 'reconnected' (no data) after the host's event stream dropped and came back, once per drop: events were missed meanwhile, so read
    // again what you show from stored data. Only in a space (also in a sandboxed frame, as a message with no data).
    // 'moved' ({ mode }) after the host moved the module between docked and floating (the SDK reopens an open editor window itself),
    // 'environment' ({ pictureMap }) when the environment's facts changed (host.environment already answers the new ones),
    // 'phases' ({ phases, timeline }) when the dates on the space's timeline changed (a save in the sheet or Set up, or
    // someone else's): `phases` is { <id>: { start?, end? } }, `timeline` the bands host.util.phaseTimeline() returns, and
    // host.space().phases and host.util.phaseTimeline() already answer the new ones. Only in a space.
    // 'space' ({ budget }) when the space's budget target changed (an owner's Set up): host.space().budget already answers
    // the new one. Only in a space.
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
  };

  // Live messages (plan-module-live.md): short messages between the people using this module in this space -- a pointer,
  // a typing mark, a nudge. They travel over the app's own server, never over the call: they work with no voice and video
  // set up and with nobody on a call. Only in a space (on an environment page `state` is 'closed' and publish refuses),
  // and only for a module whose module.json says "live": true (else the host refuses with the server's sentence).
  //
  //   const off = host.live.subscribe('pointer', (data, from, meta) => { ... }); // returns unsubscribe; many per topic
  //   await host.live.publish('pointer', { x, y });             // everyone else here who may see the module
  //   await host.live.publish('nudge', { text }, { to: [key] }); // only these people (keys, or a guest's id)
  //   const stop = host.live.on('people', ({ joined, left, people }) => { ... }); // who has joined it here
  //   host.live.state;                                           // 'connecting' | 'open' | 'closed'
  //   host.live.on('state', (state) => { ... });                 // or host.on('live', ({ state }) => { ... })
  //   host.live.tint(key);                                       // that person's tint name
  //
  // `from` is { key, name, guest, tint }: `tint` one of blue, green, teal, purple, orange, pink, gold and red, the same for
  // a person everywhere (draw it with var(--tint-<tint>)). `meta` is { topic, at, seq }: the server's time and sequence.
  // A topic is 1 to 40 of a-z, 0-9, dot, underscore and dash, and is this module's own: no other module hears it.
  // publish resolves once the server took the message, never when it was delivered. Messages are lossy: none is stored or
  // replayed after a reconnect, one may be dropped, and there is no acknowledgement (use storage or an action for that).
  // `data` is plain JSON of at most 256 bytes, with no `__proto__` key. The SDK sends at most 20 a second for the module,
  // keeping only the newest waiting for each topic (and `to`): a message replaced before it went settles as its
  // replacement does. A message older than the last one heard from the same person is dropped. The sender's own pages
  // never hear their own messages. The host joins while there is a subscription or a 'people' watch, joins again after
  // every reconnect, and leaves when there is neither, when the module's page goes and when it is closed.
  function makeLive() {
    let state = 'connecting';
    let heardState = false;
    const topics = new Map(); // topic -> Set(handler)
    const peopleFns = new Set();
    const stateFns = new Set();
    let people = null; // [{ key, name, guest, tint }] once known
    const lastSeq = new Map(); // a sender's key -> the last seq heard from them since this stream's `ready`
    const waiting = new Map(); // topic + to -> { topic, data, to, settle: [{ resolve, reject }] }
    let timer = null;
    let nextAt = 0;
    const withTint = (p) => ({ key: p.key, name: p.name, guest: p.guest === true, tint: personTint(p.key) });
    const bad = (message, status = 400) => Object.assign(new Error(message), { status });
    const tellPeople = (fn, change) => { try { fn({ joined: change.joined, left: change.left, people: (people || []).slice() }); } catch (err) { console.error(err); } };

    readyPromise.then((r) => {
      if (heardState) return;
      state = r && (r.live === 'open' || r.live === 'connecting' || r.live === 'closed') ? r.live : (r && r.context && r.context.scope === 'space' ? 'connecting' : 'closed');
    }, () => { if (!heardState) state = 'closed'; });

    host.on('live.state', (e) => {
      if (!e || typeof e.state !== 'string') return;
      heardState = true;
      // A new connection: the server's sequence numbers may have started over (a restart), so each sender's last-seen goes.
      if (e.fresh) lastSeq.clear();
      if (e.state === state) return;
      state = e.state;
      for (const fn of [...stateFns]) { try { fn(state); } catch (err) { console.error(err); } }
      emit('live', { state });
    });
    host.on('live.message', (m) => {
      if (!m || typeof m.topic !== 'string' || !m.from || typeof m.from.key !== 'string') return;
      const fns = topics.get(m.topic);
      if (!fns || !fns.size) return;
      // Stale or out of order: not newer than the last heard from that person (the server counts up per module and space).
      const last = lastSeq.get(m.from.key);
      if (typeof m.seq !== 'number' || (last !== undefined && m.seq <= last)) return;
      lastSeq.set(m.from.key, m.seq);
      const from = withTint(m.from);
      // Each handler gets its own copy of the data, so one handler changing it can't change what the next one sees.
      for (const fn of [...fns]) {
        let data;
        try { data = structuredClone(m.data); } catch (err) { return; } // only plain JSON comes (the host checked it)
        try { fn(data, { ...from }, { topic: m.topic, at: m.at, seq: m.seq }); } catch (err) { console.error(err); }
      }
    });
    host.on('live.people', (e) => {
      if (!e || !Array.isArray(e.people)) return;
      people = e.people.map(withTint);
      const change = { joined: e.joined ? withTint(e.joined) : null, left: e.left ? withTint(e.left) : null };
      if (change.left) lastSeq.delete(change.left.key);
      for (const fn of [...peopleFns]) tellPeople(fn, change);
    });

    function pump() {
      if (timer !== null || !waiting.size) return;
      timer = setTimeout(flush, Math.max(0, nextAt - Date.now()));
    }
    function flush() {
      timer = null;
      const [k, msg] = waiting.entries().next().value || [];
      if (!msg) return;
      waiting.delete(k);
      nextAt = Date.now() + LIVE_GAP_MS;
      readyPromise.then(() => call('live.publish', { topic: msg.topic, data: msg.data, ...(msg.to ? { to: msg.to } : {}) })).then(
        () => { for (const s of msg.settle) s.resolve(true); },
        (err) => {
          // Asked to wait: nothing more goes until then.
          if (err && err.status === 429) nextAt = Math.max(nextAt, Date.now() + Math.max(1, Number(err.retryAfter) || 1) * 1000);
          for (const s of msg.settle) s.reject(err);
        },
      );
      pump();
    }

    const live = {
      get state() { return state; },
      tint: personTint,
      publish(topic, data, options) {
        if (typeof topic !== 'string' || !LIVE_TOPIC.test(topic)) return Promise.reject(bad('the topic must be 1 to 40 of a-z, 0-9, dot, underscore and dash'));
        const o = options === undefined || options === null ? {} : options;
        if (typeof o !== 'object' || Object.keys(o).some((k) => k !== 'to')) return Promise.reject(bad('the options are only { to }'));
        let to = null;
        if (o.to !== undefined && o.to !== null) {
          if (!Array.isArray(o.to) || !o.to.length || o.to.length > 20 || !o.to.every((k) => typeof k === 'string' && LIVE_PERSON.test(k))) return Promise.reject(bad('to must list 1 to 20 people by their keys'));
          to = [...new Set(o.to)];
        }
        let copy;
        try {
          const text = JSON.stringify(data === undefined ? null : data);
          copy = JSON.parse(text); // the value as it is now: a change after publish doesn't change what goes
        } catch (err) {
          return Promise.reject(bad('the data must be plain JSON'));
        }
        if (liveHasProto(copy)) return Promise.reject(bad('the data can\'t have a __proto__ key'));
        const k = `${topic}\u0000${to ? to.slice().sort().join(',') : ''}`;
        return new Promise((resolve, reject) => {
          const held = waiting.get(k);
          if (held) {
            held.data = copy; // only the newest waits
            held.settle.push({ resolve, reject });
          } else {
            waiting.set(k, { topic, data: copy, to, settle: [{ resolve, reject }] });
          }
          pump();
        });
      },
      subscribe(topic, handler) {
        if (typeof topic !== 'string' || !LIVE_TOPIC.test(topic)) throw bad('the topic must be 1 to 40 of a-z, 0-9, dot, underscore and dash');
        if (typeof handler !== 'function') throw bad('subscribe needs a function');
        let fns = topics.get(topic);
        const first = !fns;
        if (!fns) { fns = new Set(); topics.set(topic, fns); }
        const mine = (...args) => handler(...args); // the same function twice is two subscriptions
        fns.add(mine);
        if (first) readyPromise.then(() => call('live.subscribe', { topic })).catch((err) => console.warn(`[host.live] ${err.message}`));
        let off = false;
        return () => {
          if (off) return;
          off = true;
          const now = topics.get(topic);
          if (!now) return;
          now.delete(mine);
          if (now.size) return;
          topics.delete(topic);
          readyPromise.then(() => call('live.unsubscribe', { topic })).catch(() => {});
        };
      },
      // 'people': fn({ joined, left, people }) on each join and leave, and once with who is there now. 'state': fn(state).
      on(event, fn) {
        if (typeof fn !== 'function') throw bad('on needs a function');
        if (event === 'state') {
          stateFns.add(fn);
          return () => { stateFns.delete(fn); };
        }
        if (event !== 'people') throw bad('host.live.on hears "people" or "state"');
        const first = !peopleFns.size;
        peopleFns.add(fn);
        if (first) {
          readyPromise.then(() => call('live.people', { on: true })).then((r) => {
            if (!peopleFns.has(fn)) return;
            if (r && Array.isArray(r.people) && r.people.length) people = r.people.map(withTint);
            if (people) tellPeople(fn, { joined: null, left: null });
          }, (err) => console.warn(`[host.live] ${err.message}`));
        } else if (people) {
          setTimeout(() => { if (peopleFns.has(fn)) tellPeople(fn, { joined: null, left: null }); }, 0);
        }
        let off = false;
        return () => {
          if (off) return;
          off = true;
          peopleFns.delete(fn);
          if (peopleFns.size) return;
          people = null;
          readyPromise.then(() => call('live.people', { on: false })).catch(() => {});
        };
      },
    };
    return live;
  }
  host.live = makeLive();

  // The space's shared tags (plan-tags.md; the rules and the list are the server's, server/tags.js). A module that says
  // `"tags": true` in its module.json may use them, in a space: the host refuses any other module, an environment page and a
  // keyed page, and the server decides every call again. An object holds tag ids; the names and colours live in the list, so a
  // rename reaches every use. Nothing here writes a tag's text into HTML: names are set with textContent.
  //
  //   await host.tags.list()                -> [{ id, name, color }] in name order; the SDK keeps it (and keeps it current from
  //                                            the 'tags' event), so call it once when ready, then chip() and filterOptions() answer at once
  //   await host.tags.add(name, { color? }) -> the tag: finds the tag of that name or makes it (needs the module's write right
  //                                            here; never a guest). A refusal rejects with the server's sentence (a bad name, 200 in
  //                                            the list, no right). `color` is '#rrggbb' (lower case), or none.
  //   host.tags.chip(id)                    -> a tag chip element (.sdk-chip-tag in the tag's colour), or null when the id is not a
  //                                            tag of this space (deleted, from another space, or list() has not been awaited)
  //   host.tags.picker(anchor, { selected, max?, create?, onChange }) -> { close(), set(ids) }
  //                                            a popover under `anchor`: type to filter, tick a tag to add it or take it off, and
  //                                            "Create 'x'" makes a tag from what was typed (hidden when create is false, as for a
  //                                            reader). `selected` the object's tag ids; `max` at most 8 (the one rule); onChange(ids)
  //                                            runs with the ids ticked now, on every change. Only one menu or picker is open at a time.
  //   host.tags.filterOptions(counts)       -> options for a toolbar 'chips' item (host.toolbar.set): one per tag in `counts`
  //                                            ({ [id]: number } or a Map), named for the tag, in its colour (`tint`, '#rrggbb': a dot
  //                                            before the name in the Filters menu), with the count. A tag
  //                                            filter means "has all of them"; the module applies it.
  //   host.on('tags', ({ op, tag }) => ...) op 'added', 'changed' (renamed or recoloured) or 'removed'; the SDK has already
  //                                            updated list(). A deleted tag leaves a dead id on objects: chip() returns null for it.
  // What a tag's name or colour may be, the 8 to an object, 24 characters and 200 to a list are the server's rules; the
  // picker only stops offering a tick past `max`, and shows the server's sentence for the rest.
  // A tag's colour is '#rrggbb' lower case or '' (plain); anything else is plain here.
  const TAG_HEX = /^#[0-9a-f]{6}$/;
  const TAG_ID = /^[a-z0-9]{8,12}$/;
  const TAG_MAX = 8;
  const cleanTagShape = (t) => {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !TAG_ID.test(t.id)) return null;
    if (typeof t.name !== 'string' || !t.name || [...t.name].length > 24) return null;
    return { id: t.id, name: t.name, color: typeof t.color === 'string' && TAG_HEX.test(t.color) ? t.color : '' };
  };
  const byTagName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  function makeTags() {
    let cache = null; // Map id -> tag, once listed
    let loading = null;
    const watchers = new Set();
    const tell = () => { for (const fn of [...watchers]) { try { fn(); } catch (err) { console.error(err); } } };
    const sorted = () => (cache ? [...cache.values()].sort(byTagName) : []);
    const load = () => call('tags.list').then((list) => {
      cache = new Map();
      for (const t of Array.isArray(list) ? list : []) { const c = cleanTagShape(t); if (c) cache.set(c.id, c); }
      tell();
      return sorted();
    }).finally(() => { loading = null; });
    // Registered first, so the list is current before any module listener hears the event.
    host.on('tags', (e) => {
      const t = cleanTagShape(e && e.tag);
      if (!t || !cache) return;
      if (e.op === 'removed') cache.delete(t.id);
      else if (e.op === 'added' || e.op === 'changed') cache.set(t.id, t);
      else return;
      tell();
    });
    const chip = (id) => {
      const t = typeof id === 'string' && cache ? cache.get(id) : null;
      if (!t) return null;
      const el = document.createElement('span');
      el.className = 'sdk-chip-tag';
      paintTag(el, t.color);
      el.dataset.tag = t.id;
      const label = document.createElement('span');
      label.className = 'sdk-chip-label';
      label.textContent = t.name;
      el.appendChild(label);
      return el;
    };

    function picker(anchor, o) {
      const opts = o && typeof o === 'object' ? o : {};
      if (!anchor || anchor.nodeType !== 1) throw new Error('host.tags.picker needs an element to open under');
      const reopening = openMenu && openMenu.id === 'tags-picker';
      closeMenu();
      if (reopening) return { close: closeMenu, set() {} };
      const max = Number.isInteger(opts.max) && opts.max >= 1 ? Math.min(opts.max, TAG_MAX) : TAG_MAX;
      const mayCreate = opts.create !== false;
      let ticked = [...new Set(Array.isArray(opts.selected) ? opts.selected.filter((s) => typeof s === 'string') : [])];
      let query = '';
      let said = '';
      let busy = false;
      let loadFailed = '';
      const changed = () => { if (typeof opts.onChange === 'function') { try { opts.onChange(ticked.filter((id) => !cache || cache.has(id))); } catch (err) { console.error(err); } } };

      const editor = editorAt(anchor);
      const container = editor || (env.root === document ? document.body : env.root);
      const menu = document.createElement('div');
      menu.className = 'sdk-menu sdk-tag-picker';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', 'Tags');
      const search = document.createElement('div');
      search.className = 'sdk-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = mayCreate ? 'Find or add a tag' : 'Find a tag';
      input.setAttribute('aria-label', input.placeholder);
      input.maxLength = 60;
      search.appendChild(input);
      const list = document.createElement('div');
      list.className = 'sdk-tag-picker-list';
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', 'Tags');
      const status = document.createElement('p');
      status.className = 'sdk-menu-hint sdk-tag-picker-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      menu.append(search, list, status);

      const normal = (s) => s.trim().toLowerCase().replace(/\s+/g, '-');
      const rows = () => [...list.querySelectorAll('.sdk-menu-item')];
      function row(label, onClick, { tone = '', on = false, create = false } = {}) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sdk-menu-item';
        b.setAttribute('role', create ? 'menuitem' : 'menuitemcheckbox');
        if (!create) b.setAttribute('aria-checked', on ? 'true' : 'false');
        if (!create) {
          const dot = document.createElement('span');
          dot.className = 'sdk-chip-dot';
          paintTag(dot, tone);
          b.appendChild(dot);
        }
        const text = document.createElement('span');
        text.className = 'sdk-menu-label';
        text.textContent = label;
        b.appendChild(text);
        if (on && !create) {
          const tick = document.createElement('span');
          tick.className = 'sdk-menu-icon';
          tick.setAttribute('aria-hidden', 'true');
          b.appendChild(tick);
          menuIcon('check').then((svg) => { if (svg) tick.innerHTML = svg; });
        }
        b.addEventListener('click', onClick);
        return b;
      }
      function draw() {
        const q = normal(query);
        list.replaceChildren();
        const shown = sorted().filter((t) => !q || t.name.includes(q));
        for (const t of shown) {
          list.appendChild(row(t.name, () => toggle(t.id), { tone: t.color, on: ticked.includes(t.id) }));
        }
        const exact = Boolean(q) && sorted().some((t) => t.name === q);
        if (mayCreate && q && !exact && cache) list.appendChild(row(`Create "${query.trim().slice(0, 40)}"`, () => make(query), { create: true }));
        if (!list.children.length) {
          const none = document.createElement('p');
          none.className = 'sdk-menu-hint';
          none.textContent = loadFailed ? '' : !cache ? 'Loading tags' : q ? 'No tag matches.' : 'No tags yet.';
          list.appendChild(none);
        }
        status.textContent = loadFailed || said;
        status.hidden = !status.textContent;
        place();
      }
      function toggle(id) {
        said = '';
        if (ticked.includes(id)) ticked = ticked.filter((x) => x !== id);
        else if (ticked.filter((x) => !cache || cache.has(x)).length >= max) said = `Up to ${max} tags on one ${host.util.word('object')}.`;
        else ticked = [...ticked, id];
        if (!said) changed();
        draw();
      }
      async function make(text) {
        if (busy) return;
        busy = true;
        said = 'Making the tag.';
        draw();
        try {
          const tag = await tags.add(text);
          said = '';
          query = '';
          input.value = '';
          if (!ticked.includes(tag.id)) {
            if (ticked.filter((x) => !cache || cache.has(x)).length >= max) said = `Made "${tag.name}". Up to ${max} tags on one ${host.util.word('object')}.`;
            else { ticked = [...ticked, tag.id]; changed(); }
          }
        } catch (err) {
          said = (err && err.message) || 'The tag could not be made.'; // the server's own sentence
        } finally {
          busy = false;
        }
        draw();
        input.focus();
      }

      const bounds = () => {
        const modBox = rootBox();
        return { box: editor ? { left: 0, top: 0 } : modBox, w: editor ? window.innerWidth : modBox.w, h: editor ? window.innerHeight : modBox.h };
      };
      function place() {
        const { box, w, h } = bounds();
        if (bounds().w <= 640) menu.classList.add('narrow'); else menu.classList.remove('narrow');
        const r = anchor.getBoundingClientRect();
        let x = r.left - box.left;
        let y = r.bottom - box.top + 4;
        if (y + menu.offsetHeight > h) y = r.top - box.top - menu.offsetHeight - 4;
        x = Math.max(4, Math.min(x, w - menu.offsetWidth - 4));
        y = Math.max(4, Math.min(y, h - menu.offsetHeight - 4));
        menu.style.left = `${box.left + x}px`;
        menu.style.top = `${box.top + y}px`;
      }

      input.addEventListener('input', () => { query = input.value; said = ''; draw(); });
      const active = () => (env.root && env.root.activeElement) || document.activeElement;
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
        if (e.key === 'Tab') { closeMenu(); return; }
        const now = active();
        if (!now || !menu.contains(now)) return;
        const stops = [input, ...rows()];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const at = stops.indexOf(now);
          stops[menuStep(stops.length, at, e.key === 'ArrowDown' ? 1 : -1)].focus();
        } else if (e.key === 'Enter' && now === input) {
          e.preventDefault();
          // Enter in an empty box does nothing. With text it ticks the tag named exactly that, else the first match; it makes a
          // tag only when nothing matches and the person may (the one row left is "Create").
          const q = normal(query);
          if (!q) return;
          const target = rows().find((b) => b.getAttribute('role') === 'menuitemcheckbox' && b.textContent === q) || rows()[0];
          if (target) target.click();
        }
      };
      const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
      watchers.add(draw);
      document.addEventListener('keydown', onKey, true);
      env.root.addEventListener('pointerdown', onOutside, true);
      container.appendChild(menu);
      openMenu = {
        id: 'tags-picker',
        menu,
        cleanup: () => {
          watchers.delete(draw);
          menu.remove();
          document.removeEventListener('keydown', onKey, true);
          env.root.removeEventListener('pointerdown', onOutside, true);
          try { anchor.focus(); } catch (err) { /* not focusable */ }
        },
      };
      draw();
      input.focus();
      if (!cache) readyPromise.then(() => tags.list()).then(() => {}, (err) => { loadFailed = (err && err.message) || 'The tags could not be read.'; if (openMenu && openMenu.menu === menu) draw(); });
      return {
        close: closeMenu,
        set(ids) { ticked = [...new Set(Array.isArray(ids) ? ids.filter((s) => typeof s === 'string') : [])]; if (openMenu && openMenu.menu === menu) draw(); },
      };
    }

    const tags = {
      list: ({ fresh } = {}) => {
        if (cache && fresh !== true) return Promise.resolve(sorted());
        if (!loading) loading = readyPromise.then(load);
        return loading;
      },
      add: async (name, options) => {
        if (typeof name !== 'string') throw Object.assign(new Error('A tag needs a name.'), { status: 400 });
        const given = options && typeof options === 'object' && typeof options.color === 'string' ? options.color.trim() : '';
        const color = given.toLowerCase();
        if (color && !TAG_HEX.test(color)) throw Object.assign(new Error("A tag's colour must be a colour (#rrggbb), or none."), { status: 400 });
        await readyPromise;
        const tag = cleanTagShape(await call('tags.add', { name, color }));
        if (!tag) throw Object.assign(new Error('The server did not send a tag.'), { status: 502 });
        if (cache) { cache.set(tag.id, tag); tell(); }
        return tag;
      },
      chip,
      picker,
      filterOptions: (counts) => {
        const have = counts instanceof Map ? counts : new Map(Object.entries(counts && typeof counts === 'object' ? counts : {}));
        return sorted().filter((t) => have.has(t.id)).map((t) => {
          const n = Math.floor(Number(have.get(t.id)));
          return { id: t.id, label: t.name, default: false, ...(Number.isFinite(n) && n >= 0 ? { count: n } : {}), ...(t.color ? { tint: t.color } : {}) };
        });
      },
    };
    return tags;
  }
  host.tags = makeTags();

  const destinationApi = {
    onState: (fn) => {
      let heard = false;
      const off = host.on('destination', (state) => { heard = true; destinationState = state; fn(state); });
      // The state as it is now, unless a change already brought a newer one.
      if (destinationState) setTimeout(() => { if (!heard) fn(destinationState); }, 0);
      return off;
    },
    set: (patch) => call('destination.set', { patch }),
  };
  // Kept current even before a part asks, so onState starts from the latest.
  host.on('destination', (state) => { destinationState = state; });
  // A move between docked and floating takes the module's box out of the page and back, which drops an open editor
  // window out of the top layer: show it modal again.
  // The space's phases changed (the host page read them again): keep host.space().phases and createdAt current, and add the
  // timeline (host.util.phaseTimeline(), each band with its colour) to what the module hears. Registered first, so it runs before the module's.
  host.on('phases', (e) => {
    if (info && info.space && e && e.phases) {
      info.space.phases = e.phases;
      if (e.created) info.space.createdAt = e.created;
    }
    try { e.timeline = host.util.phaseTimeline(); } catch (err) { e.timeline = []; }
  });
  // The phases' state changed (a Done switch, or a goal that names a phase): keep host.phases() current. Registered first.
  host.on('phaseStates', (e) => {
    if (info && e && Array.isArray(e.phases)) { info.phases = e.phases; info.phaseMeasure = e.measure || 'dates'; }
  });
  // The space's budget target changed: keep host.space().budget current. Registered first, so it runs before the module's.
  host.on('space', (e) => {
    if (info && info.space && e && 'budget' in e) info.space.budget = e.budget || null;
  });
  host.on('moved', () => { for (const e of openEditors.values()) e.reopen(); });
  // The standard actions (host.standard.set): the handlers stay here, the host hears which there are. A pick arrives as
  // 'standard' { id }; Share answers with what to share, Print says it is ready (its page measured at its full height in
  // a frame, which the stylesheet's .sdk-printing lets run on) and puts the page back on 'printed'.
  const STANDARD_IDS = ['settings', 'share', 'print'];
  let standardRun = {};
  function setStandard(spec) {
    return readyPromise.then(() => {
      const s = spec && typeof spec === 'object' ? spec : {};
      const run = {};
      const declared = {};
      for (const id of STANDARD_IDS) {
        const v = s[id];
        const o = typeof v === 'function' ? { run: v } : v && typeof v === 'object' && typeof v.run === 'function' ? v : null;
        if (!o || (o.permission && !host.can(o.permission))) continue;
        run[id] = o.run;
        declared[id] = { ...(o.disabled ? { disabled: true } : {}), ...(o.hint ? { hint: String(o.hint).slice(0, 40) } : {}) };
      }
      standardRun = run;
      return call('standard.set', { actions: declared });
    });
  }
  host.on('standard', async (e) => {
    const id = e && e.id;
    const fn = standardRun[id];
    if (!fn) return;
    try {
      if (id === 'settings') { await fn(); return; }
      if (id === 'share') {
        const r = await fn();
        if (r) await call('share.show', r);
        return;
      }
      if (id === 'print') {
        if ((await fn()) === false) return;
        // In a frame (env.root is the frame's document) the page runs on at its full height while it prints; a module in
        // the page (env.root a shadow root) prints with it as it is.
        const doc = env.root && env.root.documentElement ? env.root : null;
        if (doc) doc.documentElement.classList.add('sdk-printing');
        const height = doc ? doc.documentElement.scrollHeight : 0;
        const ok = await call('print.run', { height });
        if (!ok && doc) doc.documentElement.classList.remove('sdk-printing');
      }
    } catch (err) {
      console.error(err);
    }
  });
  host.on('printed', () => { if (env.root && env.root.documentElement) env.root.documentElement.classList.remove('sdk-printing'); });
  // The host put a lifted frame back itself: the topmost open editor closes as Escape does.
  host.on('editordismiss', () => { const top = [...openEditors.entries()].filter(([d]) => d.open).pop(); if (top) top[1].dismiss(); });
  // The viewport crossed the phone line while lifted: the dialog's rules follow.
  host.on('editorlift', (d) => { for (const dlg of openEditors.keys()) if (dlg.classList.contains('sdk-editor-lifted')) dlg.dataset.lift = d && d.phone ? 'phone' : 'window'; });

  // The hard break (plan-names step 7): refs became objects. A module that still reaches for the old names is told
  // which to use, instead of failing later on an undefined. Not enumerable, so nothing that walks the SDK trips on them.
  const renamed = (what, use) => ({ enumerable: false, get() { throw Object.assign(new Error(`${what} is an old name; use ${use}`), { status: 400 }); } });
  Object.defineProperty(host, 'refs', renamed('host.refs', 'host.objects'));
  Object.defineProperty(host.util, 'refKey', renamed('host.util.refKey', 'host.util.objectKey'));

  return { host, emit };
  }

  // --- a module's actions library, carried out on its page (plan-agent-edit-delete.md, decision 4, step 2) -------------------
  // A module keeps its action rules in one plain library, src/<id>-lib-actions.js, defining
  //   const ACTION_HANDLERS = { <action>: (input, ctx) => ({ writes, ref?, data? }) };
  // the very code server/module-actions.js runs for an agent's request to a bundled module that declares it (actions.server).
  // host.actions.fromLibrary(ACTION_HANDLERS, o) answers handlers for host.actions.provide that run it here exactly as the
  // runner does there, so a page and the server give the same answer:
  //   - `ctx` is the runner's: { from, by, byKey, credit, now, tz, space, action, read(key), list(prefix) }, `credit` the one
  //     provide gives (the asker when the server knows them), read and list synchronous, over this module's data here as it
  //     was when the request was taken (each a copy), plus the facts below;
  //   - its answer is held to the runner's rules (at most LIBRARY_WRITES writes, each exactly { key, value }, no delete, a
  //     pointer only to this module's own object here, `data` plain and small); a throw is a refusal, its message the
  //     sentence the asker reads, on one line;
  //   - each write goes through host.storage.set with the version the handler read (none: it must still be absent), so the
  //     server checks it as any write of this page's; one refused write puts back the ones before it, and nothing is left
  //     half done. A value changed meanwhile is refused with the runner's own sentence.
  // The facts, the same plain data the runner hands a library: `space` { id, name, currency, defaultCurrency, phases: [{ id,
  // main }], bands } (`currency` the space's budget's, `defaultCurrency` the server's; bands: host.util.phaseTimeline(), []
  // without phases), `people` [{ key, name }], `refs` { <objectKey>: { title,
  // subtitle, kind, copy?, original? } } for each pointer in the input, as this person may see it (`original`, for a copy:
  // { module, name } of what it copies), and `util`: the SDK's plain, localWhen, detailLines, time, ymd, parseYmd,
  // objectKey, id and word, the only functions it gets.
  // `o.after({ action, input, writes: [{ key, value, version, before }], ref, data })` runs once the writes are in, for what
  // only a page does (redraw at once, tell the host about links, set a reminder); a throw from it is the request's answer,
  // the writes kept. `o.only` (names) keeps only those handlers.
  const LIBRARY_WRITES = 10; // as server/module-actions.js LIMITS.writes
  const LIBRARY_SENTENCE = 200; // as its LIMITS.sentence
  const LIBRARY_DATA = 8000; // as its LIMITS.answerDataBytes
  const LIBRARY_CHANGED = 'That changed while it was being done, so nothing was changed. Read it again and ask again.';
  const libraryLine = (v) => String(v == null ? '' : v).replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, LIBRARY_SENTENCE);
  const libraryPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const libraryCopy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  // What a handler answered, held to the runner's rules (server/module-actions.js outcomeOf): { writes, ref, data } or a throw
  // with the sentence. `own(ref)` says whether a pointer is this module's own object here; `name` is the module's.
  function libraryOutcome(answer, own, name) {
    const fault = (why) => new Error(`${name} could not carry that out: ${why}.`);
    const result = answer === undefined || answer === null ? {} : answer;
    if (!libraryPlain(result) || Object.keys(result).some((k) => !['writes', 'ref', 'data'].includes(k))) throw fault('it answered something the server can\'t use');
    const given = result.writes === undefined || result.writes === null ? [] : result.writes;
    if (!Array.isArray(given)) throw fault('it answered something the server can\'t use');
    if (given.length > LIBRARY_WRITES) throw fault(`it tried to change more than ${LIBRARY_WRITES} things at once`);
    const writes = [];
    const seen = new Set();
    for (const w of given) {
      if (!libraryPlain(w)) throw fault('it answered something the server can\'t use');
      if (Object.prototype.hasOwnProperty.call(w, 'delete')) throw fault('it tried to delete something, which needs a person\'s approval');
      if (Object.keys(w).some((k) => k !== 'key' && k !== 'value')) throw fault('it tried to write outside its own data here');
      if (typeof w.key !== 'string' || !w.key || w.key.length > 128 || seen.has(w.key) || w.value === undefined) throw fault('it answered something the server can\'t use');
      seen.add(w.key);
      writes.push({ key: w.key, value: libraryCopy(w.value) });
    }
    let ref = null;
    if (result.ref !== undefined && result.ref !== null) {
      if (!libraryPlain(result.ref) || !own(result.ref)) throw fault('it pointed at something that is not its own here');
      ref = libraryCopy(result.ref);
    }
    let data;
    if (result.data !== undefined && result.data !== null) {
      const text = JSON.stringify(result.data);
      if (text.length > LIBRARY_DATA) throw fault('it answered more than the server takes');
      data = JSON.parse(text);
    }
    return { writes, ref, ...(data !== undefined ? { data } : {}) };
  }
  // The pointers in a request's input (its own fields, as the bus checks them): what `refs` describes.
  const libraryPointers = (input) => Object.values(input && typeof input === 'object' ? input : {})
    .filter((v) => libraryPlain(v) && typeof v.module === 'string' && typeof v.kind === 'string' && typeof v.id === 'string');
  // The facts a handler is given beside the data (see above), read from this page's host.
  async function libraryFacts(host, input) {
    const util = host.util || {};
    const sp = typeof host.space === 'function' ? host.space() : null;
    const phases = typeof host.phases === 'function' ? (host.phases() || []) : [];
    let bands = [];
    if (phases.length && typeof util.phaseTimeline === 'function') { try { bands = util.phaseTimeline() || []; } catch (err) { bands = []; } }
    let people = [];
    try { people = typeof host.people === 'function' ? (await host.people()) || [] : []; } catch (err) { people = []; }
    const refs = {};
    const pointers = libraryPointers(input);
    if (pointers.length && host.objects && typeof host.objects.resolve === 'function') {
      let got = [];
      try { got = await host.objects.resolve(pointers); } catch (err) { got = []; }
      const copies = [];
      pointers.forEach((p, i) => {
        const s = got[i];
        const k = util.objectKey(p);
        if (!s || s.error) { refs[k] = { error: (s && s.error) || 'unavailable' }; return; }
        refs[k] = { title: typeof s.title === 'string' ? s.title : '', subtitle: typeof s.subtitle === 'string' ? s.subtitle : '', kind: s.kind || p.kind };
        if (s.copy === true && libraryPlain(s.twinOf)) { refs[k].copy = true; copies.push([k, s.twinOf]); }
      });
      if (copies.length) {
        let originals = [];
        try { originals = await host.objects.resolve(copies.map((c) => c[1])); } catch (err) { originals = []; }
        copies.forEach(([k, twin], i) => {
          const s = originals[i];
          refs[k].original = { module: twin.module, name: (s && !s.error && s.module && s.module.name) || '' };
        });
      }
    }
    const budget = sp && sp.budget && typeof sp.budget.currency === 'string' ? sp.budget.currency.trim().toUpperCase() : '';
    const loc = typeof host.locale === 'function' ? host.locale() || {} : {};
    const deflt = typeof loc.currency === 'string' ? loc.currency.trim().toUpperCase() : '';
    return {
      space: { id: sp ? sp.id : null, name: sp && typeof sp.name === 'string' ? sp.name : '', currency: budget, defaultCurrency: deflt, phases: phases.map((p) => ({ id: p.id, main: Boolean(p.main) })), bands: libraryCopy(bands) },
      people: (Array.isArray(people) ? people : []).filter((p) => p && typeof p.key === 'string').map((p) => ({ key: p.key, name: String(p.name || '') })),
      refs,
    };
  }
  // The SDK helpers a handler may call (`ctx.util`): plain functions of their arguments, the same ones the runner hands it.
  const libraryUtil = (util) => Object.freeze(Object.fromEntries(['plain', 'localWhen', 'detailLines', 'time', 'ymd', 'parseYmd', 'objectKey', 'id', 'word']
    .filter((k) => typeof util[k] === 'function').map((k) => [k, util[k]])));
  // One request carried out with the library's handler `fn` (see above). `carried` is what provide gives: { from, by, byKey, credit }.
  async function carryLibrary(host, name, fn, input, carried, o) {
    const util = host.util || {};
    const mod = (o && typeof o.module === 'function' ? o.module() : null) || {};
    const moduleName = typeof mod.name === 'string' && mod.name ? mod.name : 'This module';
    const here = typeof host.space === 'function' && host.space() ? host.space().id : null;
    const own = (ref) => typeof ref.id === 'string' && Boolean(ref.id) && typeof ref.kind === 'string' && typeof mod.id === 'string' && ref.module === mod.id && ref.scope === 'space' && ref.space === here;
    const rows = await host.storage.list('');
    const data = new Map();
    const versions = new Map();
    for (const r of rows || []) { data.set(r.key, r.value); versions.set(r.key, r.version || 0); }
    const facts = await libraryFacts(host, input);
    let tz = 'UTC';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (err) { tz = 'UTC'; }
    const credit = carried.credit || { name: '', key: '' };
    const ctx = libraryCopy({ from: carried.from || null, by: carried.by || null, byKey: carried.byKey || null, credit: { name: String(credit.name || ''), key: String(credit.key || '') }, now: Date.now(), tz, space: facts.space, people: facts.people, refs: facts.refs, action: name });
    ctx.read = (key) => (typeof key === 'string' && data.has(key) ? libraryCopy(data.get(key)) : null);
    ctx.list = (prefix) => {
      const p = typeof prefix === 'string' ? prefix : '';
      return [...data.keys()].filter((k) => k.startsWith(p)).map((k) => ({ key: k, value: libraryCopy(data.get(k)) }));
    };
    ctx.util = libraryUtil(util);
    let answer;
    try {
      answer = await fn(libraryCopy(input), ctx);
    } catch (err) {
      throw new Error(libraryLine(err && typeof err.message === 'string' ? err.message : err) || `${moduleName} could not do that.`);
    }
    const outcome = libraryOutcome(answer, own, moduleName);
    const applied = [];
    for (const w of outcome.writes) {
      try {
        const saved = await host.storage.set(w.key, w.value, { version: versions.get(w.key) || 0 });
        applied.push({ key: w.key, value: w.value, version: saved && saved.version, before: data.has(w.key) ? libraryCopy(data.get(w.key)) : null });
      } catch (err) {
        // Put back what was written before, newest first: the value as it was, or no value where there was none.
        for (const a of [...applied].reverse()) {
          try {
            if (a.before !== null) await host.storage.set(a.key, a.before, { version: a.version });
            else await host.storage.delete(a.key, { version: a.version });
          } catch (e) { /* changed again meanwhile: left as it is */ }
        }
        throw new Error(err && err.status === 409 ? LIBRARY_CHANGED : libraryLine(err && err.message) || `${moduleName} could not do that.`);
      }
    }
    // On a module's environment page (no space: ctx.space.id is null) the pointer a handler made is to this page's own place.
    const ref = outcome.ref && here === null && host.objects && typeof host.objects.make === 'function' ? host.objects.make(outcome.ref.kind, outcome.ref.id) : outcome.ref;
    if (o && typeof o.after === 'function') await o.after({ action: name, input, writes: applied, ref, data: outcome.data });
    return { ...(ref ? { ref } : {}), ...(outcome.data !== undefined ? { data: outcome.data } : {}) };
  }
  // Handlers for provide, one for each of the library's (or of o.only).
  function libraryHandlers(host, handlers, o) {
    const out = {};
    const only = o && Array.isArray(o.only) ? new Set(o.only) : null;
    for (const name of Object.keys(handlers || {})) {
      if (typeof handlers[name] !== 'function' || (only && !only.has(name))) continue;
      out[name] = (input, carried) => carryLibrary(host, name, handlers[name], input, carried || {}, o || {});
    }
    return out;
  }

  // A the host page that hosts modules includes this file with data-host-sdk, to build SDKs for modules
  // that run in the page; anywhere else, inside a frame, it boots for the module in that frame.
  const hostPage = Boolean(document.currentScript && document.currentScript.hasAttribute('data-host-sdk'));
  if (!hostPage && global.parent !== global) {
    // In a sandboxed frame: talk to the page that hosts it.
    const pending = new Map();
    let seq = 0;
    // The host puts a secret in this frame's address and in every message it sends; every call carries it back.
    const secret = new URLSearchParams(global.location.search).get('tk');
    const call = (method, params) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      global.parent.postMessage({ host: 1, tk: secret, id, method, params }, '*');
      if (method === 'ui.confirm' || method === 'ui.prompt' || method === 'objects.pick') return; // a question waits as long as the person takes
      setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error('the host did not answer'));
      }, 30000);
    });
    // The theme arrives as CSS custom properties; setting them on :root lets a module's plain CSS follow
    // the theme (var(--bg), var(--text) ...).
    // The page leaves out a role the theme doesn't set, so a name set last time and missing now is removed.
    let themed = new Set();
    const applyTheme = (theme) => {
      if (!theme) return;
      const style = document.documentElement.style;
      for (const name of themed) if (!(name in theme)) style.removeProperty(name);
      for (const [name, value] of Object.entries(theme)) style.setProperty(name, value);
      themed = new Set(Object.keys(theme));
    };
    const built = createHost({
      call,
      root: document,
      rootElement: document.documentElement,
      elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
      applyTheme,
      // An editor window's top layer is this frame's own, so the host lifts the whole frame over the canvas while one
      // is open (plan-editor-window.md, "A module in a sandboxed frame").
      lift: (open, size, height) => call('editor.lift', { open: Boolean(open), size, height }),
    });
    global.host = built.host;
    global.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.host !== 1 || m.tk !== secret) return;
      if (m.id !== undefined) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.error) {
          const err = new Error(m.error.message || 'failed');
          err.status = m.error.status;
          err.current = m.error.current;
          if (m.error.retryAfter) err.retryAfter = m.error.retryAfter; // a 429's Retry-After, in seconds
          if (Array.isArray(m.error.unread)) err.unread = m.error.unread; // host.ai.extract's 422: the sentences it could not read
          p.reject(err);
        } else {
          p.resolve(m.result);
        }
      } else if (m.event) {
        if (m.event === 'theme') applyTheme(m.data);
        built.emit(m.event, m.data);
      }
    });
  } else {
    // In the page: the host builds one per module running in the page.
    global.createHost = createHost;
  }

  // `esc`, `markdown`, `plain`, `localWhen` and `detailLines` need no per-module env, so the call page (which loads this file directly for the modules
  // it hosts in the page, not as a module itself) can use the very same rendering Chat and every module share,
  // rather than a second copy. See host.util.markdown above for what this covers.
  global.hostText = { esc, markdown, plain: plainText, localWhen, detailLines, parseClockText, clockText };
  // A module's actions library carried out on a page (libraryHandlers above), for the checks that run a module's handlers on a
  // stand-in host: fromLibrary(host, ACTION_HANDLERS, { module: () => ({ id, name }), after?, only? }).
  global.hostActions = { fromLibrary: libraryHandlers, outcome: libraryOutcome, facts: libraryFacts };
  // The currency list likewise, for Manage's Currency (a page, not a module): the same choices a module's currencySelect makes.
  global.hostCurrency = {
    fill: fillCurrencySelect,
    name: currencyName,
    common: COMMON_CURRENCIES.slice(),
    // The same searchable list a module's currencySelect draws, for a page that has no module: select(select, { value, currencies, onChange }).
    select: (select, o) => {
      const page = createHost({
        // `hello` is asked once as the host is made; a page has nothing to tell it (its locale is the page's own: `currencies` below), so the answer is empty.
        call: (method, params) => (method === 'hello' ? Promise.resolve({})
          : method === 'icons.svg'
          ? fetch(`/api/icons/${params.style === 'regular' || params.style === 'brands' ? params.style : 'solid'}/${encodeURIComponent(params.name)}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('no such icon'))))
          : Promise.reject(new Error('not available on a page'))),
        root: document,
        rootElement: document.documentElement,
        elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
        applyTheme: () => {},
      });
      return page.host.ui.currencySelect(select, o);
    },
  };
  // The view switch likewise, for the host's own pages: the toolbar a module's switch is drawn in (module-host.js),
  // Chat's Discussion | Assistant (fit only) and a destination's switches draw and fit with these. rove sets the segmented
  // switch's one Tab stop (the keyboard itself is the document's listener above); keydown is that listener, for the checks.
  global.hostSwitch = { fill: fillChoice, fit: fitSwitches, watch: watchSwitches, rove: roveSwitch, keydown: switchKeydown };
  // The colour picker likewise, for the host's own pages (plan-colour-picker.md, step 3): the same field and picker a module gets, on
  // one page host (so one picker or menu is open at a time on the page). field(input, o) is host.ui.colorField, picker(o) host.ui.colorPicker.
  // The person's colour grid on a host page (plan-colour-picker.md, "How the picker reaches it"): the page host answers ui.colorGrid and
  // ui.colorGrid.set by fetching the route itself, with one copy for the page. Not signed in (401) or a guest (403): the starting
  // colours, not editable. A list is checked before it is sent; the server checks it again.
  let pageGrid = null; // Promise<{ colors: [...] | null, editable }>
  const pageGridRead = () => {
    if (!pageGrid) {
      pageGrid = fetch('/api/me/color-grid', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(async (r) => {
          if (r.status === 401 || r.status === 403) return { colors: null, editable: false };
          if (!r.ok) throw new Error('not read');
          const a = await r.json();
          const colors = a && a.colors === null ? null : colourGridClean(a && a.colors);
          return a && (a.colors === null || colors) ? { colors, editable: true } : { colors: null, editable: false };
        })
        .catch(() => { pageGrid = null; return { colors: null, editable: false }; }); // asked again next time
    }
    return pageGrid.then((g) => ({ colors: g.colors && g.colors.map((c) => ({ ...c })), editable: g.editable }));
  };
  const pageGridWrite = async (params) => {
    const list = colourGridClean(params && params.colors);
    if (!list) throw Object.assign(new Error(Array.isArray(params && params.colors) && params.colors.length > COLOUR_GRID_MAX ? 'The grid holds at most 48 colours.' : 'Each colour is #rrggbb in lower case, with an opacity from 0 to 100, and no colour twice.'), { status: 400 });
    const r = await fetch('/api/me/color-grid', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ colors: list }) });
    let a = {};
    try { a = await r.json(); } catch (err) { /* no body */ }
    if (!r.ok) throw Object.assign(new Error(a && typeof a.error === 'string' && a.error ? a.error : "Your colours weren't saved."), { status: r.status });
    const kept = colourGridClean(a && a.colors) || list;
    pageGrid = Promise.resolve({ colors: kept, editable: true });
    return kept.map((c) => ({ ...c }));
  };
  // The person's Recent colours on a host page (decision 27), the same way: ui.colorRecent and ui.colorRecent.set fetch
  // /api/me/color-recent, with one copy for the page. Not signed in (401), a guest or an agent (403): not editable, and the picker
  // shows no Recent.
  let pageRecent = null; // Promise<{ colors: [...] | null, editable }>
  const pageRecentRead = () => {
    if (!pageRecent) {
      pageRecent = fetch('/api/me/color-recent', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then(async (r) => {
          if (r.status === 401 || r.status === 403) return { colors: null, editable: false };
          if (!r.ok) throw new Error('not read');
          const a = await r.json();
          const colors = a && a.colors === null ? null : colourRecentClean(a && a.colors);
          return a && (a.colors === null || colors) ? { colors, editable: true } : { colors: null, editable: false };
        })
        .catch(() => { pageRecent = null; return { colors: null, editable: false }; }); // asked again next time
    }
    return pageRecent.then((g) => ({ colors: g.colors && g.colors.map((c) => ({ ...c })), editable: g.editable }));
  };
  const pageRecentWrite = async (params) => {
    const list = colourRecentClean(params && params.colors);
    if (!list) throw Object.assign(new Error(Array.isArray(params && params.colors) && params.colors.length > COLOUR_RECENT_MAX ? 'Recent holds at most 8 colours.' : 'Each colour is #rrggbb in lower case, with an opacity from 0 to 100, and no colour twice.'), { status: 400 });
    const now = await pageRecentRead();
    if (!now.editable) throw Object.assign(new Error("You can't keep your own colours here."), { status: 403 });
    pageRecent = Promise.resolve({ colors: list, editable: true }); // at once, so a picker opened while it is sent shows it
    const r = await fetch('/api/me/color-recent', { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ colors: list }) });
    let a = {};
    try { a = await r.json(); } catch (err) { /* no body */ }
    if (!r.ok) { pageRecent = null; throw Object.assign(new Error(a && typeof a.error === 'string' && a.error ? a.error : "Your recent colours weren't kept."), { status: r.status }); }
    const kept = colourRecentClean(a && a.colors) || list;
    pageRecent = Promise.resolve({ colors: kept, editable: true });
    return kept.map((c) => ({ ...c }));
  };
  let colourPage = null;
  const colourUi = () => {
    if (!colourPage) {
      colourPage = createHost({
        // `hello` has nothing to tell; the grid's and Recent's calls fetch their routes (above); `icons.svg` draws the grid's Remove menu's icon.
        call: (method, params) => (method === 'hello' ? Promise.resolve({})
          : method === 'ui.colorGrid' ? pageGridRead()
          : method === 'ui.colorGrid.set' ? pageGridWrite(params)
          : method === 'ui.colorRecent' ? pageRecentRead()
          : method === 'ui.colorRecent.set' ? pageRecentWrite(params)
          : method === 'icons.svg' ? fetch(`/api/icons/${params && params.style === 'regular' ? 'regular' : 'solid'}/${encodeURIComponent(params && params.name)}`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('no such icon'))))
          : Promise.reject(new Error('not available on a page'))),
        root: document,
        rootElement: document.documentElement,
        elementAt: (pt) => document.elementFromPoint(pt.x, pt.y),
        applyTheme: () => {},
      }).host;
    }
    return colourPage.ui;
  };
  global.hostColour = { field: (input, o) => colourUi().colorField(input, o), picker: (o) => colourUi().colorPicker(o), palette: COLOUR_GRID_START, paintTag }; // palette: the 24 starting colours, read only (frozen); paintTag(el, color): a tag chip's colour
})(window);
