  // Research's actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One copy
  // of each rule, carried out on the server (the manifest's actions.server: the runner) and on the page (host.actions.fromLibrary,
  // research-lib.js provide), both giving the same answer. No page in it: each handler reads the space's research through `ctx` and
  // answers what to write. A throw is the refusal; its message is the sentence the asker reads. It expects research-lib.js in scope
  // (the build puts every research-lib*.js together). The place helpers are ctx.util.geo (rsStart), and a note or link made about
  // another object (`ref`) answers its link (`links`), so nothing waits for a page (plan-agent-server-actions.md, step 7).

  const rsRef = (ctx, kind, id) => ({ module: 'research', kind, id, scope: 'space', space: ctx.space.id });
  const rsGiven = (v) => v !== undefined && v !== null;
  // Each handler starts here: the SDK's place helpers from its ctx (the page's are the same ones), and its input as an object.
  function rsStart(input, ctx) {
    if (ctx && ctx.util && ctx.util.geo) rsGeo = ctx.util.geo;
    return input || {};
  }
  // The object a new note or link was made about, as a link's end takes it (its five fields), or null when none was given.
  function rsAbout(r) {
    if (!r || typeof r !== 'object' || typeof r.module !== 'string' || !r.module || typeof r.kind !== 'string' || !r.kind || typeof r.id !== 'string' || !r.id || typeof r.scope !== 'string' || !r.scope) return null;
    return { module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(typeof r.space === 'string' ? { space: r.space } : {}) };
  }
  // A new object, as the store's save makes it: checked by cleanItem, stored as itemValue.
  function rsNew(ctx, fields) {
    const id = ctx.util.id();
    const item = cleanItem(fields.kind, id, { ...fields, by: (ctx.credit && ctx.credit.name) || '', at: new Date(ctx.now).toISOString() });
    if (!item) throw new Error('that is not complete, or not valid');
    return { writes: [{ key: `${item.kind}:${id}`, value: itemValue(item) }], ref: rsRef(ctx, item.kind, id) };
  }
  // A new note or link made about another object (`about`, the request's `ref`) is linked to it in the same answer; Research
  // keeps no pointer of its own.
  function rsLinked(answer, about) {
    const to = rsAbout(about);
    return to ? { ...answer, links: [{ add: { from: answer.ref, to } }] } : answer;
  }
  // The note or link a request points at (`ref`, one of this space's own), as cleanItem reads it, or the sentence.
  function rsHad(ref, kind, ctx) {
    const ours = ref && typeof ref === 'object' && ref.module === 'research' && ref.kind === kind && typeof ref.id === 'string' && ref.id && ref.scope === 'space' && ref.space === ctx.space.id;
    const stored = ours ? ctx.read(`${kind}:${ref.id}`) : null;
    const item = stored ? cleanItem(kind, ref.id, stored) : null;
    if (!item) throw new Error(kind === 'link' ? "That link isn't in this research." : "That note isn't in this research.");
    return item;
  }
  // Text given for a field that holds at most `max`: refused past it, as the editor's field takes no more.
  function rsText(v, max, what) {
    if (typeof v !== 'string') throw new Error(`The ${what} must be text.`);
    if ([...v.trim()].length > max) throw new Error(`The ${what} is at most ${max} characters.`);
    return v.trim();
  }
  // An object changed to `next` (only the fields given changed): written over the one read, or "already so".
  function rsChanged(ctx, had, next) {
    const item = cleanItem(had.kind, had.id, next);
    if (!item) throw new Error('that is not complete, or not valid');
    const value = itemValue(item);
    if (JSON.stringify(value) === JSON.stringify(itemValue(had))) return { ref: rsRef(ctx, had.kind, had.id), data: { note: 'That is already so; nothing changed.' } };
    return { writes: [{ key: `${had.kind}:${had.id}`, value }], ref: rsRef(ctx, had.kind, had.id) };
  }

  const ACTION_HANDLERS = {
    // A new note. tags is a plain comma- or space-separated string, as the field in the dialog reads it, so any module (or Assistant,
    // keeping an answer) can offer tags without knowing this module's shape. With `object` (any kind, or a message's words), the
    // note is made of the object instead (objectNote). Credited to the asker.
    saveNote(input, ctx) {
      const i = rsStart(input, ctx);
      if (i.object && typeof i.object === 'object') {
        const fields = objectNote(i.object, ctx.util);
        if (!fields.title) throw new Error('a note needs a title');
        return rsLinked(rsNew(ctx, fields), i.ref);
      }
      const title = rsGeo.oneLine(i.title, 120);
      if (!title) throw new Error('a note needs a title');
      return rsLinked(rsNew(ctx, { kind: 'note', title, body: plainText(i.body, 8000), tags: parseTags(i.tags), date: '', icon: noteIcon(i.icon, i.kind) }), i.ref);
    },
    // A new web link. With `object` (a link), its title, words, tags and day fill what the flat fields leave out.
    saveLink(input, ctx) {
      const i = rsStart(input, ctx);
      if (i.object && typeof i.object === 'object') {
        const fields = objectLink(i.object, ctx.util, i);
        if (!fields) throw new Error('that is not a web address');
        return rsLinked(rsNew(ctx, fields), i.ref);
      }
      const url = cleanUrl(i.url);
      if (!url) throw new Error('that is not a web address');
      return rsLinked(rsNew(ctx, { kind: 'link', url, title: rsGeo.oneLine(i.title, 120), excerpt: plainText(i.excerpt, 2000), tags: [], date: '' }), i.ref);
    },
    // Change a note already here: only the fields given, as the editor saves them. "" (the manifest's `clears`) empties the title
    // (the note is then named by its first line), the note's text or the tags; a note needs a title or some text. `icon` or `kind`
    // sets its type, as saveNote reads them.
    updateNote(input, ctx) {
      const i = rsStart(input, ctx);
      const had = rsHad(i.note, 'note', ctx);
      if (!['title', 'body', 'tags', 'icon', 'kind'].some((k) => rsGiven(i[k]))) throw new Error('Say what to change: a title, the text, the tags or its type. Send "" to clear the title, the text or the tags.');
      const next = { ...had };
      if (rsGiven(i.title)) next.title = rsGeo.oneLine(rsText(i.title, 120, 'title'), 120);
      if (rsGiven(i.body)) next.body = plainText(rsText(i.body, 8000, 'text'), 8000);
      if (rsGiven(i.tags)) next.tags = parseTags(rsText(i.tags, 200, 'tags'));
      if (rsGiven(i.icon) || rsGiven(i.kind)) next.icon = noteIcon(i.icon, i.kind);
      if (!rsGeo.oneLine(next.title, 120) && !String(next.body || '').trim()) throw new Error('Give it a title, or write something in it.');
      return rsChanged(ctx, had, next);
    },
    // Change a link already here: its title, what to remember from it (the excerpt) and its tags, only those given. "" (the
    // manifest's `clears`) empties one: a link with no title is named by its site.
    updateLink(input, ctx) {
      const i = rsStart(input, ctx);
      const had = rsHad(i.link, 'link', ctx);
      if (!['title', 'excerpt', 'tags'].some((k) => rsGiven(i[k]))) throw new Error('Say what to change: a title, what to remember from it or the tags. Send "" to clear one.');
      const next = { ...had };
      if (rsGiven(i.title)) next.title = rsGeo.oneLine(rsText(i.title, 120, 'title'), 120);
      if (rsGiven(i.excerpt)) next.excerpt = plainText(rsText(i.excerpt, 2000, 'text'), 2000);
      if (rsGiven(i.tags)) next.tags = parseTags(rsText(i.tags, 200, 'tags'));
      return rsChanged(ctx, had, next);
    },
  };
