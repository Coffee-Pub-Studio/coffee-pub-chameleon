
  // The Calendar's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2).
  // One copy of each rule, run in two places: on the page (host.actions.fromLibrary, calendar.js) and, for an agent's request
  // to the bundled module, by the server's runner (server/module-actions.js). No page in it: each handler reads the events
  // through `ctx` and answers what to write. Times are read in `ctx.tz`, the zone of whoever carries it out (the page's
  // person, or the server's). A throw is the refusal; its message is the sentence the asker reads. It expects calendar-lib.js
  // in scope (the build puts every calendar-lib*.js together), and `parseYmd` beside it.

  const calRef = (ctx, id) => ({ module: 'calendar', kind: 'event', id, scope: 'space', space: ctx.space.id });
  const calGiven = (v) => v !== undefined && v !== null && v !== '';
  // A reminder is a schedule only a page sets (calendar.js applyReminder). Carried out on the server (ctx.carrier 'server'), an
  // event with a reminder is marked `remindPending` and the page that next opens it sets it and takes the mark off (calendar.js
  // setWaitingReminders); the server takes off the reminder the event had (it was set from the event as it was). Never silent:
  // the request's note says so. Carried out on a page, the page sets it at once (afterAction) and there is no mark.
  const CAL_REMIND_LATER = 'Its reminder is set the next time someone who can change events opens the calendar.';
  function calReminder(ev, ctx) {
    if (ctx.carrier === 'server' && ev.remind !== null && ev.remind !== undefined) { ev.remindPending = true; return CAL_REMIND_LATER; }
    delete ev.remindPending;
    return '';
  }
  // A clock time of a Date as "HH:MM".
  const calClock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // An event as the form shows it, read in `tz`: { date, time, endDate, endTime, allDay } (the times null for an all-day one).
  function calFormOf(ev, tz) {
    if (ev.allDay) return { allDay: true, date: ev.start, time: null, endDate: ev.end || null, endTime: null };
    const at = (v) => { const d = new Date(v); return zoneOk(tz) ? wallIn(d, tz) : d; };
    const s = at(ev.start);
    const e = ev.end ? at(ev.end) : null;
    return { allDay: false, date: ymdOf(s), time: calClock(s), endDate: e ? ymdOf(e) : null, endTime: e ? calClock(e) : null };
  }

  // --- remindAt: the reminder as a clock time, instead of minutes before (remind) ---------------------------------------------
  // A date and time ("2026-11-24 11:00", "2026-11-24T11:00", "2026-11-24 9am"), or a time alone ("11:00", "11:00 AM", "9am") on
  // the event's own first day (a repeating event's first occurrence). Read on the event's own clock: the zone its start is read
  // in (ctx.tz, the request's; an all-day event's day is read there too). Both moments are real instants in that zone and the
  // lead is the real time between them, because the page sets the schedule as the anchor (remindAnchor) less that real time: so
  // the reminder comes at the clock time asked even when a clock change falls between them (that lead is then an hour more or
  // less than the wall clocks' difference). Stored as remind, the minutes, so the page and the form need nothing new.
  const CAL_REMIND_AT_SAY = 'Say remindAt as a date and time, for example 2026-11-24 11:00, or a time on the event\'s day, for example 11:00, 11:00 AM or 9am.';
  const CAL_REMIND_AT_ZONE = 'Leave the zone out of remindAt (no Z or +01:00): it is read on the event\'s own clock.';
  const CAL_REMIND_BOTH = 'Give remind or remindAt, not both.';
  const CAL_REMIND_AT_FAR = 'remindAt can be at most 28 days before the event starts.';
  function calClockText(s) {
    let m = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,3})?)?$/.exec(s);
    if (m) return `${pad(Number(m[1]))}:${m[2]}`;
    m = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?\s*m\.?$/i.exec(s);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${pad((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0))}:${m[2] || '00'}`;
    return null;
  }
  // remindAt as { date, time } ("YYYY-MM-DD", "HH:MM"), `day` the event's own day for a time alone; a throw is the refusal.
  function calRemindAtOf(text, day) {
    const s = typeof text === 'string' ? text.trim().slice(0, 40) : '';
    if (/\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(s)) throw new Error(CAL_REMIND_AT_ZONE);
    const m = /^(\d{4}-\d{2}-\d{2})(?:t|\s+)(.+)$/i.exec(s);
    const date = m ? m[1] : day;
    const time = calClockText(m ? m[2].trim() : s);
    if (!time || !isObjectDay(date)) throw new Error(CAL_REMIND_AT_SAY);
    return { date, time };
  }
  const CAL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const calZone = (tz) => (zoneOk(tz) ? tz : undefined);
  // An instant as the event's own clock reads it: "Tuesday 24 November, 11:00 AM" (the time on the environment's clock).
  function calMoment(d, ctx) {
    const w = calZone(ctx.tz) ? wallIn(d, ctx.tz) : d;
    return `${CAL_DAYS[w.getDay()]} ${w.getDate()} ${CAL_MONTHS[w.getMonth()]}, ${ctx.util.time(calClock(w))}`;
  }
  // The lead (whole minutes before) a remindAt stands for, for the event as it will be stored ({ allDay, start, end }).
  function calRemindAtLead(text, made, ctx) {
    const at = calRemindAtOf(text, calFormOf(made, ctx.tz).date);
    const anchor = remindAnchor(made.allDay, made.start, calZone(ctx.tz));
    const lead = Math.round((anchor.getTime() - instantFrom(at.date, at.time, calZone(ctx.tz)).getTime()) / 60000);
    if (lead < 0) {
      throw new Error(made.allDay
        ? `An all-day event's reminder can be at ${ctx.util.time('09:00')} on its day at the latest; give an earlier time.`
        : `remindAt is after the event starts (${calMoment(anchor, ctx)}); give a time at or before its start.`);
    }
    if (lead > REMIND_MAX) throw new Error(CAL_REMIND_AT_FAR);
    return lead;
  }
  // A lead in the form's own terms: "90 minutes", "37 hours", "2 days".
  function calLeadText(minutes) {
    const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
    const k = minutes / unit;
    const name = unit === 1440 ? 'day' : unit === 60 ? 'hour' : 'minute';
    return `${k} ${name}${k === 1 ? '' : 's'}`;
  }
  // What the answer says of an event's reminder, whichever way it was given: the moment its first one comes, on the event's own
  // clock, and how long before; whether that has passed. { text, comes } ('' and false with no reminder; `comes` false when the
  // one reminder of an event that does not repeat has passed, and nothing will come).
  function calReminderNote(ev, ctx) {
    if (ev.remind === null || ev.remind === undefined) return { text: '', comes: false };
    const anchor = remindAnchor(ev.allDay, ev.start, calZone(ctx.tz));
    const at = new Date(anchor.getTime() - ev.remind * 60000);
    const nine = ctx.util.time('09:00');
    const lead = ev.remind ? `${calLeadText(ev.remind)} before ` : '';
    const how = ev.allDay
      ? (ev.remind ? `, ${lead}${nine} on its day (all-day reminders count from ${nine}).` : ` (all-day reminders count from ${nine} on the day).`)
      : ev.remind ? `, ${lead}it starts.` : ', when it starts.';
    const now = Number(ctx.now) || Date.now();
    const passed = at.getTime() < now;
    const then = passed ? (ev.repeat ? ' That time has passed; the first one is before its next repeat.' : ' That time has passed, so it will not come.')
      : ev.repeat ? ' It comes as long before each repeat.' : '';
    return { text: `The reminder is for ${calMoment(at, ctx)}${how}${then}`, comes: !passed || Boolean(ev.repeat) };
  }
  // The answer's note: the reminder's moment, then, on the server, that it waits for a page (unless none will come).
  function calNote(ev, ctx) {
    const said = calReminderNote(ev, ctx);
    const later = calReminder(ev, ctx);
    const note = [said.text, said.comes ? later : ''].filter(Boolean).join(' ');
    return note ? { data: { note } } : {};
  }

  const ACTION_HANDLERS = {
    // An event on the calendar, as the add-event form makes it: its times, end, repeat, reminder and notes (the form's
    // Details); the reminder as minutes before (remind) or as a clock time (remindAt). With `object` (plan-object-handoff.md):
    // an event made of it (eventFromObject), timed when it says a time. Either way it needs a day: the object's, else `date`. Credited to the asker.
    createEvent(input, ctx) {
      if (calGiven(input.remind) && calGiven(input.remindAt)) throw new Error(CAL_REMIND_BOTH);
      let made;
      if (input.object && typeof input.object === 'object') {
        const fromObject = eventFromObject(input.object, ctx.util, input.date, ctx.tz);
        if (!fromObject) throw new Error('that needs a day to go on the calendar');
        if (calGiven(input.repeat) && !EVENT_REPEATS.includes(input.repeat)) throw new Error(`Say repeat as ${EVENT_REPEATS.join(', ')}.`);
        if (calGiven(input.remind) && !remindOk(input.remind)) throw new Error(REMIND_SAY);
        made = {
          ...fromObject,
          title: fromObject.title || String(input.title || ''),
          ...(calGiven(input.notes) ? { desc: String(input.notes).trim().slice(0, EVENT_DESC_MAX) } : {}),
          remind: calGiven(input.remind) ? input.remind : null,
          repeat: calGiven(input.repeat) ? { every: input.repeat, until: null } : null,
        };
      } else {
        if (!input.date) throw new Error('that needs a day to go on the calendar');
        made = eventFromInput(input, ctx.tz);
        if (made.error) throw new Error(made.error);
      }
      if (calGiven(input.remindAt)) made.remind = calRemindAtLead(input.remindAt, made, ctx);
      const id = ctx.util.id();
      const ev = { id, title: String(made.title).slice(0, 120), allDay: made.allDay, start: made.start, end: made.end || null, desc: made.desc || '', remind: made.remind, repeat: made.repeat, by: ctx.credit.name };
      return { writes: [{ key: `event:${id}`, value: ev }], ref: calRef(ctx, id), ...calNote(ev, ctx) };
    },
    // Change an event already on the calendar: only the fields given, with the form's own checks and sentences. A new day moves
    // its end with it; a time makes an all-day event timed; allDay true drops the times. A repeat keeps its Until while it repeats
    // the same way. An input sent as "" (the manifest's `clears`: endTime, endDate, repeat, remind, notes) clears it, as emptying
    // it in the form does. remindAt is read against the event as changed; left out, the reminder keeps its lead (minutes) when
    // the event moves. A copy of another module's object is changed where it lives.
    updateEvent(input, ctx) {
      const ref = input.event;
      const ours = ref && ref.module === 'calendar' && ref.kind === 'event' && typeof ref.id === 'string' && ref.scope === 'space' && ref.space === ctx.space.id;
      const cur = ours ? ctx.read(`event:${ref.id}`) : null;
      if (!cur) throw new Error("That event isn't on the calendar.");
      const seen = (ctx.refs || {})[ctx.util.objectKey(ref)];
      if (seen && seen.copy) throw new Error(`That is a copy; change it in ${(seen.original && seen.original.name) || 'the module it comes from'}.`);
      const fields = ['title', 'date', 'time', 'endTime', 'endDate', 'allDay', 'repeat', 'remind', 'remindAt', 'notes'];
      const cleared = (f) => input[f] === '';
      if ((calGiven(input.remind) || cleared('remind')) && calGiven(input.remindAt)) throw new Error(CAL_REMIND_BOTH);
      if (!fields.some((f) => calGiven(input[f]) || cleared(f))) throw new Error('Say what to change: a title, a day, a time, an end, all day, a repeat, a reminder or the notes. Send "" to clear the end, the repeat, the reminder or the notes.');
      const was = calFormOf(cur, ctx.tz);
      const allDayGiven = typeof input.allDay === 'boolean';
      const timeGiven = calGiven(input.time);
      const toAllDay = allDayGiven && input.allDay === true;
      const date = calGiven(input.date) ? input.date : was.date;
      // The end keeps its distance from the start when only the day moves.
      let endDate = cleared('endDate') ? null : calGiven(input.endDate) ? input.endDate : was.endDate;
      if (!calGiven(input.endDate) && !cleared('endDate') && calGiven(input.date) && was.endDate && was.date) endDate = ymdOf(addDays(parseYmd(was.endDate), Math.round((parseYmd(input.date) - parseYmd(was.date)) / DAY)));
      const time = timeGiven ? input.time : toAllDay ? null : was.time;
      const endTime = cleared('endTime') ? null : calGiven(input.endTime) ? input.endTime : toAllDay || (was.allDay && timeGiven) ? null : was.endTime;
      const made = eventFromInput({
        title: calGiven(input.title) ? input.title : cur.title, date, time, endTime, endDate,
        ...(allDayGiven ? { allDay: input.allDay } : {}),
        ...(calGiven(input.repeat) ? { repeat: input.repeat } : {}),
        ...(calGiven(input.remind) ? { remind: input.remind } : {}),
      }, ctx.tz);
      if (made.error) throw new Error(made.error);
      const repeat = cleared('repeat') ? null : calGiven(input.repeat) ? { every: input.repeat, until: cur.repeat && cur.repeat.every === input.repeat ? cur.repeat.until || null : null } : cur.repeat || null;
      const ev = {
        ...cur,
        title: made.title, allDay: made.allDay, start: made.start, end: made.end,
        desc: cleared('notes') ? '' : calGiven(input.notes) ? String(input.notes).trim().slice(0, EVENT_DESC_MAX) : cur.desc || '',
        remind: cleared('remind') ? null : calGiven(input.remind) ? input.remind : calGiven(input.remindAt) ? calRemindAtLead(input.remindAt, made, ctx) : cur.remind === undefined ? null : cur.remind,
        repeat,
        by: ctx.credit.name,
      };
      if (!repeat) delete ev.skips;
      const same = ['title', 'allDay', 'start', 'end', 'desc', 'remind'].every((k) => JSON.stringify(ev[k]) === JSON.stringify(cur[k])) && JSON.stringify(repeat) === JSON.stringify(cur.repeat || null);
      if (same) return { ref: calRef(ctx, ref.id), data: { note: 'That is already so; nothing changed.' } };
      return { writes: [{ key: `event:${ref.id}`, value: ev }], ref: calRef(ctx, ref.id), ...calNote(ev, ctx) };
    },
  };
