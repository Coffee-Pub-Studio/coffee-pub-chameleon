// Planner - Goals (the Goal outline, plan-templates-redesign.md step 14): a learning or mentoring plan of goals, the steps
// under each and how far along each is, dates optional. One file of code for every place it shows: a space's canvas
// (docked or floating), a window of its own, and the environment's page (which only points into a space: the plan is a
// space's). The SDK (window.host) is injected by the host.
//
// Two views: Goals (one card per goal with its progress and its steps) and List (the outline, host.ui.outline). The words
// goal, step, note and owner are the module's labels, which a template may rename (Mentoring: "mentee" for owner).
// The rules with no page (an entry, the tree, a goal's progress, the moves) are in goals-lib.js.
(async function () {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const $ = (id) => root.getElementById(id);

  /*__LIB__*/

  const L = GoalsLib;
  const label = (key, o) => host.util.label(key, o);
  const cap = (s) => s.charAt(0).toLocaleUpperCase('en') + s.slice(1);

  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function icon(name, cls) {
    const s = make('span', `ic${cls ? ` ${cls}` : ''}`);
    s.setAttribute('aria-hidden', 'true');
    host.ui.icon(name).then((svg) => { s.innerHTML = svg; }).catch(() => {});
    return s;
  }

  // States: loading is the skeleton in #loading; a failure or a plain notice is the block in #msg.
  function showMsg(title, text, retry) {
    $('loading').hidden = true;
    $('app').hidden = true;
    const m = $('msg');
    const parts = [icon(retry ? 'triangle-exclamation' : 'circle-info'), make('h2', 'sdk-empty-title', title)];
    if (text) parts.push(make('p', 'sdk-empty-text', text));
    if (retry) {
      const actions = make('div', 'sdk-empty-actions');
      const again = make('button', 'btn', 'Retry');
      again.type = 'button';
      again.addEventListener('click', () => { m.hidden = true; $('loading').hidden = false; retry(); });
      actions.append(again);
      parts.push(actions);
    }
    m.replaceChildren(...parts);
    if (retry) m.dataset.kind = 'error'; else delete m.dataset.kind;
    m.hidden = false;
  }

  let info;
  try {
    info = await host.ready();
  } catch (err) {
    showMsg('The plan could not start', err.message, () => location.reload());
    return;
  }

  // The plan is a space's. On the environment's own page there is nothing of its own to show: say where it is.
  if (info.context.scope !== 'space') {
    const where = host.util.word('space');
    showMsg(`${cap(label('goal', { many: true }))} live in each ${where}`, `Open a ${where} to see its ${label('goal', { many: true })}.`);
    return;
  }

  const me = info.user.key;
  const canEdit = () => host.can('edit');
  let prefs = { dates: 'optional', progressBy: 'steps', defaultView: 'goals' };
  try { prefs = { ...prefs, ...(await host.settings.get()) }; } catch (err) { /* the defaults */ }
  const datesOn = () => prefs.dates !== 'off';
  let view = prefs.defaultView === 'list' ? 'list' : 'goals';
  const phases = () => (typeof host.phases === 'function' ? host.phases() : []) || [];
  let people = [];
  try { people = (await host.people()) || []; } catch (err) { people = []; }
  const personName = (key) => (people.find((p) => p.key === key) || {}).name || '';

  // ---- the entries -------------------------------------------------------------------------------------------------
  const entries = new Map(); // id -> { e: entry (GoalsLib.readEntry), version }
  const PREFIX = 'plan:';
  const keyOf = (id) => `${PREFIX}${id}`;
  function keep(key, value, version) {
    const id = key.slice(PREFIX.length);
    const e = L.readEntry(id, value);
    if (e) entries.set(id, { e, version }); else entries.delete(id);
    made = null;
  }
  async function load() {
    entries.clear();
    made = null;
    for (const row of await host.storage.list(PREFIX)) if (row.value) keep(row.key, row.value, row.version);
  }
  // The list, its ids and the entries under each, made again only after the entries changed (a change, a load, a write), so a
  // long list costs one pass per draw rather than one per entry.
  let made = null;
  const madeNow = () => {
    if (!made) { const all = [...entries.values()].map((x) => x.e); made = { all, byId: new Map(all.map((e) => [e.id, e])), kids: L.childIndex(all) }; }
    return made;
  };
  const list = () => madeNow().all;
  const byId = () => madeNow().byId;
  const childrenOf = (id) => madeNow().kids.get(id) || [];

  // ---- writing -------------------------------------------------------------------------------------------------------
  function note(text) {
    const n = $('note');
    n.textContent = text || '';
    n.hidden = !text;
    if (text) setTimeout(() => { if (n.textContent === text) n.hidden = true; }, 6000);
  }
  async function put(id, value) {
    const row = await host.storage.set(keyOf(id), value);
    keep(row.key, row.value, row.version);
    return row;
  }
  // An entry says what its steps and the plan's settings say: a goal's stored `done` and `progress` follow its steps (the refs
  // summary, and so the phase measure, reads the stored values), and `shownDate` (what the Calendar and the summaries see) is
  // the date while dates are on, none while they are off. Written only when they differ; a write that fails is left for the
  // next change.
  async function syncEntry(goalId) {
    const x = entries.get(goalId);
    if (!x || !canEdit()) return;
    const patch = L.entryPatch(x.e, childrenOf(goalId), prefs.progressBy, datesOn());
    if (!patch) return;
    const value = { ...L.stored(x.e), ...patch };
    if (value.shownDate === null) delete value.shownDate;
    try {
      const row = await host.storage.set(keyOf(goalId), value, { version: x.version });
      keep(row.key, row.value, row.version);
    } catch (err) {
      if (err && err.status === 409) { const cur = err.current; if (cur) keep(keyOf(goalId), cur.value, cur.version); return; }
      console.error(err);
    }
  }
  // Every entry, once: after a load or a change of the plan's settings. Only someone who may edit writes, and at most
  // SYNC_MAX entries at a time (the rest on the next load), so a list written to be huge never holds the page in writes.
  const SYNC_MAX = 200;
  async function syncAll() {
    if (!canEdit()) return;
    let written = 0;
    for (const e of list().slice()) {
      if (!L.entryPatch(e, childrenOf(e.id), prefs.progressBy, datesOn())) continue;
      if ((written += 1) > SYNC_MAX) break;
      await syncEntry(e.id);
    }
  }
  // A new entry's order: after the last of its siblings.
  function orderAtEnd(parent) {
    const sibs = list().filter((e) => (e.parent || null) === (parent || null) && (parent ? true : e.kind !== 'step')).sort(L.compare);
    const last = [...sibs].reverse().find((e) => typeof e.order === 'string' && !e.order.endsWith('0'));
    try { return host.util.order(last ? last.order : null, null); } catch (err) { return undefined; }
  }
  async function add(kind, raw) {
    if (!canEdit()) throw new Error(`You can't change the ${label('goal', { many: true })} here.`);
    const id = host.util.id();
    const parent = kind === 'goal' ? null : raw.parent || null;
    const value = L.valueOf(kind, { ...raw, parent, order: orderAtEnd(parent) }, { dates: datesOn() });
    value.createdAt = Date.now();
    value.by = me;
    await put(id, value);
    if (value.parent) await syncEntry(value.parent);
    return id;
  }
  async function update(id, changes) {
    const x = entries.get(id);
    if (!x) throw new Error('That is no longer in the plan.');
    const before = x.e.parent;
    const value = L.valueOf(x.e.kind, { ...L.stored(x.e), ...changes }, { dates: datesOn() });
    if (x.e.createdAt) value.createdAt = x.e.createdAt;
    if (x.e.by) value.by = x.e.by;
    await put(id, value);
    if (x.e.kind === 'goal') await syncEntry(id);
    if (before && before !== value.parent) await syncEntry(before);
    if (value.parent) await syncEntry(value.parent);
  }
  async function remove(id) {
    const x = entries.get(id);
    if (!x) return;
    const kids = x.e.kind === 'goal' ? childrenOf(id) : [];
    for (const k of kids.slice()) { await host.storage.delete(keyOf(k.id)); entries.delete(k.id); made = null; }
    await host.storage.delete(keyOf(id));
    entries.delete(id);
    made = null;
    if (x.e.parent) await syncEntry(x.e.parent);
  }
  async function setDone(id, done) {
    try { await update(id, { done }); } catch (err) { note(err.message); }
    render();
  }

  // ---- the plan as a JSON file: Export, and Import (add to the plan, or replace it) -------------------------------------------------
  // The format is in src/FORMAT.md; the rules (what is read, what is refused) are in goals-lib-file.js. A file is read whole and
  // checked before anything is written. The writes are the plan's own (host.storage.set, one entry at a time, as an edit is), so
  // they need the edit right and meet the same guards; Replace needs the clear right as well. A write that fails puts back what was
  // there. For a short time after, Undo puts back what the import changed.
  const F = GoalsFile;
  const UNDO_SECONDS = 30;
  let importing = false;
  let undoTimer = 0;
  let undoPlan = null; // { created: [ids], was: [{ id, value }] }: what the last import changed
  const canClear = () => host.can('clear');
  const say = (text, kind) => { if (text && host.ui && host.ui.toast) host.ui.toast(String(text), kind ? { kind } : undefined).catch(() => {}); };
  function deliver(blob, name) {
    if (host.files && typeof host.files.save === 'function') return host.files.save(blob, { name });
    const address = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = address;
    a.download = name;
    a.rel = 'noopener';
    a.hidden = true;
    $('app').append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(address), 60000);
    return true;
  }
  async function exportPlan() {
    if (!entries.size) { say('There is nothing in the plan to export yet.'); return; }
    try {
      const body = JSON.stringify(F.exportFile(list(), { module: info.module.id }), null, 2);
      await deliver(new Blob([body], { type: 'application/json' }), F.exportName(host.util.ymd(new Date())));
    } catch (err) { say('This browser would not save the file.', 'danger'); }
  }
  // What a file holds, in the plan's words: "2 goals, 5 steps and 1 note".
  function countWords(raws) {
    const parts = L.KINDS.map((k) => [k, raws.filter((e) => e.kind === k).length]).filter((x) => x[1]).map(([k, n]) => `${n} ${label(k, { many: n !== 1 })}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || 'nothing';
  }
  // Puts back what an import changed: the entries it made come off, the ones it replaced or removed return. Others' work is left.
  async function putBack(plan) {
    for (const id of plan.created) {
      const x = entries.get(id);
      if (!x) continue;
      try { await host.storage.delete(keyOf(id), { version: x.version }); } catch (err) { /* gone already */ }
      entries.delete(id);
      made = null;
    }
    for (const w of plan.was) {
      const x = entries.get(w.id);
      const row = await host.storage.set(keyOf(w.id), w.value, x ? { version: x.version } : {});
      keep(row.key, row.value, row.version);
    }
    await syncAll();
    render();
  }
  async function applyImport(items, mode) {
    const plan = { created: [], was: [] };
    importing = true;
    try {
      const keepIds = new Set(items.map((x) => x.id));
      for (const it of items) {
        const had = entries.get(it.id);
        if (had) plan.was.push({ id: it.id, value: L.stored(had.e) }); else plan.created.push(it.id);
        const row = await host.storage.set(keyOf(it.id), it.value, had ? { version: had.version } : {});
        keep(row.key, row.value, row.version);
      }
      if (mode === 'replace') {
        for (const old of list().filter((e) => !keepIds.has(e.id))) {
          const had = entries.get(old.id);
          if (!had) continue;
          plan.was.push({ id: old.id, value: L.stored(had.e) });
          await host.storage.delete(keyOf(old.id), { version: had.version });
          entries.delete(old.id);
          made = null;
        }
      }
    } catch (err) {
      try { await putBack(plan); } catch (again) { /* what could not be put back is read on the next load */ }
      throw err;
    } finally { importing = false; }
    await syncAll();
    render();
    return plan;
  }
  function offerUndo(plan, text) {
    clearTimeout(undoTimer);
    undoPlan = plan;
    $('undo-text').textContent = text;
    $('undo').hidden = false;
    undoTimer = setTimeout(() => { undoPlan = null; $('undo').hidden = true; }, UNDO_SECONDS * 1000);
  }
  $('undo-btn').addEventListener('click', async () => {
    const plan = undoPlan;
    clearTimeout(undoTimer);
    undoPlan = null;
    $('undo').hidden = true;
    if (!plan) return;
    try { await putBack(plan); say('Put back.', 'success'); } catch (err) { say((err && err.message) || 'It could not be put back.', 'danger'); }
  });
  async function importFile(file, mode) {
    if (!file || importing || !canEdit() || (mode === 'replace' && !canClear())) return;
    if (file.size > F.LIMITS.maxBytes) { say(`The file is too big: at most ${F.LIMITS.maxBytes / 1024 / 1024} MB.`, 'danger'); return; }
    let text;
    try { text = await file.text(); } catch (err) { say('That file could not be read.', 'danger'); return; }
    const parsed = F.parseFile(text, { label });
    if (parsed.problem) { say(parsed.problem, 'danger'); return; }
    if (mode === 'add' && entries.size + parsed.entries.length > F.LIMITS.maxPlan) { say(`The plan holds at most ${F.LIMITS.maxPlan} entries. This file would make ${entries.size + parsed.entries.length}.`, 'danger'); return; }
    const words = countWords(parsed.entries);
    const name = String(file.name || 'the file').slice(0, 60);
    let ok = false;
    try {
      ok = await host.ui.confirm(mode === 'add'
        ? { title: `Add ${words} to the plan?`, message: `From ${name}. What is in the plan now stays.`, action: 'Add to the plan' }
        : { title: 'Replace the plan?', message: `The ${entries.size} ${entries.size === 1 ? 'entry' : 'entries'} in the plan come off it and ${words} from ${name} go in.\n\nYou can undo this for ${UNDO_SECONDS} seconds.`, action: 'Replace the plan', kind: 'destructive' });
    } catch (err) { ok = false; }
    if (!ok) return;
    try {
      const items = F.importEntries(parsed.entries, { mode, existing: list(), newId: () => host.util.id(), orderAfter: (prev) => host.util.order(prev, null), by: me, dates: datesOn() });
      const plan = await applyImport(items, mode);
      offerUndo(plan, mode === 'add' ? `Added ${words}.` : `Replaced the plan with ${words}.`);
    } catch (err) {
      say(err && err.status === 409 ? 'Someone else changed the plan just now. Nothing was imported. Try again.' : `Nothing was imported. ${(err && err.message) || ''}`.trim(), 'danger');
    }
  }
  let picker = null;
  function pickFile(mode) {
    if (!canEdit() || importing || (mode === 'replace' && !canClear())) return;
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = '.json,application/json';
      picker.hidden = true;
      picker.setAttribute('aria-label', 'Plan file');
      picker.addEventListener('change', () => { const f = picker.files && picker.files[0]; const m = picker.dataset.mode; picker.value = ''; importFile(f, m); });
      $('app').append(picker);
    }
    picker.dataset.mode = mode;
    picker.click();
  }
  function moreItems() {
    const items = [{ id: 'export', label: 'Export as JSON', icon: 'file-export', disabled: !entries.size, hint: entries.size ? '' : 'Nothing yet', onClick: exportPlan }];
    if (canEdit()) items.push({ id: 'import-add', label: 'Import JSON: add to the plan', icon: 'file-import', disabled: importing, onClick: () => pickFile('add') });
    if (canEdit() && canClear()) items.push({ id: 'import-replace', label: 'Import JSON: replace the plan', icon: 'file-import', danger: true, disabled: importing, onClick: () => pickFile('replace') });
    return items;
  }
  host.on('toolbar', (e) => {
    if (e.id !== 'plan-more') return;
    host.menu.show({ id: 'plan-more', at: { x: Number(e.x) || 0, y: 4 }, items: moreItems() });
  });
  function syncToolbar() {
    host.toolbar.set([{ type: 'button', id: 'plan-more', icon: 'ellipsis', title: 'Export and import', zone: 'end' }]).catch(() => {});
  }

  // ---- live changes --------------------------------------------------------------------------------------------------
  let drawQueued = false;
  function queueRender() {
    if (drawQueued) return;
    drawQueued = true;
    queueMicrotask(() => { drawQueued = false; render(); });
  }
  host.on('change', (e) => {
    if (!String(e.key).startsWith(PREFIX)) return;
    if (e.deleted) { entries.delete(String(e.key).slice(PREFIX.length)); made = null; } else keep(e.key, e.value, e.version);
    queueRender();
  });
  host.on('changes', (e) => {
    const changes = (Array.isArray(e.changes) ? e.changes : []).filter((c) => String(c.key).startsWith(PREFIX));
    if (!changes.length) return;
    if (changes.some((c) => !c.deleted && c.value === undefined)) { load().then(render).catch(() => {}); return; }
    for (const c of changes) { if (c.deleted) { entries.delete(String(c.key).slice(PREFIX.length)); made = null; } else keep(c.key, c.value, c.version); }
    queueRender();
  });
  host.on('reconnected', () => { load().then(render).catch(() => {}); });
  host.settings.onChange((v) => {
    const was = [prefs.progressBy, prefs.dates];
    prefs = { ...prefs, ...v };
    render();
    if (prefs.progressBy !== was[0] || prefs.dates !== was[1]) syncAll().then(render).catch(() => {});
  });

  // ---- what links to a goal or a step (backlinks: a task, a document, a session) --------------------------------------
  const backlinks = new Map(); // id -> summaries
  const asked = new Set();
  function askBacklinks(ids) {
    if (!host.objects || !host.objects.linksTo) return;
    for (const id of ids) {
      if (asked.has(id)) continue;
      asked.add(id);
      host.objects.linksTo(host.objects.make('plan', id)).then((summaries) => {
        const was = JSON.stringify((backlinks.get(id) || []).map((c) => c.ref));
        backlinks.set(id, Array.isArray(summaries) ? summaries : []);
        if (JSON.stringify(backlinks.get(id).map((c) => c.ref)) !== was) queueRender();
      }).catch(() => backlinks.set(id, []));
    }
  }
  // What an entry's own links point at, resolved for their titles: id -> { sig, list }.
  const ownLinks = new Map();
  function askOwnLinks(list) {
    if (!host.objects || !host.objects.resolve) return;
    for (const e of list) {
      const refs = e.links || [];
      const sig = JSON.stringify(refs);
      const had = ownLinks.get(e.id);
      if (had && had.sig === sig) continue;
      ownLinks.set(e.id, { sig, list: [] });
      if (!refs.length) continue;
      host.objects.resolve(refs).then((summaries) => {
        const now = ownLinks.get(e.id);
        if (!now || now.sig !== sig) return;
        now.list = (Array.isArray(summaries) ? summaries : []).filter((c) => c && !c.error);
        queueRender();
      }).catch(() => {});
    }
  }
  const relook = setInterval(() => { if (!$('app')) return void clearInterval(relook); asked.clear(); ownLinks.clear(); }, 60000); // look again now and then: links come and go

  // ---- the toolbar, the + and the status line ------------------------------------------------------------------------
  const viewOptions = () => [
    { id: 'goals', label: cap(label('goal', { many: true })), icon: 'bullseye' },
    { id: 'list', label: 'List', icon: 'list' },
  ];
  const viewSwitch = host.ui.viewSwitch({ id: 'view', label: 'View', options: viewOptions(), value: view, onChange: (id) => { view = id === 'list' ? 'list' : 'goals'; render(); } });
  function syncAdd() {
    if (!host.add) return;
    host.add.set(canEdit() ? [
      { id: 'goal', label: `Add ${label('goal', { a: true })}`, icon: 'bullseye' },
      { id: 'note', label: `Add ${label('note', { a: true })}`, icon: 'note-sticky' },
    ] : []).catch(() => {});
  }
  host.on('add', ({ id }) => { if (id === 'goal' || id === 'note') openEditor({ kind: id }); });
  function syncStatus(tree) {
    if (!host.status) return;
    const total = tree.goals.length;
    if (!total) { host.status.set([]).catch(() => {}); return; }
    const done = tree.goals.filter((g) => L.goalState(g.goal, g.steps, prefs.progressBy).done).length;
    host.status.set([{ text: `${done} of ${total} ${label('goal', { many: total !== 1 })} done`, icon: 'bullseye' }]).catch(() => {});
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  const phaseOf = (id) => phases().find((x) => x.id === id) || null;
  function dayWords(day) {
    if (!day) return '';
    const d = new Date(`${day}T12:00:00`);
    return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(host.locale().language || 'en', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function tick(entry, { disabled = false, name } = {}) {
    const wrap = make('label', 'sdk-row-tick');
    const box = make('input');
    box.type = 'checkbox';
    box.checked = Boolean(entry.done);
    box.disabled = disabled || !canEdit();
    box.setAttribute('aria-label', name || `Done: ${entry.title}`);
    box.addEventListener('change', () => setDone(entry.id, box.checked));
    wrap.append(box);
    return wrap;
  }
  function moreButton(entry) {
    const b = make('button', 'sdk-icon-btn btn-quiet btn-small');
    b.type = 'button';
    b.setAttribute('aria-label', `More: ${entry.title}`);
    b.setAttribute('aria-haspopup', 'menu');
    b.append(icon('ellipsis-vertical'));
    b.addEventListener('click', () => host.menu.show({ id: `entry-${entry.id}`, anchor: b, items: menuItems(entry) }));
    return b;
  }
  function menuItems(entry) {
    const items = [{ id: 'open', label: canEdit() ? 'Edit' : 'Open', icon: canEdit() ? 'pen' : 'eye', onClick: () => openEditor({ id: entry.id }) }];
    if (!canEdit()) return items;
    if (entry.kind === 'goal') {
      items.push({ id: 'step', label: `Add ${label('step', { a: true })}`, icon: 'plus', onClick: () => openEditor({ kind: 'step', parent: entry.id }) });
      items.push({ id: 'note', label: `Add ${label('note', { a: true })}`, icon: 'note-sticky', onClick: () => openEditor({ kind: 'note', parent: entry.id }) });
    }
    let armed = false;
    const kids = entry.kind === 'goal' ? childrenOf(entry.id).length : 0;
    items.push({ separator: true }, {
      id: 'delete', label: 'Delete', icon: 'trash', danger: true,
      onClick: (_, b) => {
        if (!armed) { armed = true; b.querySelector('.sdk-menu-label').textContent = kids ? `Delete it and ${kids} under it?` : 'Really delete?'; return false; }
        remove(entry.id).then(render).catch((err) => note(err.message));
        return undefined;
      },
    });
    return items;
  }
  function linksLine(id) {
    const seen = new Set();
    const summaries = [...((ownLinks.get(id) || {}).list || []), ...(backlinks.get(id) || [])].filter((c) => { const k = JSON.stringify(c.ref); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!summaries.length) return null;
    const line = make('div', 'goal-links');
    line.append(make('span', '', 'Linked:'));
    for (const c of summaries.slice(0, 12)) {
      const chip = make(c.open ? 'button' : 'span', 'sdk-chip-tag');
      if (c.open) { chip.type = 'button'; chip.addEventListener('click', () => host.objects.open(c.ref).catch((err) => note(err.message))); }
      chip.append(make('b', '', c.kindName || (c.module && c.module.name) || ''), document.createTextNode(` ${c.title || ''}`));
      line.append(chip);
    }
    return line;
  }
  function entryRow(entry) {
    const li = make('li', `sdk-row ${entry.kind === 'step' ? 'step' : 'note-row'}${entry.done ? ' done' : ''}`);
    li.dataset.id = entry.id;
    if (entry.kind === 'step') li.append(tick(entry)); else li.append(icon('note-sticky'));
    const open = make('button', 'sdk-open entry-open');
    open.type = 'button';
    open.append(make('span', 'sdk-row-title entry-text', entry.title || 'Untitled'));
    open.addEventListener('click', () => openEditor({ id: entry.id }));
    li.append(open);
    if (entry.date && datesOn()) li.append(make('span', 'sdk-row-meta', dayWords(entry.date)));
    return li;
  }
  function chipOf(name, text) {
    const chip = make('span', 'sdk-chip-tag');
    const words = make('span', 'chip-words');
    words.append(icon(name), document.createTextNode(text));
    chip.append(words);
    return chip;
  }
  function goalCard(g) {
    const { goal, steps, children } = g;
    const state = L.goalState(goal, steps, prefs.progressBy);
    const card = make('article', `sdk-card-banded goal${state.done ? ' done' : ''}`);
    card.dataset.id = goal.id;
    const head = make('div', 'sdk-card-head');
    const main = make('div', 'sdk-card-main');
    if (!state.derived) main.append(tick({ ...goal, done: state.done }, { name: `Done: ${goal.title}` }));
    else if (state.done) { const c = icon('circle-check', 'goal-check'); main.append(c); }
    const title = make('button', 'sdk-open sdk-card-title goal-title', goal.title || 'Untitled');
    title.type = 'button';
    title.addEventListener('click', () => openEditor({ id: goal.id }));
    main.append(title);
    head.append(main, moreButton(goal));
    const outer = make('div', 'sdk-card-body');
    const body = make('div', 'goal-body');
    outer.append(body);
    const meta = make('div', 'goal-meta');
    const ph = goal.phase ? phaseOf(goal.phase) : null;
    if (ph && ph.label) { meta.append(chipOf(ph.icon || 'flag', ph.label)); } // the phase's own icon
    if (goal.date && datesOn()) { meta.append(chipOf('calendar', dayWords(goal.date))); }
    const owners = (goal.owners || []).map(personName).filter(Boolean);
    if (owners.length) { meta.append(chipOf('user', `${cap(label('owner', { many: owners.length !== 1 }))}: ${owners.join(', ')}`)); }
    if (meta.childElementCount) body.append(meta);
    if (goal.why) body.append(make('p', 'goal-why', goal.why));
    if (state.derived || steps.length) {
      const bar = make('div', 'goal-progress');
      host.ui.progress(bar, { done: state.stepsDone, total: state.steps, label: `${cap(label('step', { many: true }))} done`, words: (d, t) => `${d} of ${t} ${label('step', { many: t !== 1 })} done` });
      body.append(bar);
    }
    if (children.length) {
      const rows = make('ul', 'goal-rows');
      for (const c of children) rows.append(entryRow(c));
      body.append(rows);
    }
    const foot = make('div', 'goal-foot');
    if (canEdit()) {
      const addStep = make('button', 'btn btn-small btn-quiet');
      addStep.type = 'button';
      addStep.append(icon('plus'), document.createTextNode(` Add ${label('step', { a: true })}`));
      addStep.addEventListener('click', () => openEditor({ kind: 'step', parent: goal.id }));
      foot.append(addStep);
    }
    const links = linksLine(goal.id);
    if (links) foot.append(links);
    if (foot.childElementCount) body.append(foot);
    card.append(head, outer);
    return card;
  }
  const LOOSE_MAX = 500; // the entries under no goal drawn in the Goals view; a list written to be huge stays quick to draw
  function drawGoals(tree) {
    const box = $('view-goals');
    const parts = tree.goals.map(goalCard);
    if (tree.loose.length) {
      const group = make('section', 'goals-loose');
      group.append(make('h3', 'sdk-group-head', `Not under ${label('goal', { a: true })}`));
      const rows = make('ul', 'goal-rows');
      for (const e of tree.loose.slice(0, LOOSE_MAX)) rows.append(entryRow(e));
      group.append(rows);
      if (tree.loose.length > LOOSE_MAX) group.append(make('p', 'sdk-hint', `${tree.loose.length - LOOSE_MAX} more are in the List view.`));
      parts.push(group);
    }
    if (!parts.length) {
      const empty = make('div', 'sdk-empty');
      empty.append(icon('bullseye'), make('h2', 'sdk-empty-title', `No ${label('goal', { many: true })} yet`));
      empty.append(make('p', 'sdk-empty-text', canEdit() ? `Add ${label('goal', { a: true })} to start the plan, then the ${label('step', { many: true })} that get there.` : `Nobody has added ${label('goal', { a: true })} yet.`));
      if (canEdit()) {
        const actions = make('div', 'sdk-empty-actions');
        const add = make('button', 'btn btn-primary');
        add.type = 'button';
        add.append(icon('plus'), document.createTextNode(` ${cap(`Add ${label('goal', { a: true })}`)}`));
        add.addEventListener('click', () => openEditor({ kind: 'goal' }));
        actions.append(add);
        empty.append(actions);
      }
      parts.push(empty);
    }
    box.replaceChildren(...parts);
    askBacklinks(tree.goals.map((g) => g.goal.id));
    askOwnLinks(tree.goals.map((g) => g.goal));
  }

  // The List view: the shared outline, two levels (a goal, then its steps and notes).
  let outline = null;
  function outlineRow(entry, content) {
    const e = (entries.get(entry.id) || {}).e || entry;
    const row = make('div', `out-row${e.done ? ' done' : ''}`);
    if (e.kind === 'note') row.append(icon('note-sticky'));
    else if (e.kind === 'goal') {
      const state = L.goalState(e, childrenOf(e.id), prefs.progressBy);
      if (state.derived) row.append(icon(state.done ? 'circle-check' : 'bullseye'));
      else row.append(tick({ ...e, done: state.done }));
    } else row.append(tick(e));
    row.append(make('span', 'out-title', e.title || 'Untitled'));
    const metaBits = [];
    if (e.kind === 'goal') {
      const state = L.goalState(e, childrenOf(e.id), prefs.progressBy);
      if (state.steps) metaBits.push(`${state.stepsDone} of ${state.steps}`);
    }
    if (e.date && datesOn()) metaBits.push(dayWords(e.date));
    if (metaBits.length) row.append(make('span', 'out-meta', metaBits.join(' · ')));
    content.append(row);
  }
  async function onMove({ id, parent, order }) {
    const problem = L.moveProblem(byId(), { id, parent }, label);
    if (problem) { note(problem); render(); return; }
    try { await update(id, { parent: parent || null, order }); } catch (err) { note(err.message); }
    render();
  }
  function drawList() {
    const box = $('view-list');
    const items = L.outlineEntries(list());
    if (!outline) {
      outline = host.ui.outline(box, {
        entries: items,
        depth: 2,
        name: cap(label('goal', { many: true })),
        canEdit: canEdit(),
        empty: `No ${label('goal', { many: true })} yet.`,
        row: outlineRow,
        menu: (entry) => menuItems((entries.get(entry.id) || {}).e || entry).filter((m) => m.id !== 'open'),
        onOpen: (entry) => openEditor({ id: entry.id }),
        onMove,
      });
    } else outline.set(items);
  }

  function render() {
    const tree = L.treeOf(list());
    viewSwitch.set(view, viewOptions());
    $('view-goals').hidden = view !== 'goals';
    $('view-list').hidden = view !== 'list';
    if (view === 'goals') drawGoals(tree); else drawList();
    syncAdd();
    syncToolbar();
    syncStatus(tree);
  }

  // ---- the form --------------------------------------------------------------------------------------------------------
  const editor = host.ui.editor($('editor'), {
    isDirty: () => form.snapshot !== null && snapshot() !== form.snapshot,
    onClose: () => { form.id = null; form.kind = null; form.snapshot = null; form.links = []; armedDelete = false; },
  });
  const form = { id: null, kind: null, snapshot: null, links: [] };
  let armedDelete = false;
  const datePicker = host.ui.datePicker($('f-date'), { clearable: true });
  const owners = host.ui.peoplePicker($('f-owners'), { people, value: [], name: cap(label('owner', { many: true })) });
  function snapshot() {
    return JSON.stringify([form.links, $('f-title').value, $('f-parent').value, $('f-why').value, $('f-text').value, owners.get(), $('f-date').value, $('f-phase').value, $('f-done').checked]);
  }
  function fillSelect(sel, options, value) {
    sel.replaceChildren(...options.map(([v, t]) => { const o = make('option', '', t); o.value = v; return o; }));
    sel.value = value;
    if (sel.value !== value && options.length) sel.value = options[0][0];
  }
  // Opens the form: { id } for one that exists, { kind, parent? } for a new one.
  function openEditor({ id, kind, parent } = {}) {
    const x = id ? entries.get(id) : null;
    if (id && !x) { note('That is no longer in the plan.'); return; }
    const e = x ? x.e : { kind: kind || 'goal', title: '', parent: parent || null };
    if (!x && !canEdit()) return;
    const k = e.kind;
    const readOnly = !canEdit();
    form.id = x ? e.id : null;
    form.kind = k;
    $('editor-title').textContent = x ? (readOnly ? cap(label(k)) : `Edit ${label(k, { a: false })}`) : `New ${label(k)}`;
    $('f-title').value = e.title || '';
    const goals = L.treeOf(list()).goals.map((g) => [g.goal.id, g.goal.title || 'Untitled']);
    $('f-parent-row').hidden = k === 'goal';
    $('f-parent-label').textContent = `Under ${label('goal', { a: true })}`;
    fillSelect($('f-parent'), k === 'note' ? [['', 'None: at the top'], ...goals] : goals, e.parent || '');
    $('f-why-row').hidden = k !== 'goal';
    $('f-why').value = e.why || '';
    $('f-text-row').hidden = k !== 'note';
    $('f-text').value = e.text || '';
    $('f-owners-row').hidden = k !== 'goal';
    $('f-owners-label').textContent = cap(label('owner', { many: true }));
    owners.setPeople(people);
    owners.set(e.owners || []);
    $('f-date-row').hidden = k === 'note' || !datesOn();
    $('f-date-label').firstChild.textContent = k === 'goal' ? 'Target date ' : 'Date ';
    $('f-date').value = e.date || '';
    const ph = phases();
    $('f-phase-row').hidden = k !== 'goal' || !ph.length;
    fillSelect($('f-phase'), [['', 'None'], ...ph.map((p) => [p.id, p.label])], e.phase || '');
    const state = k === 'goal' && x ? L.goalState(e, childrenOf(e.id), prefs.progressBy) : null;
    $('f-done-row').hidden = k === 'note' || Boolean(state && state.derived);
    $('f-done').checked = Boolean(state ? state.done : e.done);
    $('f-derived').hidden = !(state && state.derived);
    $('f-derived').textContent = state && state.derived ? `Done when every ${label('step')} is done: ${state.stepsDone} of ${state.steps} so far.` : '';
    form.links = L.cleanLinks(e.links || []);
    $('f-links-row').hidden = readOnly && !form.links.length;
    $('f-link').hidden = readOnly;
    drawFormLinks();
    $('f-error').hidden = true;
    $('f-delete').hidden = !x || readOnly;
    $('f-delete').textContent = 'Delete';
    armedDelete = false;
    for (const f of $('form').querySelectorAll('input, select, textarea')) f.disabled = readOnly;
    for (const b of [$('f-save'), $('f-cancel')]) b.hidden = readOnly;
    if (k === 'step' && !goals.length) { $('f-error').textContent = `Add ${label('goal', { a: true })} first; ${label('step', { a: true })} goes under one.`; $('f-error').hidden = false; $('f-save').disabled = true; } else $('f-save').disabled = false;
    datePicker.refresh();
    form.snapshot = readOnly ? null : snapshot();
    editor.open({ focus: readOnly ? editor.element : $('f-title') });
  }
  async function save() {
    const raw = {
      title: $('f-title').value,
      parent: $('f-parent').value || null,
      why: $('f-why').value,
      text: $('f-text').value,
      owners: owners.get(),
      date: $('f-date').value,
      phase: $('f-phase').value,
      done: $('f-done').checked,
      links: form.links,
    };
    if (form.kind === 'goal') raw.parent = null;
    if (form.kind === 'step' && !raw.parent) { $('f-error').textContent = `Choose the ${label('goal')} it goes under.`; $('f-error').hidden = false; return; }
    if (!raw.title.trim()) { $('f-error').textContent = 'Give it a title.'; $('f-error').hidden = false; $('f-title').focus(); return; }
    $('f-save').disabled = true;
    try {
      let id = form.id;
      if (id) {
        const x = entries.get(id);
        const changes = { ...raw };
        if (x && x.e.parent !== raw.parent && form.kind !== 'goal') changes.order = orderAtEnd(raw.parent);
        if (!datesOn()) delete changes.date;
        if (form.kind === 'goal' && x && L.goalState(x.e, childrenOf(id), prefs.progressBy).derived) delete changes.done;
        await update(id, changes);
      } else id = await add(form.kind, raw);
      host.objects.setLinks(host.objects.make('plan', id), L.cleanLinks(raw.links)).catch((err) => console.error(err));
      editor.close();
      render();
    } catch (err) {
      $('f-error').textContent = err.message || 'That could not be saved.';
      $('f-error').hidden = false;
    } finally {
      $('f-save').disabled = false;
    }
  }
  // The objects an entry links to, in the form: a chip each with its title as it reads now, and a way to take it off.
  let linksSeq = 0;
  function drawFormLinks() {
    const box = $('f-links');
    const refs = form.links.slice();
    const seq = ++linksSeq;
    const readOnly = !canEdit();
    const chipFor = (ref, c) => {
      const chip = make('span', 'sdk-chip-tag link-chip');
      const name = c && !c.error ? `${c.kindName || ''} ${c.title || ''}`.trim() : c && c.state === 'hidden' ? 'Not available to you' : 'No longer available';
      chip.append(make('span', 'link-words', name));
      if (!readOnly) {
        const x = make('button', 'sdk-icon-btn btn-quiet btn-small');
        x.type = 'button';
        x.setAttribute('aria-label', `Remove link: ${name}`);
        x.append(icon('xmark'));
        x.addEventListener('click', () => { form.links = form.links.filter((r) => r !== ref); drawFormLinks(); });
        chip.append(x);
      }
      return chip;
    };
    box.replaceChildren(...refs.map((r) => chipFor(r, null)));
    if (!refs.length || !host.objects || !host.objects.resolve) return;
    host.objects.resolve(refs).then((summaries) => {
      if (seq !== linksSeq) return;
      box.replaceChildren(...refs.map((r, i) => chipFor(r, Array.isArray(summaries) ? summaries[i] : null)));
    }).catch(() => {});
  }
  $('f-link').addEventListener('click', async () => {
    if (!host.objects || !host.objects.pick) return;
    try {
      const picked = await host.objects.pick({ multiple: true, title: 'Link something' });
      if (!picked) return;
      form.links = L.cleanLinks([...form.links, ...(Array.isArray(picked) ? picked : [picked])]);
      drawFormLinks();
    } catch (err) { $('f-error').textContent = err.message; $('f-error').hidden = false; }
  });
  $('f-save').addEventListener('click', save);
  $('form').addEventListener('submit', (ev) => { ev.preventDefault(); save(); });
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('f-delete').addEventListener('click', async () => {
    const id = form.id;
    if (!id) return;
    if (!armedDelete) {
      armedDelete = true;
      const kids = childrenOf(id).length;
      $('f-delete').textContent = kids ? `Delete it and ${kids} under it?` : 'Really delete?';
      return;
    }
    try { await remove(id); editor.close(); render(); } catch (err) { $('f-error').textContent = err.message; $('f-error').hidden = false; }
  });

  // ---- what other modules may ask, and being opened from a link ---------------------------------------------------------
  const ownGoal = (ref) => {
    const x = L.isOwnRef(ref, info.module.id, info.context.spaceId) ? entries.get(ref.id) : null;
    if (!x || x.e.kind !== 'goal') throw new Error(`That is not ${label('goal', { a: true })} of this plan.`);
    return x.e;
  };
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      addGoal: async (input) => {
        const id = await add('goal', { title: input.title, why: input.why, date: input.date });
        render();
        return { ref: host.objects.make('plan', id) };
      },
      addStep: async (input) => {
        const goal = ownGoal(input.goal);
        const id = await add('step', { title: input.title, date: input.date, parent: goal.id });
        render();
        return { ref: host.objects.make('plan', id) };
      },
      addNote: async (input) => {
        const parent = input.goal ? ownGoal(input.goal).id : null;
        const id = await add('note', { title: input.title, text: input.text, parent });
        render();
        return { ref: host.objects.make('plan', id) };
      },
    });
  }
  if (host.objects && host.objects.onOpen) host.objects.onOpen((ref) => { if (L.isOwnRef(ref, info.module.id, info.context.spaceId) && entries.has(ref.id)) openEditor({ id: ref.id }); });

  // ---- start -------------------------------------------------------------------------------------------------------------
  try {
    await load();
  } catch (err) {
    showMsg('The plan could not load', err.message, () => location.reload());
    return;
  }
  $('loading').hidden = true;
  $('app').hidden = false;
  render();
  syncAll().then(render).catch(() => {});
})();
