
  // The Calendar's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2).
  // One copy of each rule, run in two places: on the page (host.actions.fromLibrary, calendar.js) and, for an agent's request
  // to the bundled module, by the server's runner (server/module-actions.js). No page in it: each handler reads the events
  // through `ctx` and answers what to write. Times are read in `ctx.tz`, the zone of whoever carries it out (the page's
  // person, or the server's). A throw is the refusal; its message is the sentence the asker reads. It expects calendar-lib.js
  // in scope (the build puts every calendar-lib*.js together), and `parseYmd` beside it.

  const calRef = (ctx, id) => ({ module: 'calendar', kind: 'event', id, scope: 'space', space: ctx.space.id });
  const calGiven = (v) => v !== undefined && v !== null && v !== '';
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

  const ACTION_HANDLERS = {
    // An event on the calendar, as the add-event form makes it: its times, end, repeat, reminder and notes (the form's
    // Details). With `object` (plan-object-handoff.md): an event made of it (eventFromObject), timed when it says a time.
    // Either way it needs a day: the object's, else `date`. Credited to the asker.
    createEvent(input, ctx) {
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
      const id = ctx.util.id();
      const ev = { id, title: String(made.title).slice(0, 120), allDay: made.allDay, start: made.start, end: made.end || null, desc: made.desc || '', remind: made.remind, repeat: made.repeat, by: ctx.credit.name };
      return { writes: [{ key: `event:${id}`, value: ev }], ref: calRef(ctx, id) };
    },
    // Change an event already on the calendar: only the fields given, with the form's own checks and sentences. A new day moves
    // its end with it; a time makes an all-day event timed; allDay true drops the times. A repeat keeps its Until while it repeats
    // the same way. A copy of another module's object is changed where it lives.
    updateEvent(input, ctx) {
      const ref = input.event;
      const ours = ref && ref.module === 'calendar' && ref.kind === 'event' && typeof ref.id === 'string' && ref.scope === 'space' && ref.space === ctx.space.id;
      const cur = ours ? ctx.read(`event:${ref.id}`) : null;
      if (!cur) throw new Error("That event isn't on the calendar.");
      const seen = (ctx.refs || {})[ctx.util.objectKey(ref)];
      if (seen && seen.copy) throw new Error(`That is a copy; change it in ${(seen.original && seen.original.name) || 'the module it comes from'}.`);
      const fields = ['title', 'date', 'time', 'endTime', 'endDate', 'allDay', 'repeat', 'remind', 'notes'];
      if (!fields.some((f) => calGiven(input[f]))) throw new Error('Say what to change: a title, a day, a time, an end, all day, a repeat, a reminder or the notes.');
      const was = calFormOf(cur, ctx.tz);
      const allDayGiven = typeof input.allDay === 'boolean';
      const timeGiven = calGiven(input.time);
      const toAllDay = allDayGiven && input.allDay === true;
      const date = calGiven(input.date) ? input.date : was.date;
      // The end keeps its distance from the start when only the day moves.
      let endDate = calGiven(input.endDate) ? input.endDate : was.endDate;
      if (!calGiven(input.endDate) && calGiven(input.date) && was.endDate && was.date) endDate = ymdOf(addDays(parseYmd(was.endDate), Math.round((parseYmd(input.date) - parseYmd(was.date)) / DAY)));
      const time = timeGiven ? input.time : toAllDay ? null : was.time;
      const endTime = calGiven(input.endTime) ? input.endTime : toAllDay || (was.allDay && timeGiven) ? null : was.endTime;
      const made = eventFromInput({
        title: calGiven(input.title) ? input.title : cur.title, date, time, endTime, endDate,
        ...(allDayGiven ? { allDay: input.allDay } : {}),
        ...(calGiven(input.repeat) ? { repeat: input.repeat } : {}),
        ...(calGiven(input.remind) ? { remind: input.remind } : {}),
      }, ctx.tz);
      if (made.error) throw new Error(made.error);
      const repeat = calGiven(input.repeat) ? { every: input.repeat, until: cur.repeat && cur.repeat.every === input.repeat ? cur.repeat.until || null : null } : cur.repeat || null;
      const ev = {
        ...cur,
        title: made.title, allDay: made.allDay, start: made.start, end: made.end,
        desc: calGiven(input.notes) ? String(input.notes).trim().slice(0, EVENT_DESC_MAX) : cur.desc || '',
        remind: calGiven(input.remind) ? input.remind : cur.remind === undefined ? null : cur.remind,
        repeat,
        by: ctx.credit.name,
      };
      if (!repeat) delete ev.skips;
      const same = ['title', 'allDay', 'start', 'end', 'desc', 'remind'].every((k) => JSON.stringify(ev[k]) === JSON.stringify(cur[k])) && JSON.stringify(repeat) === JSON.stringify(cur.repeat || null);
      if (same) return { ref: calRef(ctx, ref.id), data: { note: 'That is already so; nothing changed.' } };
      return { writes: [{ key: `event:${ref.id}`, value: ev }], ref: calRef(ctx, ref.id) };
    },
  };
