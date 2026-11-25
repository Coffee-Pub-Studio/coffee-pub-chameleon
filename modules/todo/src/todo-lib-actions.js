  // To-do's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One copy of
  // each rule, run in two places: on the page (host.actions.fromLibrary, todo.js) and, for an agent's request to the bundled module,
  // by the server's runner (server/module-actions.js). No page in it: each handler reads the tasks through `ctx` and answers what to
  // write. A throw is the refusal; its message is the sentence the asker reads. It expects todo-lib.js in scope (the build puts
  // every todo-lib*.js together): taskFromObject, isTaskDay, TASK_TITLE_MAX and TASK_NOTES_MAX.
  //
  // Beside the write, a handler answers what the host does about the task (plan-agent-server-actions.md, section 2): its
  // reminder's schedule (set for the task as written, or cancelled) and its links as add and remove changes, so the other
  // object lists it. Whoever carries the request out does them at once, the server as the agent or a page as its person; the
  // server has already taken off any schedule about a task the request changed. On a module's environment page, for the
  // environment's own list (no space), the page does both itself (todo.js afterFor).

  const TODO_MAX_LINKS = 5;
  const todoGiven = (v) => v !== undefined && v !== null && v !== '';
  const todoRef = (ctx, id) => ({ module: 'todo', kind: 'task', id, scope: 'space', space: ctx.space.id });
  const todoPointer = (r) => Boolean(r) && typeof r === 'object' && !Array.isArray(r) && typeof r.module === 'string' && typeof r.kind === 'string' && typeof r.id === 'string';
  const todoLinksOf = (t) => (Array.isArray(t && t.links) ? t.links.filter(todoPointer) : []);
  const todoKeys = (links, util) => links.map((r) => util.objectKey(r)).join('\n');
  // A pointer as a task keeps it: its own fields and nothing else.
  const todoLinkOf = (r) => ({ module: r.module, kind: r.kind, id: r.id, ...(typeof r.scope === 'string' ? { scope: r.scope } : {}), ...(typeof r.space === 'string' ? { space: r.space } : {}) });
  // Whether a task here may link to `ref`: the host resolved it for this list, as the asker may see it (the request's facts).
  function todoLinkable(ref, ctx) {
    if (!todoPointer(ref)) return false;
    const seen = (ctx.refs || {})[ctx.util.objectKey(ref)];
    return Boolean(seen) && !seen.error;
  }
  // The task a request names, in the list this request is carried out for (a space's, or on the environment page its own), or
  // the sentence.
  function todoTask(ref, ctx) {
    const here = ctx.space && ctx.space.id;
    const ours = todoPointer(ref) && ref.module === 'todo' && ref.kind === 'task' && ref.id !== ''
      && (here ? ref.scope === 'space' && ref.space === here : ref.scope !== 'space' && ref.scope !== 'person');
    const t = ours ? ctx.read(`task:${ref.id}`) : null;
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('that task is not here');
    return { ...t, id: ref.id };
  }
  // Midnight starting `day` ("YYYY-MM-DD") in `tz` (an IANA zone: whoever carries it out), in milliseconds; else in this
  // process's zone.
  function todoMidnight(day, tz) {
    const [y, m, d] = day.split('-').map(Number);
    let parts = null;
    try { parts = tz ? new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : null; } catch (err) { parts = null; }
    if (!parts) return new Date(y, m - 1, d).getTime();
    const want = Date.UTC(y, m - 1, d);
    let guess = want;
    // The wall clock reads like the instant moved by the zone's offset: find that instant, twice for a clock change.
    for (let i = 0; i < 2; i += 1) {
      const g = {};
      for (const p of parts.formatToParts(new Date(guess))) g[p.type] = Number(p.value);
      guess -= Date.UTC(g.year, g.month - 1, g.day, g.hour === 24 ? 0 : g.hour, g.minute, g.second) - want;
    }
    return guess;
  }
  const TODO_REMIND_FROM = 9 * 60 * 60 * 1000; // 9:00 on the due date: midnight plus nine hours, as the page has always set it
  const TODO_AHEAD = 365 * 24 * 60 * 60 * 1000; // the host takes a schedule at most a year ahead (server/module-hooks.js)
  // When task `t`'s reminder comes, in milliseconds, or null when none does (no reminder, no due date, done, or passed).
  function todoRemindAt(t, tz, now) {
    if (!t || !t.remind || !isTaskDay(t.due) || t.done) return null;
    const at = todoMidnight(t.due, tz) + TODO_REMIND_FROM;
    return at > now && at <= now + TODO_AHEAD ? at : null;
  }
  // What the host does about task `next` (`before` as it was, or null for a new one): { schedules?, links? }, nothing on the
  // environment's own list.
  function todoEffects(ctx, before, next) {
    if (!ctx.space || !ctx.space.id) return {};
    const out = {};
    const key = `remind:${next.id}`;
    const at = todoRemindAt(next, ctx.tz, Number(ctx.now) || Date.now());
    if (at !== null) out.schedules = [{ set: { key, at, about: todoRef(ctx, next.id), payload: { id: next.id }, notify: { title: next.title, body: 'Due today' } } }];
    else if (before) out.schedules = [{ cancel: { key } }];
    // The links answered are those to objects in this space, the ones the server may link for an agent (server/action-effects.js);
    // a page also tells the host the rest (todo.js syncLinks).
    const linkable = (r) => r.scope === 'space' && r.space === ctx.space.id;
    const was = todoLinksOf(before).filter(linkable);
    const now = todoLinksOf(next).filter(linkable);
    const keys = (list) => new Set(list.map((r) => ctx.util.objectKey(r)));
    const had = keys(was);
    const has = keys(now);
    const from = todoRef(ctx, next.id);
    const links = [
      ...was.filter((r) => !has.has(ctx.util.objectKey(r))).map((r) => ({ remove: { from, to: todoLinkOf(r) } })),
      ...now.filter((r) => !had.has(ctx.util.objectKey(r))).map((r) => ({ add: { from, to: todoLinkOf(r) } })),
    ];
    if (links.length) out.links = links;
    return out;
  }
  // The answer for a task written as `next` (`before` as it was, or null for a new one): the write, what the host does about it,
  // and the note.
  const TODO_REMIND_FAR = 'A reminder can be set at most a year ahead, so this one is not set yet; set it again within the year.';
  function todoAnswer(ctx, before, next, said) {
    const out = { ...next };
    const now = Number(ctx.now) || Date.now();
    const far = Boolean(out.remind && isTaskDay(out.due) && !out.done && todoMidnight(out.due, ctx.tz) + TODO_REMIND_FROM > now + TODO_AHEAD);
    const notes = [said, far ? TODO_REMIND_FAR : ''].filter(Boolean);
    return { writes: [{ key: `task:${out.id}`, value: out }], ref: todoRef(ctx, out.id), ...todoEffects(ctx, before, out), ...(notes.length ? { data: { note: notes.join(' ') } } : {}) };
  }

  const ACTION_HANDLERS = {
    // A new task. With `object` (plan-object-handoff.md): a task made of it (taskFromObject), due on a task's day; `due` given on
    // its own is the due date whatever the object says. With `ref`, it links to that object when this list may link to it.
    // Credited to the asker.
    createTask(input, ctx) {
      const made = input.object && typeof input.object === 'object' ? taskFromObject(input.object, ctx.util) : null;
      const title = (made && made.title) || String(input.title || '').trim();
      if (!title) throw new Error('a task needs a title');
      const due = input.due || (made && made.due) || null;
      if (input.remind !== undefined && input.remind !== null && typeof input.remind !== 'boolean') throw new Error('Say whether to remind with true or false.');
      if (input.remind === true && !due) throw new Error('A reminder needs a due date.');
      const t = {
        id: ctx.util.id(), title, notes: made ? made.notes : input.notes || '', due, remind: input.remind === true, done: false, doneAt: null,
        createdAt: ctx.now, by: (ctx.credit && ctx.credit.name) || 'someone', links: todoLinkable(input.ref, ctx) ? [todoLinkOf(input.ref)] : [], autoDone: false,
      };
      return todoAnswer(ctx, null, t, '');
    },
    // Link a task to another object it is about, so each shows the other. At most five links.
    linkTask(input, ctx) {
      const t = todoTask(input.task, ctx);
      if (!todoLinkable(input.target, ctx)) throw new Error('this list may not link to that');
      const links = todoLinksOf(t);
      const key = ctx.util.objectKey(input.target);
      if (links.some((r) => ctx.util.objectKey(r) === key)) return { ref: todoRef(ctx, t.id), data: { note: 'That is already so; nothing changed.' } };
      if (links.length >= TODO_MAX_LINKS) throw new Error(`A task can link to ${TODO_MAX_LINKS} things.`);
      return todoAnswer(ctx, t, { ...t, links: [...links, todoLinkOf(input.target)] }, '');
    },
    // Take a link off a task, and what it was to do when that object reports something, as the editor's x on the link does.
    unlinkTask(input, ctx) {
      const t = todoTask(input.task, ctx);
      const key = todoPointer(input.target) ? ctx.util.objectKey(input.target) : '';
      const links = todoLinksOf(t);
      if (!key || !links.some((r) => ctx.util.objectKey(r) === key)) throw new Error('That task is not linked to that.');
      const next = { ...t, links: links.filter((r) => ctx.util.objectKey(r) !== key) };
      if (t.rules && typeof t.rules === 'object' && !Array.isArray(t.rules)) next.rules = Object.fromEntries(Object.entries(t.rules).filter(([k]) => k !== key));
      return todoAnswer(ctx, t, next, '');
    },
    // Set a task's due date, or clear it: `date` left out, or sent as "" (the manifest's `clears`). A task with no due date has no
    // reminder, as the form has it.
    setTaskDue(input, ctx) {
      const t = todoTask(input.task, ctx);
      if (!todoGiven(input.date)) {
        const next = { ...t, due: null, remind: false };
        return todoAnswer(ctx, t, next, t.remind && t.due ? 'Its reminder is off, since it has no due date.' : '');
      }
      if (!isTaskDay(input.date)) throw new Error('Say the due date as YYYY-MM-DD.');
      return todoAnswer(ctx, t, { ...t, due: input.date, remind: Boolean(t.remind) }, '');
    },
    // Change a task's title, notes or reminder, with the edit form's limits (200 and 1000 letters) and its reminder rule. Notes
    // sent as "" (the manifest's `clears`) clear them.
    updateTask(input, ctx) {
      const t = todoTask(input.task, ctx);
      const has = (k) => input[k] !== undefined && input[k] !== null;
      if (!has('title') && !has('notes') && !has('remind')) throw new Error('Say what to change: title, notes or remind.');
      const next = { ...t };
      if (has('title')) {
        next.title = String(input.title).trim();
        if (!next.title) throw new Error('A task needs a name.');
        if (next.title.length > TASK_TITLE_MAX) throw new Error(`A title can be ${TASK_TITLE_MAX} letters at most.`);
      }
      if (has('notes')) {
        next.notes = String(input.notes).trim();
        if (next.notes.length > TASK_NOTES_MAX) throw new Error(`Notes can be ${TASK_NOTES_MAX} letters at most.`);
      }
      if (has('remind')) {
        if (typeof input.remind !== 'boolean') throw new Error('Say whether to remind with true or false.');
        if (input.remind && !next.due) throw new Error('A reminder needs a due date.');
        next.remind = input.remind;
      }
      return todoAnswer(ctx, t, next, '');
    },
    // Tick a task done or open it again, as a person's tick does.
    setTaskDone(input, ctx) {
      const t = todoTask(input.task, ctx);
      if (typeof input.done !== 'boolean') throw new Error('Say whether the task is done with true or false.');
      return todoAnswer(ctx, t, { ...t, done: input.done, doneAt: input.done ? ctx.now : null }, '');
    },
  };
