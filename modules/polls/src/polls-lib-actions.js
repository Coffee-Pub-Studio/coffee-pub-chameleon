
  // Polls' actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One copy
  // of each rule, run on the page (host.actions.fromLibrary, polls.js) and by the
  // server's runner (server/module-actions.js). No page in it: each handler reads the polls and their votes through `ctx` and
  // answers what to write. A throw is the refusal; its message is the sentence the asker reads. It expects polls-lib.js in
  // scope (the build puts every polls-lib*.js together).
  //
  // Beside the runner's ctx it reads `ctx.settings`, the module's settings as host.settings.get() gives them
  // ({ addableByDefault, closeAfterDays }); the page hands them (polls.js) and the server's runner gives them too.
  // One thing only the page does: telling the space in Chat that a poll has closed (polls.js announceClosed). The server
  // carries every action out at once and can't tell it yet, so updatePoll refuses `closed: true` there (ctx.carrier 'server').

  const pollActGiven = (v) => v !== undefined && v !== null;
  const pollActRef = (ctx, id) => ({ module: 'polls', kind: 'poll', id, scope: 'space', space: ctx.space.id });
  // A pointer to a poll of this place: in a space, that space's; on the environment's own page (no space), the environment's.
  const pollActOurs = (ref, ctx) => Boolean(ref && typeof ref === 'object' && ref.module === 'polls' && ref.kind === 'poll' && typeof ref.id === 'string' && ref.id
    && (ctx.space.id ? ref.scope === 'space' && ref.space === ctx.space.id : ref.scope === 'environment'));
  const pollActClosed = (p, now) => Boolean(p.closed) || Boolean(p.closesAt && now >= p.closesAt);
  // The settings a new poll starts from, as the form reads them: the "let people add options" default and the days to close after.
  function pollActSettings(ctx) {
    const s = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    const days = Number(s.closeAfterDays);
    return { addable: Boolean(s.addableByDefault), closeAfterDays: Number.isFinite(days) && days > 0 ? days : 0 };
  }
  const POLL_SAY_CHANGE = 'Say what to change: the question, the options, whether more than one answer is allowed, when it closes, or whether it is closed. Send "" to take the closing time off.';

  const ACTION_HANDLERS = {
    // A poll as the form would save it, within the form's own limits (pollFromRequest in polls-lib.js). It closes when asked,
    // else after the days the settings say (at noon), else not until someone closes it. Credited to the asker; there is no
    // voting action.
    createPoll(input, ctx) {
      const made = pollFromRequest(input, ctx.now, ctx.tz);
      const s = pollActSettings(ctx);
      let closesAt = made.closesAt;
      if (closesAt === null && s.closeAfterDays > 0) {
        const w = pollWallOf(ctx.now + s.closeAfterDays * 24 * 60 * 60 * 1000, ctx.tz);
        closesAt = pollInstant(w.y, w.mo, w.d, 12, 0, ctx.tz);
      }
      const id = ctx.util.id();
      const p = {
        id, question: made.question, options: made.options.map((text, i) => ({ id: 'o' + (i + 1), text })),
        multi: made.multi, addable: s.addable, closed: false, closesAt, createdAt: ctx.now, by: ctx.credit.name, byKey: ctx.credit.key,
      };
      return { writes: [{ key: `poll:${id}`, value: p }], ref: pollActRef(ctx, id) };
    },
    // Change a poll: only the fields given, with the form's own checks and sentences. Once anyone has voted, the options can
    // only be added to (the ones there, in order, then the new ones) and whether more than one answer is allowed stays, as the
    // server holds every writer to (the poll's `settled` guard); a closed poll's options don't change. `closed` true ends it as
    // End poll does, false opens it again as Reopen poll does (its closing time taken off unless `closes` gives a new one).
    // `closes` "" (the manifest's `clears`) takes the closing time off.
    updatePoll(input, ctx) {
      const ref = input.poll;
      const cur = pollActOurs(ref, ctx) ? ctx.read(`poll:${ref.id}`) : null;
      if (!cur || typeof cur !== 'object' || !Array.isArray(cur.options)) throw new Error("That poll isn't here.");
      if (!['question', 'options', 'multiple', 'closes', 'closed'].some((f) => pollActGiven(input[f]))) throw new Error(POLL_SAY_CHANGE);
      const voted = ctx.list(`vote:${ref.id}:`).length > 0;
      const next = { ...cur };
      if (pollActGiven(input.question)) next.question = pollQuestionOf(input.question);
      if (pollActGiven(input.multiple)) {
        if (typeof input.multiple !== 'boolean') throw new Error('Say whether several answers are allowed with true or false.');
        if (input.multiple !== Boolean(cur.multi)) {
          if (voted) throw new Error('That poll already has votes, so whether more than one answer is allowed can\'t change.');
          next.multi = input.multiple;
        }
      }
      // Its closing: a new time (in the future), none, or End poll and Reopen poll.
      const wasClosed = pollActClosed(cur, ctx.now);
      if (input.closes === '') next.closesAt = null;
      else if (pollActGiven(input.closes)) next.closesAt = pollClosesOf(input.closes, ctx.now, ctx.tz);
      if (pollActGiven(input.closed) && typeof input.closed !== 'boolean') throw new Error('Say whether it is closed with true or false.');
      if (input.closed === true && !wasClosed) {
        if (ctx.carrier === 'server') throw new Error('Ending a poll tells the space in Chat, which can\'t be done from here yet. Ask a person to press End poll, or give it a closing time with closes.');
        next.closed = true; next.announced = true;
      }
      if (input.closed === false && wasClosed) {
        next.closed = false;
        if (!pollActGiven(input.closes)) next.closesAt = null;
      }
      const closedNow = pollActClosed(next, ctx.now);
      // Open again (by Reopen or by a later closing time): it is told again when it next closes.
      if (!closedNow && next.announced) next.announced = false;
      if (pollActGiven(input.options)) {
        const texts = pollOptionsOf(input.options);
        const had = cur.options;
        const same = texts.length === had.length && had.every((o, i) => texts[i] === o.text);
        if (!same) {
          if (closedNow) throw new Error('That poll is closed, so its options can\'t change. Open it again first (closed false).');
          const taken = new Set(had.map((o) => o.id));
          const fresh = (text) => { let oid = 'o' + ctx.util.id(); while (taken.has(oid)) oid += 'x'; taken.add(oid); return { id: oid, text }; };
          if (voted) {
            const kept = texts.length > had.length && had.every((o, i) => texts[i].toLowerCase() === String(o.text).toLowerCase());
            if (!kept) throw new Error('That poll already has votes, so its options can only be added to: give the ones it has, in order, then the new ones.');
            next.options = [...had, ...texts.slice(had.length).map(fresh)];
          } else {
            // Nobody has voted: the list as given. An option kept by its words keeps its detail, date and link.
            next.options = texts.map((text) => {
              const o = had.find((x) => String(x.text).toLowerCase() === text.toLowerCase());
              return o ? { ...o, text } : fresh(text);
            });
          }
        }
      }
      if (JSON.stringify(next) === JSON.stringify(cur)) return { ref: pollActRef(ctx, ref.id), data: { note: 'That is already so; nothing changed.' } };
      return { writes: [{ key: `poll:${ref.id}`, value: next }], ref: pollActRef(ctx, ref.id) };
    },
  };
