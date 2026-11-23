  // To-do's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One copy of
  // each rule, run in two places: on the page (host.actions.fromLibrary, todo.js) and, for an agent's request to the bundled module,
  // by the server's runner (server/module-actions.js). No page in it: each handler reads the tasks through `ctx` and answers what to
  // write. A throw is the refusal; its message is the sentence the asker reads. It expects todo-lib.js in scope (the build puts
  // every todo-lib*.js together): taskFromObject, isTaskDay, TASK_TITLE_MAX and TASK_NOTES_MAX.
  //
  // What only a page does about a task: its reminder is a schedule (todo.js applyReminder), and what it links to is told to the
  // host so the other object lists it (todo.js syncLinks). Carried out on the server (ctx.carrier 'server'), a task whose reminder
  // or links may have changed is marked (`remindPending`, `linksPending`): the server has taken off any schedule about the task it
  // changed, and the to-do list sets the reminder and the links again from the task as it is now the next time someone who can
  // change tasks opens it (todo.js settleWaiting), taking the marks off. The request's note says so. Carried out on a page, the
  // page does both at once (its after hook) and there are no marks.

  const TODO_MAX_LINKS = 5;
  const TODO_REMIND_LATER = 'Its reminder is set when someone who can change tasks next opens the to-do list.';
  const TODO_LINKS_LATER = 'What it links to shows the change when someone who can change tasks next opens the to-do list.';
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
  // The answer for a task written as `next` (`before` as it was, or null for a new one), with the marks above and the notes.
  function todoAnswer(ctx, before, next, said) {
    const out = { ...next };
    delete out.remindPending;
    delete out.linksPending;
    const notes = said ? [said] : [];
    if (ctx.carrier === 'server') {
      const linksChanged = todoKeys(todoLinksOf(out), ctx.util) !== todoKeys(todoLinksOf(before), ctx.util);
      if (out.remind || (before && (before.remind || before.remindPending))) out.remindPending = true;
      if (linksChanged || (before && before.linksPending)) out.linksPending = true;
      if (out.remind && out.due && !out.done) notes.push(TODO_REMIND_LATER);
      if (linksChanged) notes.push(TODO_LINKS_LATER);
    }
    return { writes: [{ key: `task:${out.id}`, value: out }], ref: todoRef(ctx, out.id), ...(notes.length ? { data: { note: notes.join(' ') } } : {}) };
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
