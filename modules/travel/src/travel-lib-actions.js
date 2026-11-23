
  // The Itinerary's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2).
  // One copy of each rule, run in two places: on the page (host.actions.fromLibrary, travel-lib-plan.js provide) and, for an
  // agent's request to the bundled module, by the server's runner (server/module-actions.js). No page in it: each handler
  // reads the plan through `ctx` (read, list, and the facts: space, people, refs, util) and answers what to write, the
  // pointer and a note. A throw is the refusal; its message is the sentence the asker reads. It expects travel-lib.js and
  // travel-lib-object.js in scope (the build puts every travel-lib*.js together), and `ymd` and `parseYmd` beside them.

  // The plan as a request finds it: the trip, its entries (plan: keys), and the space's phases. With phases the plan's first
  // and last day are the main phase's (tripSpan), never the stored ones.
  function actPlan(ctx) {
    const stored = ctx.read(TRIP_KEY);
    const trip = stored ? cleanTrip(stored) : null;
    const items = new Map();
    for (const row of ctx.list(PLAN_PREFIX)) {
      const id = planIdOf(row.key);
      const item = id !== null && row.value ? cleanItem({ ...row.value, id }) : null;
      if (item) items.set(id, item);
    }
    const sp = ctx.space || {};
    const phases = Array.isArray(sp.phases) ? sp.phases : [];
    const bands = phases.length && Array.isArray(sp.bands) ? sp.bands : [];
    const phased = phases.length > 0;
    let shown = trip;
    if (phased) {
      const span = tripSpan(null, bands);
      shown = !trip && !span.start ? null : { ...(trip || cleanTrip({})), start: span.start, end: span.end };
    }
    return { trip, shown, items, phases, phased };
  }
  // The days the plan shows (planDays), from the entries' own days.
  const actDays = (plan) => planDays(plan.shown, [...plan.items.values()]);
  // Where a new entry goes among the untimed ones on its day: after the last, as the page's own add does.
  function actOrder(plan, date) {
    const same = [...plan.items.values()].filter((i) => !i.time && (i.after === null || i.after === undefined) && i.date === date);
    return same.length ? Math.max(...same.map((i) => i.order)) + 1000 : 1000;
  }
  const actRef = (ctx, id) => ({ module: 'travel', kind: 'plan', id, scope: 'space', space: ctx.space.id });
  const actWrite = (item) => { const { id, ...value } = item; return { key: PLAN_PREFIX + id, value }; };

  // The plan's first or last day moved out so `item` sits on it (the page's stretchFor): without phases the trip's own dates
  // are written; with phases only the main phase's end could move, which is the space's and not this module's data, so the page
  // carrying it out moves it after (travel-lib-plan.js absorb). The server's runner (ctx.carrier 'server') leaves it, and says
  // so. A day that would make the plan longer than MAX_DAYS is left off, and said. Answers { writes, said }.
  function actStretch(plan, item, ctx) {
    const span = coverTrip(plan.shown, coverDaysOf(item), item, plan.phases);
    const writes = [];
    if (span && span.start && !plan.phased) writes.push({ key: TRIP_KEY, value: cleanTrip({ ...(plan.trip || {}), start: span.start, end: span.end, by: ctx.credit.name }) });
    const missed = span && span.outside;
    const said = !missed || !missed.length ? [] : [missed.length > 1
      ? `A plan can be at most ${MAX_DAYS} days long, so those days are left off the plan.`
      : `A plan can be at most ${MAX_DAYS} days long, so that day is left off the plan.`];
    if (plan.phased && ctx.carrier === 'server' && span && span.end && plan.shown && plan.shown.end && span.end > plan.shown.end) {
      said.push(`That is after the plan's last day, ${plan.shown.end}, which was not moved. A person can add days to the plan in the itinerary.`);
    }
    return { writes, said };
  }

  // A new entry made of `fields`, credited to `by`: { item, writes, said } (the entry, then the trip when it grows).
  function actNew(plan, fields, by, ctx) {
    const id = ctx.util.id();
    const onTheLine = !fields.date && (fields.after === '' || isYmd(fields.after) || fields.kind === 'lane');
    const item = cleanItem({ ...fields, id, order: fields.order ?? (onTheLine ? jointOrder([...plan.items.values()].filter((i) => !i.date && (i.after || '') === (fields.after || '')), null, null) : actOrder(plan, fields.date)), by });
    if (!item) throw new Error('that needs a title');
    const stretch = actStretch(plan, item, ctx);
    return { item, writes: [actWrite(item), ...stretch.writes], said: stretch.said };
  }

  // An object handed in from elsewhere on its day when the plan can show that day; a day past the plan's MAX_DAYS goes under
  // "Unscheduled" with "Dated <day>, outside the plan" in its notes (plan-object-handoff.md, decision 12), and a check-out or
  // a ticket's arrival that would not fit is kept as a notes line. Answers { fields, said }.
  function actHandedIn(days, fields) {
    const said = [];
    let next = fields;
    if (next.date && !fitsPlan(days, next.date)) {
      said.push(`${next.title} is dated ${next.date}, outside the plan's ${MAX_DAYS} days, so it is under Unscheduled.`);
      next = { ...next, date: null, after: null, arrives: relativeArrives(next.date, next.arrives), notes: [`Dated ${next.date}, outside the plan`, next.notes].filter(Boolean).join('\n\n') };
    }
    if (next.date) {
      const span = [...days, next.date].sort();
      const keepAsLine = (line, what, day) => {
        next = { ...next, notes: [next.notes, line].filter(Boolean).join('\n\n') };
        said.push(`${next.title}: ${what}, ${day}, is outside the plan's ${MAX_DAYS} days, so it is in its notes.`);
      };
      if (isYmd(next.checkOut) && !fitsPlan(span, next.checkOut)) {
        const out = next.checkOut;
        keepAsLine(`Check out: ${out}${next.checkOutTime ? ` ${next.checkOutTime}` : ''}`, 'its check-out', out);
        next = { ...next, checkOut: null, checkOutTime: null };
      }
      if (typeof next.arrives === 'string' && next.arrives.length === 16 && !fitsPlan(span, next.arrives.slice(0, 10))) {
        const arrives = next.arrives;
        keepAsLine(arrivesLine(arrives), 'its arrival', arrives.slice(0, 10));
        next = { ...next, arrives: null };
      }
    }
    return { fields: next, said };
  }

  // The Place a request names, as the editor's Pick from Maps takes it: its pointer, its title (the stop's `place`) and its
  // address, from the summary the request's facts carry (`ctx.refs`, as the asker may see it). Refused in plain words when it
  // is not a Maps place, is a person's own, or cannot be read.
  function actAtPlace(ref, ctx) {
    if (!ref || typeof ref !== 'object' || ref.module !== 'maps' || ref.kind !== 'place' || typeof ref.id !== 'string' || !ref.id) throw new Error('That is not a place saved in Maps.');
    if (ref.scope === 'person') throw new Error(`That place is private to one person. Share it to the ${ctx.util.word('space')} first.`);
    const got = (ctx.refs || {})[ctx.util.objectKey(ref)];
    if (!got || got.error || !got.title) throw new Error("That place can't be found, or you can't see it.");
    return { placeRef: { module: ref.module, kind: ref.kind, id: ref.id, scope: ref.scope, ...(ref.space ? { space: ref.space } : {}) }, place: clip(got.title, 120), address: clip(got.subtitle, 200) };
  }
  // `fields` at the place `ref` names (nothing changes without one). Only a stop is at a place.
  function actWithPlace(fields, ref, ctx) {
    if (ref === undefined || ref === null || ref === '') return fields;
    if (fields.kind !== 'stop') throw new Error('Only a stop can be at a place. Leave the place out for a journey, a stay or a note.');
    const at = actAtPlace(ref, ctx);
    return { ...fields, placeRef: at.placeRef, place: at.place, ...(!fields.address && at.address ? { address: at.address } : {}) };
  }

  // The optional details a flat request may carry, as the form's own fields (the same ones objectFields fills): `time` (HH:MM,
  // 24-hour; a flight's departure, a stay's check-in), `minutes` or `endTime` (how long; a stay has no length), `cost` (what
  // the form calls Estimated, so Budget reads it as it reads one typed in), `reference` (the confirmation number). Each is
  // refused in plain words when it cannot be used. Without any of them the fields come back as they were. `startTime` is the
  // start an end time is measured from when the request gives none (an entry's own, for an edit).
  function actDetails(input, fields, util, startTime) {
    const given = (name) => input[name] !== undefined && input[name] !== null && input[name] !== '';
    if (!['time', 'minutes', 'endTime', 'cost', 'reference'].some(given)) return fields;
    const out = { ...fields };
    if (given('time')) {
      if (!isTime(input.time)) throw new Error('The time must be a clock time as HH:MM, 24-hour, like 14:30.');
      out.time = input.time;
    }
    if (given('minutes') && given('endTime')) throw new Error('Give how long it takes or when it ends, not both.');
    if (given('minutes') || given('endTime')) {
      if (fields.kind === 'stay') throw new Error('A stay has no length, so leave out minutes and the end time.');
      if (given('minutes')) {
        if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > MAX_MINUTES) throw new Error(`Minutes must be a whole number from 1 to ${MAX_MINUTES}.`);
        out.minutes = input.minutes;
      } else {
        if (!isTime(input.endTime)) throw new Error('The end time must be a clock time as HH:MM, 24-hour, like 16:00.');
        const from = isTime(out.time) ? out.time : startTime;
        if (!isTime(from)) throw new Error('An end time needs a start time too.');
        const long = lengthBetween(from, input.endTime);
        if (!long) throw new Error('The end time must be different from the start time.');
        out.minutes = long;
      }
    }
    if (given('cost')) {
      if (typeof input.cost !== 'number' || !Number.isFinite(input.cost) || input.cost < 0 || input.cost > 1e9) throw new Error('The cost must be a number, zero or more, like 120.50.');
      out.estimate = input.cost > 0 ? input.cost : null;
    }
    if (given('reference')) out.confirm = clip(util.plain(String(input.reference), { line: true }), 60);
    return out;
  }

  // The entry a suggestion becomes ({ title, kind?, content?, place?, date? }, an AI's summary or a summary dropped here): the
  // right kind when `kind` is one of the everyday words a journey, a stay or a stop already knows, else a stop.
  function actSuggestion(input, util) {
    // A title is plain text (decision 5); the notes keep their Markdown, which the plan draws.
    const title = clip(util.plain(String(input.title ?? ''), { line: true }), 120);
    if (!title) throw new Error('that needs a title');
    const fields = { title, ...placeFields(input), notes: clip(input.content, 8000), place: clip(input.place, 120) };
    const kindWord = typeof input.kind === 'string' ? input.kind : '';
    if (MODES.includes(kindWord)) { fields.kind = 'journey'; fields.mode = kindWord; }
    else if (STAY_TYPES.includes(kindWord)) { fields.kind = 'stay'; fields.type = kindWord; }
    else if (STOP_TYPES.includes(kindWord)) { fields.kind = 'stop'; fields.type = kindWord; if (['restaurant', 'cafe', 'bar', 'winery'].includes(kindWord)) fields.category = 'eat'; }
    else fields.kind = 'stop';
    return actDetails(input, fields, util);
  }

  // Where a booking's cost and travellers go (plan-assistant-reboot.md, decision 3): the trip's currency (the budget's in Set up,
  // else the one stored on the plan, else the server's) and the space's people.
  const actBooking = (plan, ctx) => {
    const sp = ctx.space || {};
    return { currency: sp.currency || (plan.trip && plan.trip.currency) || sp.defaultCurrency || '', people: Array.isArray(ctx.people) ? ctx.people : [] };
  };

  // A new entry from `fields` handed in, answered as a handler answers: on its day when the plan can show it, said otherwise.
  function actAddHandedIn(plan, fields, ctx) {
    const by = ctx.credit.name;
    const handed = actHandedIn(actDays(plan), fields);
    const made = actNew(plan, handed.fields, by, ctx);
    const words = [...handed.said, ...made.said].join(' ');
    return { writes: made.writes, ref: actRef(ctx, made.item.id), ...(words ? { data: { note: words } } : {}) };
  }
  // A new entry from `fields`, answered as a handler answers (a day left off is said, the entry kept).
  function actAddPlain(plan, fields, ctx) {
    const made = actNew(plan, fields, ctx.credit.name, ctx);
    const words = made.said.join(' ');
    return { writes: made.writes, ref: actRef(ctx, made.item.id), ...(words ? { data: { note: words } } : {}) };
  }
  // A pointer to another module's object on the plan, on `date` when one is given, else on that object's own day.
  const actLink = (plan, ref, date, title, ctx) => actAddPlain(plan, { kind: 'link', ref, ...placeFields(isYmd(date) ? { date } : null), title: title || '' }, ctx);

  // The entry a request points at (`ref`, one of the plan's own), or the sentence.
  function actEntry(plan, ref, ctx, what) {
    const item = ref && ref.module === 'travel' && ref.kind === 'plan' && typeof ref.id === 'string' ? plan.items.get(ref.id) : null;
    if (!item) throw new Error(what || `That ${ctx.util.word('object')} isn't on the itinerary any more.`);
    return item;
  }

  // A journey moved to another day takes its ticket's dated arrival along, the same number of days later or earlier, unless the
  // change says its own arrival (the page's updateItem does the same).
  function actWithArrival(item, patch) {
    if (!patch || patch.arrives !== undefined || !Object.prototype.hasOwnProperty.call(patch, 'date')) return patch;
    if (!item.date || patch.date === item.date || typeof item.arrives !== 'string' || item.arrives.length !== 16) return patch;
    if (!isYmd(patch.date)) return { ...patch, arrives: relativeArrives(item.date, item.arrives) };
    return { ...patch, arrives: shiftArrives(item.arrives, Math.round((parseYmd(patch.date) - parseYmd(item.date)) / DAY_MS)) };
  }

  const ACTION_HANDLERS = {
    // A plain stop, at a saved place if one is given; or with `ref`, a pointer to another module's object.
    addStop(input, ctx) {
      const plan = actPlan(ctx);
      if (input.ref && input.placeRef) throw new Error('Give a link or a place, not both.');
      const date = isYmd(input.date) ? input.date : null;
      if (input.ref) return actLink(plan, input.ref, date, input.title, ctx);
      const fields = actWithPlace(actDetails(input, { kind: 'stop', title: input.title, date, notes: input.notes || '' }, ctx.util), input.placeRef, ctx);
      return actAddPlain(plan, fields, ctx);
    },
    // An object that already exists put on the plan, on the day given if there is one.
    addToDay(input, ctx) {
      return actLink(actPlan(ctx), input.object, input.date, undefined, ctx);
    },
    // A suggestion from anywhere (an AI's typed summary, another module's idea): the right kind of entry when `kind` is one of
    // the everyday words a journey, a stay or a stop knows; none is an ordinary stop; any other kind is refused. With `object`
    // (plan-object-handoff.md): the whole object, its details in the plan's own fields (objectFields).
    acceptSuggestion(input, ctx) {
      const plan = actPlan(ctx);
      if (input.object) return actAddHandedIn(plan, actWithPlace(objectFields(input.object, ctx.util, undefined, actBooking(plan, ctx)), input.placeRef, ctx), ctx);
      if (input.kind !== undefined && input.kind !== null && input.kind !== '' && !ACCEPT_KINDS.includes(input.kind)) throw new Error(`That kind is not one the itinerary takes. Use ${ACCEPT_KINDS.slice(0, -1).join(', ')} or ${ACCEPT_KINDS[ACCEPT_KINDS.length - 1]}.`);
      return actAddHandedIn(plan, actWithPlace(actSuggestion(input, ctx.util), input.placeRef, ctx), ctx);
    },
    // Put a stop that is already on the plan at a saved place (what the editor's Pick from Maps does), or take it off its
    // place (its name stays, as the editor's Unlink leaves it).
    setStopPlace(input, ctx) {
      const plan = actPlan(ctx);
      const item = actEntry(plan, input.stop, ctx, "That stop isn't on the itinerary.");
      if (item.kind !== 'stop') throw new Error('Only a stop can be at a place.');
      const given = input.placeRef !== undefined && input.placeRef !== null && input.placeRef !== '';
      let patch = { placeRef: null };
      if (given) {
        const at = actAtPlace(input.placeRef, ctx);
        patch = { placeRef: at.placeRef, place: at.place, ...(!item.address && at.address ? { address: at.address } : {}) };
      }
      const next = cleanItem({ ...item, ...patch });
      return { writes: [actWrite(next)], ref: actRef(ctx, item.id) };
    },
    // Change an entry already on the plan (a journey, a stay, a stop or a note): only the fields given. `object` is a patch in
    // the objects format (objectPatch): its typed details go into the plan's own fields, and its kind may change as the
    // person's editor allows (a plain stop with a flight in its notes becomes a typed flight). The flat fields come after it.
    // The editor's own checks and sentences.
    updatePlan(input, ctx) {
      const plan = actPlan(ctx);
      const item = actEntry(plan, input.entry, ctx);
      if (item.kind === 'link') throw new Error('That entry shows something kept in another module; change it there.');
      if (item.kind === 'block' || item.kind === 'lane') throw new Error('That is a marker on the plan; a person changes it in the Itinerary.');
      let patch = {};
      let lines = '';
      if (input.object) {
        const got = objectPatch(input.object, item, ctx.util, actBooking(plan, ctx));
        patch = got.patch;
        lines = got.lines;
      }
      const kind = patch.kind || item.kind;
      if (input.title !== undefined && input.title !== null && input.title !== '') {
        patch.title = clip(ctx.util.plain(String(input.title), { line: true }), 120);
        if (!patch.title) throw new Error('Give it a title.');
      }
      if (isYmd(input.date)) { patch.date = input.date; patch.after = null; }
      if (input.notes !== undefined && input.notes !== null && input.notes !== '') patch.notes = clip(input.notes, 8000);
      // An input sent as "" clears that field (the manifest's `clears`), as emptying it in the editor does; one left out is kept.
      const cleared = (f) => input[f] === '';
      if (cleared('notes')) patch.notes = '';
      if (cleared('time')) patch.time = null;
      if (cleared('minutes')) patch.minutes = null;
      if (cleared('cost')) patch.estimate = null;
      patch = actDetails(input, { ...patch, kind }, ctx.util, patch.time !== undefined ? patch.time : item.time);
      if (!patch.kind || patch.kind === item.kind) delete patch.kind;
      if (lines) patch.notes = [patch.notes !== undefined ? patch.notes : item.notes, lines].filter(Boolean).join('\n\n');
      if (input.placeRef !== undefined && input.placeRef !== null && input.placeRef !== '') {
        const at = actWithPlace({ kind, address: patch.address !== undefined ? patch.address : item.address }, input.placeRef, ctx);
        Object.assign(patch, { placeRef: at.placeRef, place: at.place, ...(at.address ? { address: at.address } : {}) });
      }
      if (!Object.keys(patch).length) throw new Error('Say what to change: a title, a day, a time, the notes, the cost, a place, or an object with its details. Send "" to clear the time, minutes, cost or notes.');
      // The editor's checks for what it would save.
      const nextKind = patch.kind || item.kind;
      const returns = legsOf([...plan.items.values()], item.id);
      if (returns.length && (nextKind !== 'journey' || (patch.mode || item.mode) === 'car')) throw new Error('Only a journey other than a car can be a round trip. Choose one, or turn off Round trip first.');
      patch = actWithArrival(item, patch);
      const merged = { ...item, ...patch };
      if (nextKind === 'stay' && merged.checkOut && merged.date && merged.checkOut <= merged.date) throw new Error('Check out is on or before check in.');
      if (nextKind === 'journey' && merged.mode === 'car' && merged.checkOut && merged.date && merged.checkOut <= merged.date) throw new Error('Drop-off is on or before pick-up.');
      if (nextKind === 'journey' && patch.arrives && !arrivalFits(merged.date, merged.time, merged.arrives)) throw new Error('The arrival on the ticket can be at most 7 days after it leaves, and at most a day before.');
      const next = cleanItem(merged);
      if (!next) throw new Error('Give it a title.');
      if (JSON.stringify(next) === JSON.stringify(item)) return { ref: actRef(ctx, item.id), data: { note: 'That is already so; nothing changed.' } };
      const stretch = actStretch(plan, next, ctx);
      const words = stretch.said.join(' ');
      return { writes: [actWrite(next), ...stretch.writes], ref: actRef(ctx, item.id), ...(words ? { data: { note: words } } : {}) };
    },
  };
