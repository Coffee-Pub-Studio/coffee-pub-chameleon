  // The "Paste a booking" sheet's pure parts (plan-assistant-reboot.md, step 4): how many characters a paste holds, the rows
  // the preview draws from host.ai.extract's answer, which rows are added, and the words for an error and for what was added.
  // No page in it, so a check runs it on its own. It expects travel-lib.js in scope (KICKERS, BADGES).

  const PASTE_MAX = 30000;

  // The count under the box: "1,204 of 30,000", and `over` once the text is longer than the server reads. Characters, as the
  // server counts them (a letter outside the basic set is one).
  function pasteCount(text) {
    const n = [...String(text || '')].length;
    const over = n > PASTE_MAX;
    return { n, over, empty: !String(text || '').trim(), text: `${n.toLocaleString('en-US')} of ${PASTE_MAX.toLocaleString('en-US')}${over ? ': too long. Paste one email at a time.' : ''}` };
  }

  // A kind's icon and its word in the preview. A hotel is a Stay; the kinds the plan has no tile for are a stop.
  const PASTE_ICONS = { hotel: 'bed', note: 'note-sticky', event: 'location-dot' };
  const PASTE_WORDS = { hotel: 'Stay', note: 'Note', event: 'Event' };
  const pasteIcon = (kind) => PASTE_ICONS[kind] || BADGES[kind] || 'location-dot';
  const pasteKind = (kind) => PASTE_WORDS[kind] || KICKERS[kind] || 'Booking';

  // A point of a journey ({ code, name } or a string) as one line: "Lisbon (LIS)".
  function pastePoint(p) {
    if (typeof p === 'string') return p.trim();
    if (!p || typeof p !== 'object') return '';
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const code = typeof p.code === 'string' ? p.code.trim() : '';
    return name && code ? `${name} (${code})` : name || code;
  }

  // A local "2027-03-14T07:05" (or a day alone, or a time alone) in words: "Sun, 14 Mar, 7:05 AM". `fmt` is { day(ymd), time(hhmm) }.
  function pasteWhen(value, fallbackDay, fmt) {
    const v = typeof value === 'string' ? value.trim() : '';
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
    const day = m ? m[1] : /^\d{4}-\d{2}-\d{2}$/.test(fallbackDay || '') ? fallbackDay : '';
    const time = m ? m[2] || '' : /^\d{2}:\d{2}$/.test(v) ? v : '';
    return [day ? fmt.day(day) : '', time ? fmt.time(time) : ''].filter(Boolean).join(', ');
  }

  // The sentences a row says plainly (what was left blank and why): notes[i], a list or one sentence.
  function pasteNotes(notes, i) {
    const n = Array.isArray(notes) ? notes[i] : null;
    const list = Array.isArray(n) ? n : typeof n === 'string' ? [n] : [];
    return list.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
  }

  // The preview's rows, one per object in the answer, in its order: { index, object, checked, done, icon, kind, title, when,
  // route { from, to } for a journey, reference, cost, travellers, notes }. `fmt` is { day, time, money(n, code) }.
  function pasteRows(answer, fmt) {
    const a = answer && typeof answer === 'object' ? answer : {};
    const objects = Array.isArray(a.objects) ? a.objects : [];
    return objects.map((object, index) => {
      const o = object && typeof object === 'object' ? object : {};
      const d = o.details && typeof o.details === 'object' && !Array.isArray(o.details) ? o.details : {};
      const kind = typeof o.kind === 'string' ? o.kind : '';
      const journey = ['flight', 'train', 'bus', 'ferry', 'car'].includes(kind);
      const start = kind === 'hotel' ? d.checkIn : journey ? d.departs : d.starts;
      const end = kind === 'hotel' ? d.checkOut : journey ? d.arrives : d.ends;
      const from = journey ? pastePoint(d.from) : '';
      const to = journey ? pastePoint(d.to) : '';
      const code = typeof d.currency === 'string' && /^[A-Za-z]{3}$/.test(d.currency.trim()) ? d.currency.trim().toUpperCase() : '';
      const cost = typeof d.cost === 'number' && Number.isFinite(d.cost) ? fmt.money(d.cost, code) : '';
      const travellers = Array.isArray(d.travellers) ? d.travellers.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim()).join(', ') : '';
      const first = pasteWhen(start, o.date, fmt);
      const last = pasteWhen(end, '', fmt);
      return {
        index,
        object: o,
        checked: true,
        done: false,
        icon: pasteIcon(kind),
        kind: pasteKind(kind),
        title: typeof o.title === 'string' ? o.title.trim() : '',
        // A stay and a journey say both ends ("Sun, 14 Mar, 7:05 AM to Sun, 14 Mar, 9:50 AM"); the rest say when it starts.
        when: [first, last && (kind === 'hotel' || journey) ? `to ${last}` : ''].filter(Boolean).join(' '),
        route: from || to ? { from, to } : null,
        reference: typeof d.reference === 'string' ? d.reference.trim() : '',
        cost,
        travellers,
        notes: pasteNotes(a.notes, index),
      };
    });
  }

  // The rows that go onto the trip: ticked, not added already, in the order shown.
  const pasteChosen = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && r.checked && !r.done);

  // The words for an error, as the server worded it (its sentence, never made up here), with the unread lines it sent along.
  function pasteError(err) {
    const said = err && typeof err.message === 'string' ? err.message.trim() : '';
    const unread = err && Array.isArray(err.unread) ? err.unread.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
    return { text: said || 'The text could not be read. It is still in the box.', unread };
  }

  // What the confirmation says after Add to the trip: "3 bookings added.", "1 booking added.", and what failed.
  function pasteAdded(added, failed) {
    const n = (c, one, many) => `${c} ${c === 1 ? one : many}`;
    return [added ? `${n(added, 'booking', 'bookings')} added.` : '', failed ? `${n(failed, 'booking', 'bookings')} could not be added.` : ''].filter(Boolean).join(' ');
  }
