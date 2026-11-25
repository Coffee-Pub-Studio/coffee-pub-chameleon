  // The Research module's model: no page in it, so the page and the checks can both use it. An item is one stored value, kept under
  // `<kind>:<id>` (note, link, photo or answer):
  //   { kind, title, body|excerpt|content (by kind), text, sub, url, site, tags, date, point?, file?, by, at, ai? }
  // `text` is the object's plain words (what the AI reads and its summary carries), `sub` its subtitle (a link's site), `date` a day
  // (YYYY-MM-DD) or '', `point` a place on a map, `file` a photo's picture ({ id, hasThumb }), `ai` an answer's { question, sources }.
  // `rsGeo` is the SDK's place helpers (host.util.geo): the page defines `geo` ahead of this code, as the checks do; on the
  // server's runner there is none, and each action's handler takes ctx.util.geo, the same helpers (research-lib-actions.js rsStart).
  let rsGeo = typeof geo !== 'undefined' ? geo : null;
  const KINDS = ['note', 'link', 'photo', 'answer'];
  const KIND_LABEL = { note: 'Note', link: 'Link', photo: 'Photo', answer: 'Answer' };
  const KIND_ICON = { note: 'note-sticky', link: 'link', photo: 'camera', answer: 'wand-magic-sparkles' };
  // A note's type, chosen in the editor and drawn beside its title. Anything else is a general note.
  // An imported object names its icon from a wider list, and may name an everyday kind (a flight, a hotel).
  // `note` is that list's general icon. The aliases and kinds below are the ones that mean a type here.
  const NOTE_ICONS = [
    ['note-sticky', 'General'],
    ['plane', 'Flight'],
    ['hotel', 'Hotel'],
    ['map', 'Map'],
    ['train', 'Train'],
    ['bus', 'Bus'],
    ['ship', 'Ferry'],
    ['car', 'Car'],
    ['utensils', 'Meal'],
    ['mug-hot', 'Cafe'],
    ['landmark', 'Sight'],
    ['ticket', 'Ticket'],
    ['location-dot', 'Place'],
    ['lightbulb', 'Idea'],
    ['list-check', 'List'],
    ['wallet', 'Money'],
    ['suitcase', 'Packing'],
    ['circle-info', 'Info'],
  ];
  const NOTE_ICON_ALIAS = {
    bed: 'hotel',
    coins: 'wallet',
    'bag-shopping': 'suitcase',
    mountain: 'landmark',
    'circle-check': 'list-check',
    'triangle-exclamation': 'circle-info',
  };
  const NOTE_KIND_ICON = {
    flight: 'plane', train: 'train', bus: 'bus', ferry: 'ship', car: 'car',
    hotel: 'hotel', restaurant: 'utensils', cafe: 'mug-hot', bar: 'utensils',
    sight: 'landmark', museum: 'landmark', tour: 'map', show: 'ticket',
  };
  const noteIcon = (name, kind) => {
    const id = String(name || '');
    const fromName = id === 'note' ? '' : (NOTE_ICONS.some(([icon]) => icon === id) ? id : (NOTE_ICON_ALIAS[id] || ''));
    if (fromName) return fromName;
    return NOTE_KIND_ICON[String(kind || '')] || 'note-sticky';
  };
  const noteIconLabel = (name) => NOTE_ICONS.find(([icon]) => icon === noteIcon(name))[1];

  const plainText = (s, n) => String(s == null ? '' : s).replace(/\p{Cc}(?<!\n)/gu, ' ').slice(0, n);
  const isDay = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };

  // Tags are plain words, lower case, one word each (letters, digits and dashes), at most 8 to an item.
  function cleanTags(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : []) {
      const tag = String(t == null ? '' : t).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 24);
      if (tag && !out.includes(tag)) out.push(tag);
      if (out.length >= 8) break;
    }
    return out;
  }
  // What was typed in the tags field: words separated by commas or spaces ("#hotel, lisbon").
  const parseTags = (text) => cleanTags(String(text || '').split(/[\s,;]+/));

  // A web address (http or https only, no user name or password) as { href, hostname }, or null. Pure, so the page and the
  // server's runner (which has no `URL`) read an address the same way: it gives what the browser's URL gives (href) for the
  // addresses people paste (tools/check-research.mjs holds the two equal), and refuses what it does not read exactly: a user
  // name, an unusual number for a host, a host name in a script other than RS_NAME's. The steps are the URL standard's for http and https: tabs and line breaks dropped,
  // slashes after the scheme forgiven, the host lower case (a name in other letters as its xn-- form), the default port left
  // out, "." and ".." in the path settled, and what may not stand in each part percent-encoded.
  const RS_PART_SETS = { path: /[\u0000-\u0020"#<>?`{}\u007f-\uffff]/, query: /[\u0000-\u0020"#<>'\u007f-\uffff]/, fragment: /[\u0000-\u0020"<>`\u007f-\uffff]/ };
  function rsEncodePart(text, set) {
    let out = '';
    for (const ch of text) {
      if (!set.test(ch) && ch.length === 1) { out += ch; continue; }
      const code = ch.codePointAt(0);
      if (code < 0x80) { out += `%${code.toString(16).toUpperCase().padStart(2, '0')}`; continue; }
      try { out += encodeURIComponent(ch); } catch (err) { out += '%EF%BF%BD'; }
    }
    return out;
  }
  // A host label in other letters, as its punycode (RFC 3492), without the xn-- in front.
  function rsPunycode(label) {
    const cps = Array.from(label, (c) => c.codePointAt(0));
    const digit = (d) => String.fromCharCode(d + 22 + (d < 26 ? 75 : 0));
    const adapt = (d0, num, first) => { let d = first ? Math.floor(d0 / 700) : Math.floor(d0 / 2); d += Math.floor(d / num); let k = 0; while (d > 455) { d = Math.floor(d / 35); k += 36; } return k + Math.floor((36 * d) / (d + 38)); };
    let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
    const basic = out.length;
    let h = basic;
    if (basic) out += '-';
    let n = 128;
    let delta = 0;
    let bias = 72;
    while (h < cps.length) {
      const m = Math.min(...cps.filter((c) => c >= n));
      delta += (m - n) * (h + 1);
      n = m;
      for (const c of cps) {
        if (c < n) delta += 1;
        if (c !== n) continue;
        let q = delta;
        for (let k = 36; ; k += 36) {
          const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
          if (q < t) break;
          out += digit(t + ((q - t) % (36 - t)));
          q = Math.floor((q - t) / (36 - t));
        }
        out += digit(q);
        bias = adapt(delta, h + 1, h === basic);
        delta = 0;
        h += 1;
      }
      delta += 1;
      n += 1;
    }
    return out;
  }
  // Whether an xn-- label is one: its punycode reads back to a name in other letters (`ok`) whose xn-- form is the same label.
  function rsXnLabel(label, ok) {
    const code = label.slice(4);
    if (!/^[a-z0-9-]+$/.test(code)) return false;
    const cut = code.lastIndexOf('-');
    const out = cut > 0 ? Array.from(code.slice(0, cut), (c) => c.codePointAt(0)) : [];
    const val = (c) => { const x = c.charCodeAt(0); return x >= 97 && x <= 122 ? x - 97 : x >= 48 && x <= 57 ? x - 22 : 36; };
    const adapt = (d0, num, first) => { let d = first ? Math.floor(d0 / 700) : Math.floor(d0 / 2); d += Math.floor(d / num); let k = 0; while (d > 455) { d = Math.floor(d / 35); k += 36; } return k + Math.floor((36 * d) / (d + 38)); };
    let n = 128;
    let i = 0;
    let bias = 72;
    for (let p = cut > 0 ? cut + 1 : 0; p < code.length;) {
      const old = i;
      let w = 1;
      for (let k = 36; ; k += 36) {
        if (p >= code.length) return false;
        const d = val(code[p]);
        p += 1;
        if (d >= 36) return false;
        i += d * w;
        const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
        if (d < t) break;
        w *= 36 - t;
        if (i > 0x10ffff * 64) return false;
      }
      bias = adapt(i - old, out.length + 1, old === 0);
      n += Math.floor(i / (out.length + 1));
      i %= out.length + 1;
      if (n > 0x10ffff) return false;
      out.splice(i, 0, n);
      i += 1;
    }
    let name;
    try { name = String.fromCodePoint(...out); } catch (err) { return false; }
    return /[^\u0000-\u007f]/.test(name) && ok(name) && name === name.toLowerCase() && rsPunycode(name) === code;
  }
  // The letters a host name in other letters is read in here: Latin, Greek, Cyrillic, Chinese, Japanese and Korean, with digits
  // and hyphens, and accents after a letter. Other scripts have rules for a host name (mappings, right to left) not read here,
  // so such a host is refused rather than read differently from the browser.
  const RS_NAME = /^[a-z0-9\u00df-\u00f6\u00f8-\u024f\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff\u3041-\u3096\u30a1-\u30fa\u30fc\u4e00-\u9fff\uac00-\ud7a3-][a-z0-9\u00df-\u00f6\u00f8-\u024f\u0300-\u036f\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff\u3041-\u3096\u3099\u309a\u30a1-\u30fa\u30fc\u4e00-\u9fff\uac00-\ud7a3-]*$/;
  // An IPv6 address as the URL standard writes it ([1:0:0::2] is [1::2]), or null.
  function rsIpv6(text) {
    const t = text.toLowerCase();
    if (!/^[0-9a-f:.]+$/.test(t) || (t.match(/::/g) || []).length > 1) return null;
    const [headText, tailText] = t.includes('::') ? t.split('::') : [t, null];
    const groups = (part, v4ok) => {
      if (!part) return [];
      const out = [];
      const bits = part.split(':');
      for (let i = 0; i < bits.length; i += 1) {
        const b = bits[i];
        if (v4ok && i === bits.length - 1 && b.includes('.')) {
          const v4 = b.split('.');
          if (v4.length !== 4 || !v4.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && Number(x) <= 255)) return null;
          out.push(Number(v4[0]) * 256 + Number(v4[1]), Number(v4[2]) * 256 + Number(v4[3]));
        } else if (/^[0-9a-f]{1,4}$/.test(b)) out.push(parseInt(b, 16));
        else return null;
      }
      return out;
    };
    const head = groups(headText, tailText === null);
    const tail = tailText === null ? [] : groups(tailText, true);
    if (!head || !tail) return null;
    if (tailText === null ? head.length !== 8 : head.length + tail.length > 7) return null;
    const pieces = tailText === null ? head : [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
    let best = -1;
    let bestLen = 1;
    for (let i = 0; i < 8;) {
      if (pieces[i] !== 0) { i += 1; continue; }
      let j = i;
      while (j < 8 && pieces[j] === 0) j += 1;
      if (j - i > bestLen) { best = i; bestLen = j - i; }
      i = j;
    }
    const hex = (a) => a.map((x) => x.toString(16)).join(':');
    return best < 0 ? `[${hex(pieces)}]` : `[${hex(pieces.slice(0, best))}::${hex(pieces.slice(best + bestLen))}]`;
  }
  const RS_INPUT = /^[a-zA-Z0-9.\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u024f\u0300-\u036f\u0370-\u03ff\u0400-\u04ff\u1e00-\u1eff\u3002\u3041-\u3096\u3099\u309a\u30a1-\u30fa\u30fc\u4e00-\u9fff\uac00-\ud7a3\uff0e\uff61-]*$/;
  function rsHost(raw) {
    if (raw.startsWith('[')) return rsIpv6(raw.slice(1, -1));
    let host;
    try { host = decodeURIComponent(raw); } catch (err) { return null; }
    if (/[^\u0000-\u007f]/.test(host) && (!RS_INPUT.test(host) || /[\u1e9e]/.test(host))) return null;
    // Lower case one letter at a time: a capital sigma is a small one wherever it stands, as a host name has it.
    host = Array.from(host.replace(/[\u3002\uff0e\uff61]/g, '.'), (c) => c.toLowerCase()).join('').normalize('NFC');
    if (!host || /[\u0000-\u0020#%/:<>?@[\\\]^|\u007f]/.test(host)) return null;
    // A name in other letters is taken only when it is plain letters, marks and digits that need no mapping (NFKC leaves it as
    // it is), so its xn-- form is the one the URL standard gives; an xn-- label already written must be one.
    const labels0 = host.split('.');
    const plainName = (l) => RS_NAME.test(l) && /^[\p{L}\p{N}-][\p{L}\p{M}\p{N}-]*$/u.test(l) && !/[\u034f\u04c0\u04cf]/.test(l) && l.normalize('NFKC') === l && [...l].every((c) => c === '\u00df' || c === '\u03c2' || c.toUpperCase().toLowerCase() === c) && !/^xn--/.test(l);
    if (labels0.some((l) => (/^[\u0000-\u007f]*$/.test(l) ? /^xn--/.test(l) && !rsXnLabel(l, plainName) : !plainName(l)))) return null;
    host = labels0.map((l) => (/^[\u0000-\u007f]*$/.test(l) ? l : `xn--${rsPunycode(l)}`)).join('.');
    const labels = host.split('.');
    const last = labels[labels.length - 1] === '' && labels.length > 1 ? labels[labels.length - 2] : labels[labels.length - 1];
    if (/^(0x[0-9a-f]*|\d+)$/.test(last)) {
      // A host that ends in a number is an IPv4 address: taken only as four plain numbers up to 255, as it is written.
      if (labels.length !== 4 || !labels.every((l) => /^(0|[1-9]\d{0,2})$/.test(l) && Number(l) <= 255)) return null;
    }
    return host;
  }
  function rsUrl(text, max = 500) {
    const t = String(text || '').trim().replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
    const sm = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(t);
    const scheme = sm ? sm[1].toLowerCase() : '';
    if (scheme !== 'http' && scheme !== 'https') return null;
    const rest = t.slice(sm[0].length).replace(/^[/\\]*/, '');
    const end = rest.search(/[/\\?#]/);
    const authority = end < 0 ? rest : rest.slice(0, end);
    let tail = end < 0 ? '' : rest.slice(end);
    if (authority.includes('@')) return null;
    let rawHost = authority;
    let port = '';
    if (authority.startsWith('[')) {
      const close = authority.indexOf(']');
      if (close < 0) return null;
      rawHost = authority.slice(0, close + 1);
      const after = authority.slice(close + 1);
      if (after && !after.startsWith(':')) return null;
      port = after.slice(1);
    } else if (authority.includes(':')) {
      rawHost = authority.slice(0, authority.indexOf(':'));
      port = authority.slice(authority.indexOf(':') + 1);
    }
    if (!/^\d*$/.test(port)) return null;
    if (port) {
      const num = Number(port);
      if (num > 65535) return null;
      port = (scheme === 'http' && num === 80) || (scheme === 'https' && num === 443) ? '' : String(num);
    }
    const hostname = rsHost(rawHost);
    if (!hostname) return null;
    let fragment = null;
    let query = null;
    const hash = tail.indexOf('#');
    if (hash >= 0) { fragment = tail.slice(hash + 1); tail = tail.slice(0, hash); }
    const ask = tail.indexOf('?');
    if (ask >= 0) { query = tail.slice(ask + 1); tail = tail.slice(0, ask); }
    const parts = tail ? tail.replace(/\\/g, '/').slice(1).split('/') : [''];
    const path = [];
    parts.forEach((seg, i) => {
      const lastSeg = i === parts.length - 1;
      const low = seg.toLowerCase();
      if (['..', '.%2e', '%2e.', '%2e%2e'].includes(low)) { path.pop(); if (lastSeg) path.push(''); return; }
      if (low === '.' || low === '%2e') { if (lastSeg) path.push(''); return; }
      path.push(rsEncodePart(seg, RS_PART_SETS.path));
    });
    const href = `${scheme}://${hostname}${port ? `:${port}` : ''}/${path.join('/')}${query !== null ? `?${rsEncodePart(query, RS_PART_SETS.query)}` : ''}${fragment !== null ? `#${rsEncodePart(fragment, RS_PART_SETS.fragment)}` : ''}`;
    if (href.length > max) return null;
    return { href, hostname };
  }
  function cleanUrl(text, max = 500) {
    const u = rsUrl(text, max);
    return u ? u.href : null;
  }
  const siteOf = (url) => { const u = rsUrl(url, Infinity); return u ? u.hostname.replace(/^www\./, '') : ''; };

  // The fields that belong to a kind, and the one that holds its words.
  const BODY_FIELD = { note: 'body', link: 'excerpt', photo: 'title', answer: 'content' };

  // A stored value as an item, or null when it is not one.
  function cleanItem(kind, id, v) {
    if (!KINDS.includes(kind) || !v || typeof v !== 'object') return null;
    let title = rsGeo.oneLine(v.title, 120);
    const url = kind === 'link' ? cleanUrl(v.url) : null;
    if (kind === 'link' && !url) return null;
    if (!title && kind === 'link') title = siteOf(url);
    if (!title && kind === 'note') title = rsGeo.oneLine(String(v.body || '').split('\n')[0], 120);
    if (!title && kind === 'photo') title = 'Photo';
    if (!title) return null;
    const item = {
      id: String(id),
      kind,
      title,
      body: kind === 'note' ? plainText(v.body, 8000) : '',
      excerpt: kind === 'link' ? plainText(v.excerpt, 2000) : '',
      content: kind === 'answer' ? plainText(v.content, 8000) : '',
      url: url || '',
      site: url ? siteOf(url) : '',
      image: '',
      tags: cleanTags(v.tags),
      date: isDay(v.date) ? v.date : '',
      point: null,
      file: null,
      by: typeof v.by === 'string' ? v.by.slice(0, 64) : '',
      at: typeof v.at === 'string' ? v.at.slice(0, 32) : '',
      ai: null,
      icon: kind === 'note' ? noteIcon(v.icon) : '',
    };
    if (v.point && typeof v.point === 'object') {
      const lat = Number(v.point.lat);
      const lng = Number(v.point.lng);
      if (rsGeo.inRange(lat, lng)) item.point = { lat: rsGeo.round6(lat), lng: rsGeo.round6(lng), ...(typeof v.point.name === 'string' && v.point.name.trim() ? { name: rsGeo.oneLine(v.point.name, 120) } : {}) };
    }
    if (kind === 'link') {
      const image = cleanUrl(v.image, 2000);
      if (image) item.image = image;
    }
    if (kind === 'photo' && v.file && typeof v.file.id === 'string' && /^[a-f0-9]{24}$/.test(v.file.id)) item.file = { id: v.file.id, hasThumb: v.file.hasThumb === true };
    if (kind === 'photo' && !item.file) return null;
    if (kind === 'answer' && v.ai && typeof v.ai === 'object') {
      const sources = (Array.isArray(v.ai.sources) ? v.ai.sources : []).filter((r) => r && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string').slice(0, 12)
        .map((r) => ({ module: r.module.slice(0, 40), kind: r.kind.slice(0, 40), id: r.id.slice(0, 64), ...(typeof r.scope === 'string' ? { scope: r.scope.slice(0, 10) } : {}), ...(typeof r.space === 'string' ? { space: r.space.slice(0, 20) } : {}), ...(typeof r.label === 'string' ? { label: rsGeo.oneLine(r.label, 80) } : {}) }));
      item.ai = { question: rsGeo.oneLine(v.ai.question, 1000), sources };
    }
    return item;
  }
  // A stored link whose address is not a web address (a `javascript:` link, say) is not drawn as a link: it shows as an
  // unreadable one, which can be removed and nothing else. It is never saved back.
  function unreadable(kind, id, v) {
    if (kind !== 'link' || !v || typeof v !== 'object') return null;
    return { id: String(id), kind, title: 'Unreadable link', body: '', excerpt: 'This address cannot be used. Remove it.', content: '', url: '', site: '', image: '', tags: [], date: '', point: null, file: null, by: typeof v.by === 'string' ? v.by.slice(0, 64) : '', at: typeof v.at === 'string' ? v.at.slice(0, 32) : '', ai: null, icon: '', broken: true };
  }
  // The plain words of an item, for a search and for the AI.
  const textOf = (it) => (it.kind === 'photo' ? it.title : it[BODY_FIELD[it.kind]] || '');
  // What is stored for an item: only what its kind uses, plus the derived `text` and `sub` its summary carries.
  function itemValue(it) {
    const v = { kind: it.kind, title: it.title, tags: it.tags, date: it.date, by: it.by, at: it.at, text: textOf(it), sub: it.kind === 'link' ? it.site : '' };
    if (it.kind === 'note') { v.body = it.body; v.icon = noteIcon(it.icon); }
    if (it.kind === 'link') { v.url = it.url; v.excerpt = it.excerpt; if (it.image) v.image = it.image; }
    if (it.kind === 'answer') { v.content = it.content; if (it.ai) v.ai = it.ai; }
    if (it.kind === 'photo' && it.file) v.file = it.file;
    if (it.point) v.point = it.point;
    return v;
  }

  // What was typed in Chat `/n` and `/l` (or the old quick-add): a web address alone is a link (its title and note are for the person to fill in);
  // anything else is a note whose title is its first line and whose body is the rest (or, for one short line, nothing).
  function readEntry(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    const url = /^\S+$/.test(t) ? cleanUrl(t) : null;
    if (url) return { kind: 'link', url, title: '', excerpt: '' };
    const lines = t.split('\n');
    const first = rsGeo.oneLine(lines[0], 120);
    const rest = lines.slice(1).join('\n').trim();
    const pt = rsGeo.parsePoint(first);
    return { kind: 'note', title: pt ? '' : first, body: rest || (first.length > 120 ? t : ''), point: pt || null };
  }

  // Search text, a kind and tags (all of them) over the items, newest first.
  function filterItems(items, { q, kind, tags }) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const need = (tags || []).filter(Boolean);
    return items
      .filter((it) => (!kind || it.kind === kind) && need.every((t) => it.tags.includes(t)) && words.every((w) => `${it.title} ${textOf(it)} ${it.site} ${it.tags.join(' ')}`.toLowerCase().includes(w)))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.title.localeCompare(b.title));
  }
  // The tags in use, most used first: [{ tag, count }].
  function tagCounts(items) {
    const n = new Map();
    for (const it of items) for (const t of it.tags) n.set(t, (n.get(t) || 0) + 1);
    return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  // The size a picture is scaled to so its long edge is at most `max`, never bigger than it is.
  function fitSize(w, h, max) {
    const scale = Math.min(1, max / Math.max(w, h, 1));
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
  }
  // A caption from a file name: "IMG_2041.jpg" -> "IMG 2041".
  const captionOf = (name) => rsGeo.oneLine(String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' '), 120);

  // --- an object handed in (plan-object-handoff.md, "Mapping into each module") -------------------------------------------
  // An object of the objects format { title, kind?, icon?, content?, details?, date?, tags?, place?, links?, basis? } as what
  // Research keeps: what an import, an AI's answer or a chat message hands saveNote, saveLink or savePhoto as `object`.
  // `util` is host.util's { plain, localWhen, detailLines }. A note's body and a link's excerpt are drawn as Markdown, so they
  // keep the content as written; the title is plain. Research has no field for any details, so each is a "Label: value" line
  // after the content (nothing is lost); then the place when it has no position, the links, and "External source" for an import.
  const OBJECT_DAY_FIELDS = ['starts', 'departs', 'checkIn', 'due'];
  const objectLine = (util, v, n) => rsGeo.oneLine(util.plain(typeof v === 'string' ? v : '', { line: true }), n);
  // A place with a position on the map, or null (a name alone is a line in the body).
  function objectPoint(place) {
    if (!place || typeof place !== 'object') return null;
    const lat = Number(place.lat);
    const lng = Number(place.lng);
    if (place.lat === undefined || place.lng === undefined || !rsGeo.inRange(lat, lng)) return null;
    const name = rsGeo.oneLine(place.name, 120);
    return { lat: rsGeo.round6(lat), lng: rsGeo.round6(lng), ...(name ? { name } : {}) };
  }
  // Its day: a details date first (when it starts, leaves, checks in or is due), else its own `date`; '' when it has none.
  function objectDay(object, util) {
    const o = object && typeof object === 'object' ? object : {};
    const details = o.details && typeof o.details === 'object' && !Array.isArray(o.details) ? o.details : {};
    for (const name of OBJECT_DAY_FIELDS) {
      if (typeof details[name] !== 'string') continue;
      const w = util.localWhen(details[name], isDay(o.date) ? o.date : null);
      if (w && w.date && isDay(w.date)) return w.date;
    }
    return isDay(o.date) ? o.date : '';
  }
  // The title and the text: the content (a message's words lose their first line, which is the title), the details lines, the
  // place, then the links (leaving out `skipUrl`, a link's own address) and "External source", cut to `max` with the tail kept.
  function objectWords(object, util, { max = 8000, skipUrl = '' } = {}) {
    const o = object && typeof object === 'object' ? object : {};
    const title = objectLine(util, o.title, 120);
    let content = typeof o.content === 'string' ? o.content.replace(/\r\n?/g, '\n').trim() : '';
    if (!o.kind && content) {
      const lines = content.split('\n');
      if (objectLine(util, lines[0], 120) === title) content = lines.slice(1).join('\n').trim();
    }
    const point = objectPoint(o.place);
    const rest = util.detailLines(o.details, { kind: o.kind });
    const placeName = o.place && typeof o.place === 'object' && !point ? rsGeo.oneLine(o.place.name, 120) : '';
    if (placeName) rest.push(`Place: ${placeName}`);
    const extras = [];
    const links = (Array.isArray(o.links) ? o.links : []).map((l) => ({ url: cleanUrl(l && l.url), title: objectLine(util, l && l.title, 100) })).filter((l) => l.url && l.url !== skipUrl);
    if (links.length) {
      extras.push('Links:');
      for (const l of links) extras.push(`- ${l.title || l.url}: ${l.url}`);
    }
    if (o.basis === 'imported') extras.push('External source');
    const suffix = extras.length ? `\n\n${extras.join('\n')}` : '';
    let text = [content, rest.join('\n')].filter(Boolean).join('\n\n');
    if (text.length + suffix.length > max) text = `${text.slice(0, Math.max(0, max - suffix.length - 1))}…`;
    return { title, text: (text + suffix).trim(), point };
  }
  // A note made of an object (saveNote): its kind and icon kept as the note's type, its tags, day and position.
  function objectNote(object, util) {
    const o = object && typeof object === 'object' ? object : {};
    const { title, text, point } = objectWords(o, util, { max: 8000 });
    return { kind: 'note', title, body: text, tags: cleanTags(o.tags), icon: noteIcon(o.icon, o.kind), date: objectDay(o, util), point };
  }
  // A link made of an object (saveLink): the address given, else the object's first link; the title and excerpt given, else
  // the object's. Null with no address.
  function objectLink(object, util, given) {
    const o = object && typeof object === 'object' ? object : {};
    const g = given || {};
    const url = cleanUrl(g.url) || (Array.isArray(o.links) ? o.links.map((l) => cleanUrl(l && l.url)).find(Boolean) : null) || null;
    if (!url) return null;
    const { title, text, point } = objectWords(o, util, { max: 2000, skipUrl: url });
    return { kind: 'link', url, title: rsGeo.oneLine(g.title, 120) || title, excerpt: g.excerpt ? plainText(g.excerpt, 2000) : text, tags: cleanTags(o.tags), date: objectDay(o, util), point };
  }

  // The items of one scope ('space' or 'person'), kept live, and what other modules may ask of them. `host` is the SDK.
  function createResearch(host, opts) {
    const scope = (opts && opts.scope) || 'space';
    const at = { scope };
    const items = new Map(); // id -> { item, version }
    const listeners = new Set();
    const changed = () => { for (const fn of listeners) fn(); };
    const split = (key) => { const i = String(key).indexOf(':'); return [String(key).slice(0, i), String(key).slice(i + 1)]; };

    const remember = (key, value, version) => {
      const [kind, id] = split(key);
      const it = value ? cleanItem(kind, id, value) || unreadable(kind, id, value) : null;
      const had = items.get(id);
      // One id is one object: another kind under the same id (the server refuses a new one) never takes its place.
      if (had && had.item.kind !== kind) return;
      if (it) items.set(id, { item: it, version });
      else items.delete(id);
    };
    async function load() {
      items.clear();
      for (const kind of KINDS) for (const it of await host.storage.list(`${kind}:`, at)) remember(it.key, it.value, it.version);
      changed();
    }
    host.on('change', (e) => {
      if (e.scope === 'spaces' || (e.scope || 'space') !== scope) return;
      const [kind] = split(e.key);
      if (!KINDS.includes(kind)) return;
      remember(String(e.key), e.deleted ? null : e.value, e.version);
      changed();
    });
    // Many at once (a Clear, its Undo): kept in one pass, announced once. Keys only (a big event comes without values): read again.
    host.on('changes', (e) => {
      if (e.scope === 'spaces' || (e.scope || 'space') !== scope) return;
      const list = (Array.isArray(e.changes) ? e.changes : []).filter((c) => KINDS.includes(split(c.key)[0]));
      if (!list.length) return;
      if (list.some((c) => !c.deleted && c.value === undefined)) { load().catch(() => {}); return; }
      for (const c of list) remember(String(c.key), c.deleted ? null : c.value, c.version);
      changed();
    });

    const list = () => [...items.values()].map((x) => x.item);
    const get = (id) => (items.get(id) || {}).item || null;
    const versionOf = (id) => (items.get(id) || {}).version;
    const refOf = (kind, id) => host.objects.make(kind, id, scope === 'person' ? { scope: 'person' } : undefined);

    // Save an item (a new one when it has no id). A stale edit is refused with the store's 409.
    async function save(p, version) {
      const id = p.id && p.id !== 'new' ? p.id : host.util.id();
      const item = cleanItem(p.kind, id, { ...p, by: p.by, at: p.at || new Date().toISOString() });
      if (!item) throw new Error('that is not complete, or not valid');
      const saved = await host.storage.set(`${item.kind}:${id}`, itemValue(item), version === undefined ? at : { ...at, version });
      items.set(id, { item, version: saved && saved.version });
      changed();
      return item;
    }
    // Remove an item and, for a photo, its picture. Whoever cannot remove the file (someone else's) still removes the item.
    async function remove(id) {
      const cur = items.get(id);
      if (!cur) return;
      await host.storage.delete(`${cur.item.kind}:${id}`, { ...at, version: cur.version });
      items.delete(id);
      if (cur.item.file) host.uploads.remove(cur.item.file.id, at).catch(() => {});
      if (scope !== 'person') host.objects.setLinks(refOf(cur.item.kind, id), []).catch(() => {});
      changed();
    }

    // What other modules may ask of this one: save a note or a link, optionally about an object of theirs.
    let composeFromText = null;
    function onCompose(fn) { composeFromText = fn; }

    // `opts`: { ready, makeThumb } from the page. ready() loads this scope's items first (savePhoto checks a picture is not a
    // photo already); makeThumb(fileId, file) makes and puts a picture's thumbnail, or answers false when this person may not
    // (only the person who added a file, or an owner, may give it one); then, or if it fails, the photo shows the picture itself.
    // A file that already has a thumbnail keeps it.
    // Only the space's research takes requests (research.js provides it there): a person's own is private, and nothing in it is
    // linked to anything.
    function provide(me, opts) {
      if (!host.actions || !host.actions.provide || scope === 'person') return;
      const o = opts || {};
      // Who asked: the person behind the request (a Keep in Chat or Assistant), else this page's own person.
      const byOf = (ctx) => (ctx && ctx.credit && ctx.credit.name) || me || '';
      // What only a page does once a request's note or link is written: it shows at once. The link to the object a note was made
      // about is in the handler's answer (`links`), done by whichever carries the request.
      const after = async ({ writes }) => {
        for (const w of writes) remember(w.key, w.value, w.version);
        changed();
      };
      host.actions.provide({
        // saveNote, saveLink, updateNote and updateLink: the actions library (ACTION_HANDLERS in research-lib-actions.js),
        // carried out here by the SDK (host.actions.fromLibrary).
        ...host.actions.fromLibrary(ACTION_HANDLERS, { after }),
        // A picture someone sent (Chat's Send to...): the page that sent it uploaded it to this module's own uploads for this
        // place, and `object.details.upload` names the file. It must be there and not a photo already; its thumbnail is made
        // here, and its caption is the picture's name (details.name), else the object's title.
        savePhoto: async (input, ctx) => {
          const obj = input && input.object && typeof input.object === 'object' ? input.object : {};
          const details = obj.details && typeof obj.details === 'object' ? obj.details : {};
          const fileId = typeof details.upload === 'string' && /^[a-f0-9]{24}$/.test(details.upload) ? details.upload : '';
          if (obj.kind !== 'image' || !fileId) throw new Error('that is not a picture');
          if (o.ready) await o.ready();
          const files = await host.uploads.list(at);
          const file = (Array.isArray(files) ? files : []).find((f) => f && f.id === fileId);
          if (!file) throw new Error('that picture is not here any more');
          if (list().some((it) => it.kind === 'photo' && it.file && it.file.id === fileId)) throw new Error('that picture is already a photo here');
          let hasThumb = file.hasThumb === true;
          // makeThumb answers false when this page's person may not give the file one (not theirs): the photo shows the picture.
          if (!hasThumb && o.makeThumb) {
            try { hasThumb = (await o.makeThumb(fileId, file)) !== false; } catch (err) { hasThumb = false; }
          }
          const title = captionOf(details.name) || objectLine(host.util, obj.title, 120) || 'Photo';
          const item = await save({ kind: 'photo', title, file: { id: fileId, hasThumb }, tags: cleanTags(obj.tags), date: objectDay(obj, host.util), by: byOf(ctx) });
          return { ref: refOf('photo', item.id) };
        },
        addNote: async (input) => {
          if (!composeFromText) throw new Error('Research is not open');
          composeFromText(String(input.text || ''));
          return {};
        },
        addLink: async (input) => {
          if (!composeFromText) throw new Error('Research is not open');
          composeFromText(String(input.text || ''), 'link');
          return {};
        },
      });
    }

    return { load, list, get, versionOf, save, remove, provide, onCompose, refOf, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  }
