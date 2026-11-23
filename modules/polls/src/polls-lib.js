  // Polls' model of an object handed in (plan-object-handoff.md, "Mapping into each module"): what Chat's Send to... hands
  // draftPoll as `object`, a `poll` or a message's words. No page in it, so tools/check-object-handoff.mjs runs it on its own;
  // it is given host.util ({ plain, localWhen }), so a check can hand it the SDK's very same helpers.

  const DRAFT_QUESTION_MAX = 200;
  const DRAFT_OPTION_MAX = 100;
  const DRAFT_OPTIONS_MAX = 10;
  const isDraftDay = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };

  // What the poll form starts with: { title (the question), options: [text], closes: 'YYYY-MM-DDTHH:MM' or '', multi }.
  // The question is the title, plain. The options are details.options; with none, the content's own short lines (a message
  // "Where to eat?" then "- Pizza" and "- Sushi" on lines of their own), when there are at least two. It closes at
  // details.closes (a time alone on the object's own day), else on the object's own day at 12:00, as /p reads a typed day;
  // a closing day with no time is 12:00 too. More than one answer when details.multiple is true. Nothing is saved: the
  // person sees the form and saves it, or not.
  function pollFromObject(object, util) {
    const o = object && typeof object === 'object' ? object : {};
    const one = (v, n) => util.plain(typeof v === 'string' ? v : '', { line: true }).slice(0, n).trim();
    const title = one(o.title, DRAFT_QUESTION_MAX);
    const details = o.details && typeof o.details === 'object' && !Array.isArray(o.details) ? o.details : {};
    const options = [];
    const add = (text) => {
      const t = one(text, DRAFT_OPTION_MAX);
      if (t && t.toLowerCase() !== title.toLowerCase() && !options.some((x) => x.toLowerCase() === t.toLowerCase()) && options.length < DRAFT_OPTIONS_MAX) options.push(t);
    };
    if (Array.isArray(details.options)) for (const x of details.options) if (typeof x === 'string') add(x);
    if (options.length < 2) {
      options.length = 0;
      const lines = util.plain(typeof o.content === 'string' ? o.content : '').split('\n').map((l) => l.replace(/^\s*(?:[-*+•]|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean);
      // Short lines only: a paragraph is not an option.
      if (lines.length >= 2 && lines.every((l) => l.length <= DRAFT_OPTION_MAX)) for (const l of lines) add(l);
      if (options.length < 2) options.length = 0;
    }
    const ownDay = isDraftDay(o.date) ? o.date : null;
    const w = typeof details.closes === 'string' ? util.localWhen(details.closes, ownDay) : null;
    const day = (w && w.date) || (!w ? ownDay : null);
    const closes = day && isDraftDay(day) ? `${day}T${(w && w.time) || '12:00'}` : '';
    return { title, options, closes, multi: details.multiple === true };
  }

  // Whether a finished poll can fill another module's action (the buttons under a closed poll): it gives a title (the question
  // and its winner), notes (the question), a date (the winning option's day, when it has one; `hasDate`) and a pointer to the
  // poll, in fields of those names. An action is offered only when it takes a title and every input it requires is one of
  // those, of a type that holds it; one that needs a date (`needs`) only with a date. "Save this link" (a required `url`) is not.
  function pollFills(action, hasDate) {
    const input = action && action.input && typeof action.input === 'object' ? action.input : null;
    if (!input || !input.title) return false;
    if (Array.isArray(action.needs) && action.needs.includes('date') && !hasDate) return false;
    const fits = {
      title: (t) => t === 'string' || t === 'text',
      notes: (t) => t === 'string' || t === 'text',
      date: (t) => t === 'date' && hasDate,
      ref: (t) => t === 'ref' || t === 'ref:polls:poll',
    };
    return Object.entries(input).every(([field, type]) => {
      const t = String(type);
      if (t.endsWith('?')) return true;
      return Object.prototype.hasOwnProperty.call(fits, field) && fits[field](t);
    });
  }

  // --- a wall clock in a time zone -------------------------------------------------------------------------------------
  // A closing time is typed on a clock: the person's own on their page, the zone `tz` the request is carried out in
  // (ctx.tz, polls-lib-actions.js). With no zone, or one that can't be read, this process's own clock.
  const pollZoneFormats = new Map();
  function pollZoneFormat(tz) {
    if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
    if (!pollZoneFormats.has(tz)) {
      try {
        pollZoneFormats.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
      } catch (err) {
        pollZoneFormats.set(tz, null);
      }
    }
    return pollZoneFormats.get(tz);
  }
  // The wall clock of an instant (ms) in `tz`: { y, mo, d, h, mi } (mo 1 to 12).
  function pollWallOf(ms, tz) {
    const f = pollZoneFormat(tz);
    if (!f) { const t = new Date(ms); return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes() }; }
    const get = {};
    for (const p of f.formatToParts(new Date(ms))) get[p.type] = Number(p.value);
    return { y: get.year, mo: get.month, d: get.day, h: get.hour === 24 ? 0 : get.hour, mi: get.minute };
  }
  // The instant (ms) a wall clock day and time stands for in `tz`: found twice, for a clock change.
  function pollInstant(y, mo, d, h, mi, tz) {
    if (!pollZoneFormat(tz)) return new Date(y, mo - 1, d, h, mi).getTime();
    const want = Date.UTC(y, mo - 1, d, h, mi);
    let guess = want;
    for (let i = 0; i < 2; i += 1) {
      const w = pollWallOf(guess, tz);
      guess -= Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - want;
    }
    return guess;
  }

  // The poll an agent's request makes (createPoll), with the form's own limits and words (polls.js, save), so a poll made this
  // way is one the form could have made. `question`; `options` (a list, or text with a choice to a line or between commas);
  // `multiple` (true or false); `closes` ('YYYY-MM-DD', noon as the form's default, or 'YYYY-MM-DDTHH:MM' on the clock of
  // `tz`, else this process's). Returns { question, options: [text], multi, closesAt (ms or null) }; throws an Error in plain
  // words. `now` is for a check. updatePoll (polls-lib-actions.js) uses the same pieces, so an edit is held to the same words.
  const POLL_QUESTION_MAX = 200;
  const POLL_OPTION_MAX = 100;
  const POLL_OPTIONS_MAX = 20;
  const pollClean = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  function pollQuestionOf(value) {
    const question = typeof value === 'string' ? pollClean(value) : '';
    if (!question) throw new Error('A poll needs a question.');
    if (question.length > POLL_QUESTION_MAX) throw new Error(`A question can be ${POLL_QUESTION_MAX} letters at most.`);
    return question;
  }
  function pollOptionsOf(value) {
    let raw = value;
    if (typeof raw === 'string') raw = raw.split(/[\n,]/);
    if (!Array.isArray(raw)) raw = [];
    const options = raw.filter((x) => typeof x === 'string').map(pollClean).filter(Boolean);
    if (options.length < 2) throw new Error('Give at least two options.');
    if (options.length > POLL_OPTIONS_MAX) throw new Error(`A poll can have ${POLL_OPTIONS_MAX} options at most.`);
    if (options.some((o) => o.length > POLL_OPTION_MAX)) throw new Error(`An option can be ${POLL_OPTION_MAX} letters at most.`);
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new Error('Two options are the same.');
    return options;
  }
  function pollClosesOf(value, now, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(typeof value === 'string' ? value.trim() : '');
    const day = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!day || day.getUTCMonth() !== +m[2] - 1 || day.getUTCDate() !== +m[3] || (m[4] && (+m[4] > 23 || +m[5] > 59))) throw new Error('Closes needs a day, such as 2026-11-30, or a day and time, such as 2026-11-30T18:00.');
    const closesAt = pollInstant(+m[1], +m[2], +m[3], m[4] ? +m[4] : 12, m[5] ? +m[5] : 0, tz);
    if (closesAt <= (now === undefined ? Date.now() : now)) throw new Error('The closing time has to be in the future.');
    return closesAt;
  }
  function pollFromRequest(input, now, tz) {
    const i = input && typeof input === 'object' ? input : {};
    const question = pollQuestionOf(i.question);
    const options = pollOptionsOf(i.options);
    if (i.multiple !== undefined && i.multiple !== null && typeof i.multiple !== 'boolean') throw new Error('Say whether several answers are allowed with true or false.');
    const closesAt = i.closes !== undefined && i.closes !== null && i.closes !== '' ? pollClosesOf(i.closes, now, tz) : null;
    return { question, options, multi: i.multiple === true, closesAt };
  }
