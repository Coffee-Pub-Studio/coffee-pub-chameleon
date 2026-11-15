// Planner - Projects (the Schedule outline, documentation/plans/plan-templates-redesign.md, "The planners"): a space's plan of
// milestones, the work with its owners and dates, notes, and what waits on what. Two views: the Timeline (weeks across, work as
// bars, milestones as marks, the "waits on" lines, what has no day in "Not scheduled" below) and the List (the shared outline,
// host.ui.outline). Its entries are the `plan` kind (the planners' convention), so the Calendar shows the dated ones, To-do's
// tasks link under them, and a phase measured by goals counts the ones that name it. The rules are in schedule-lib.js. Nothing
// here names another module.
(async () => {
  'use strict';

  const host = (document.currentScript && document.currentScript.host) || window.host;
  const root = host.root;
  const word = host.util.word;
  const $ = (id) => root.getElementById(id);
  function showMsg(title, text, retry) {
    $('loading').hidden = true;
    const m = $('msg');
    const icon = document.createElement('span');
    icon.className = 'ic';
    host.ui.icon(retry ? 'triangle-exclamation' : 'circle-info').then((svg) => { icon.innerHTML = svg; }).catch(() => {});
    const head = document.createElement('h2');
    head.className = 'sdk-empty-title';
    head.textContent = title;
    const parts = [icon, head];
    if (text) {
      const line = document.createElement('p');
      line.className = 'sdk-empty-text';
      line.textContent = text;
      parts.push(line);
    }
    if (retry) {
      const actions = document.createElement('div');
      actions.className = 'sdk-empty-actions';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn';
      again.textContent = 'Retry';
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
  if (info.context.scope !== 'space') {
    showMsg(`${info.module.name} works inside ${word('space', { a: true })}.`, `Open ${word('space', { a: true })}, then ${info.module.name} there.`);
    return;
  }
  /*__LIB__*/

  const canEdit = host.can('edit');
  const label = (key, o) => host.util.label(key, o);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const KIND_ICON = { milestone: 'flag', work: 'bars-progress', note: 'note-sticky' };

  // --- state ---------------------------------------------------------------------------------------------------------
  const state = {
    entries: new Map(), // id -> { e, version }
    people: [],
    settings: { datesRequired: true, dependencies: true, progressBy: 'milestones', defaultView: 'timeline', tags: [] },
    phases: [],
    links: new Map(), // id -> [summary] (what links to each entry: To-do's tasks and the rest)
    view: '',
    loaded: false,
    editing: null,
    openWanted: null,
  };
  const list = () => [...state.entries.values()].map((x) => x.e);
  const entry = (id) => (state.entries.get(id) || {}).e || null;
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';
  const today = () => host.util.ymd(new Date());
  const tagOf = (id) => state.settings.tags.find((t) => t.id === id) || null;
  const phaseOf = (id) => state.phases.find((p) => p.id === id) || null;
  const kindWord = (kind, o) => label(kind, o);

  // --- small helpers ---------------------------------------------------------------------------------------------------
  const clone = (id) => $(id).content.firstElementChild.cloneNode(true);
  const hide = (node, yes) => { if (node) node.hidden = Boolean(yes); };
  const slot = (el, name) => (el.dataset.slot === name ? el : el.querySelector(`[data-slot="${name}"]`));
  function fill(el, values) {
    for (const [name, value] of Object.entries(values)) {
      const s = slot(el, name);
      if (!s) continue;
      s.textContent = value == null ? '' : String(value);
      s.hidden = value === '' || value == null;
    }
  }
  const iconSvg = new Map();
  const iconWait = new Map();
  function wantIcon(name) {
    if (iconSvg.has(name)) return Promise.resolve(iconSvg.get(name));
    if (!iconWait.has(name)) iconWait.set(name, host.ui.icon(name).then((svg) => { iconSvg.set(name, svg); return svg; }).catch(() => { iconSvg.set(name, ''); return ''; }));
    return iconWait.get(name);
  }
  function hydrate(scope) {
    const pending = new Set();
    for (const el of scope.querySelectorAll('[data-icon]')) {
      const name = el.dataset.icon;
      if (!name || el.dataset.shown === name) continue;
      if (iconSvg.has(name)) { el.innerHTML = iconSvg.get(name); el.dataset.shown = name; } else pending.add(name);
    }
    if (pending.size) Promise.all([...pending].map(wantIcon)).then(() => hydrate(scope));
  }
  const setIcon = (node, name) => { if (node) { node.dataset.icon = name || ''; delete node.dataset.shown; node.textContent = ''; } };
  const icon = (name) => { const s = document.createElement('span'); s.className = 'ic'; s.dataset.icon = name; return s; };
  const say = (text) => { if (text && host.ui && host.ui.toast) host.ui.toast(String(text)).catch(() => {}); };
  const dayDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const thisYear = new Date().getFullYear();
  const dayShort = (d) => { const x = dayDate(d); return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(x.getFullYear() !== thisYear ? { year: 'numeric' } : {}) }); };
  const span = (e) => (e.kind === 'work' && e.end && e.end !== e.start ? `${dayShort(e.start)} to ${dayShort(e.end)}` : e.start ? dayShort(e.start) : '');

  // --- the store -----------------------------------------------------------------------------------------------------
  const remember = (id, value, version) => {
    if (value && typeof value === 'object') state.entries.set(id, { e: scClean(id, value), version }); else state.entries.delete(id);
  };
  async function loadEntries() {
    state.entries.clear();
    for (const it of await host.storage.list(SC_PREFIX)) remember(it.key.slice(SC_PREFIX.length), it.value, it.version);
  }
  let drawSoon = 0;
  const redraw = () => { if (!state.loaded || drawSoon) return; drawSoon = requestAnimationFrame(() => { drawSoon = 0; render(); }); };
  host.on('change', (e) => {
    if (!String(e.key).startsWith(SC_PREFIX) || e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    remember(String(e.key).slice(SC_PREFIX.length), e.deleted ? null : e.value, e.version);
    redraw();
  });
  host.on('changes', (e) => {
    if (e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    const changes = (Array.isArray(e.changes) ? e.changes : []).filter((c) => String(c.key).startsWith(SC_PREFIX));
    if (!changes.length) return;
    if (changes.some((c) => !c.deleted && c.value === undefined)) { if (state.loaded) loadEntries().then(render).catch(() => {}); return; }
    for (const c of changes) remember(String(c.key).slice(SC_PREFIX.length), c.deleted ? null : c.value, c.version);
    redraw();
  });
  const pointer = (id) => host.objects.make('plan', id);

  async function write(e, version) {
    const saved = await host.storage.set(SC_PREFIX + e.id, scValue(e), version === undefined ? {} : { version });
    state.entries.set(e.id, { e: scClean(e.id, scValue(e)), version: saved && saved.version });
    return saved;
  }
  // A milestone is done when it is ticked or when everything under it is; its progress is how much of that is done. Kept in
  // what is stored (the refs summary's `done` and `progress`), so the Calendar, To-do and the phase measure read it as shown.
  // Written after a change by the person who made it; two people writing the same answer at once is harmless.
  async function settleMilestones() {
    if (!canEdit) return;
    const work = list().filter((e) => e.kind !== 'note');
    const changes = scMilestoneChanges(list(), host.util.rollup(work));
    for (const c of changes) {
      const had = state.entries.get(c.id);
      if (!had) continue;
      try { await write({ ...had.e, done: c.done, progress: c.progress }, had.version); } catch (err) { /* someone else wrote it: theirs is read next */ }
    }
  }
  async function saveEntry(e, version) {
    await write(e, version);
    host.objects.setLinks(pointer(e.id), e.ref ? [e.ref] : []).catch(() => {});
    await settleMilestones();
    render();
    return e;
  }
  async function removeEntry(id) {
    const had = state.entries.get(id);
    await host.storage.delete(SC_PREFIX + id, had ? { version: had.version } : {});
    state.entries.delete(id);
    host.objects.setLinks(pointer(id), []).catch(() => {});
    // What waited on it waits on it no more; what sat under it moves up to where it was.
    for (const e of list()) {
      const next = { ...e };
      let changed = false;
      if (e.waitsOn.includes(id)) { next.waitsOn = e.waitsOn.filter((w) => w !== id); changed = true; }
      if (e.parent === id) { next.parent = had ? had.e.parent : null; changed = true; }
      if (changed) { try { await write(next, state.entries.get(e.id).version); } catch (err) { /* read again on its change */ } }
    }
    await settleMilestones();
    render();
  }
  // The order key after the last entry under `parent`.
  function orderAtEnd(parent) {
    const sibs = list().filter((e) => (e.parent || null) === (parent || null) && e.order).map((e) => e.order).sort();
    try { return host.util.order(sibs.length ? sibs[sibs.length - 1] : null, null); } catch (err) { return ''; }
  }

  // --- what links to the entries -------------------------------------------------------------------------------------
  let linksAsked = 0;
  async function loadLinks() {
    if (!host.objects || !host.objects.linksToAll) return;
    const ids = list().map((e) => e.id);
    const ask = ++linksAsked;
    const next = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      let answer = [];
      try { answer = await host.objects.linksToAll(ids.slice(i, i + 200).map(pointer)); } catch (err) { return; }
      for (const row of Array.isArray(answer) ? answer : []) if (row && row.ref && Array.isArray(row.summaries)) next.set(row.ref.id, row.summaries);
    }
    if (ask !== linksAsked) return;
    state.links = next;
    if (state.loaded) render();
  }
  if (host.on) host.on('links', () => { loadLinks().catch(() => {}); });

  // --- the window around it: views, add, status ------------------------------------------------------------------------
  const VIEW_OPTIONS = () => [
    { id: 'timeline', label: 'Timeline', icon: 'chart-gantt' },
    { id: 'list', label: 'List', icon: 'list' },
  ];
  let viewSwitch = null;
  const VIEW_KEY = `schedule-view:${info.context.spaceId || ''}`;
  function showView(next) {
    state.view = next === 'list' ? 'list' : 'timeline';
    try { localStorage.setItem(VIEW_KEY, state.view); } catch (err) { /* not remembered */ }
    host.menu.close();
    render();
  }
  const ADDS = () => (canEdit ? SC_KINDS.map((k) => ({ id: k, label: cap(`Add ${kindWord(k, { a: true })}`), icon: KIND_ICON[k] })) : []);
  function chrome() {
    host.add.set(ADDS()).catch(() => {});
    const p = scProgress(list(), state.settings.progressBy);
    const what = state.settings.progressBy === 'work' ? kindWord('work', { many: true }) : kindWord('milestone', { many: true });
    host.status.set(p.total ? [{ text: `${p.done} of ${p.total} ${what} done`, icon: 'diagram-project' }] : []).catch(() => {});
  }
  host.on('add', (e) => { if (canEdit && SC_KINDS.includes(e.id)) openEditor(null, { kind: e.id }); });

  // --- render ----------------------------------------------------------------------------------------------------------
  function render() {
    if (!state.loaded) return;
    viewSwitch.set(state.view, VIEW_OPTIONS());
    const empty = state.entries.size === 0;
    hide($('view-timeline'), empty || state.view !== 'timeline');
    hide($('view-list'), empty || state.view !== 'list');
    if (empty) renderEmpty(); else { $('msg').hidden = true; if (state.view === 'timeline') renderTimeline(); else renderList(); }
    hydrate(root);
    chrome();
  }
  function renderEmpty() {
    const el = clone('tpl-state');
    fill(el, { title: `No ${label('plan')} yet`, text: canEdit ? `Add ${kindWord('milestone', { a: true })} or some ${kindWord('work')} to start the ${label('plan')}. Each can have dates, ${label('owner', { many: true })} and what it waits on.` : `Nothing is on the ${label('plan')} yet.` });
    const actions = slot(el, 'actions-wrap');
    if (canEdit) {
      for (const k of ['milestone', 'work']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = k === 'milestone' ? 'btn btn-primary' : 'btn';
        b.append(icon('plus'), ' ', cap(`Add ${kindWord(k, { a: true })}`));
        b.addEventListener('click', () => openEditor(null, { kind: k }));
        actions.append(b);
      }
    } else actions.hidden = true;
    $('msg').replaceChildren(...el.childNodes);
    delete $('msg').dataset.kind;
    $('msg').hidden = false;
  }

  // The words under an entry's title: its dates, owners, phase and what it waits on.
  function subWords(e) {
    const parts = [];
    const when = span(e);
    if (when) parts.push(when);
    else if (e.kind !== 'note') parts.push('No date');
    if (e.owners.length) parts.push(e.owners.map((k) => nameOf(k) || 'Someone who left').join(', '));
    const ph = e.phase && phaseOf(e.phase);
    if (ph) parts.push(ph.label);
    if (state.settings.dependencies && e.waitsOn.length) {
      const names = e.waitsOn.map(entry).filter(Boolean).map((w) => w.title);
      if (names.length) parts.push(`Waits on ${names.join(', ')}`);
    }
    if (scLate(e, today())) parts.push('Late');
    return parts.join(' · ');
  }
  function tagChips(e, into) {
    into.replaceChildren();
    for (const id of e.tags) {
      const t = tagOf(id);
      if (!t) continue;
      const c = document.createElement('span');
      c.className = 'tag';
      if (t.color) c.style.setProperty('--tone', t.color);
      if (t.icon) c.append(icon(t.icon));
      c.append(document.createTextNode(t.label));
      into.append(c);
    }
    into.hidden = !into.childNodes.length;
  }
  function linkChips(e, into, max) {
    into.replaceChildren();
    const got = state.links.get(e.id) || [];
    for (const s of got.slice(0, max)) {
      const b = document.createElement(s.open ? 'button' : 'span');
      b.className = 'link-chip';
      if (s.done) b.classList.add('done');
      if (s.open) { b.type = 'button'; b.addEventListener('click', (ev) => { ev.stopPropagation(); host.objects.open(s.ref).catch((err) => say(err && err.message)); }); }
      b.append(icon(s.done ? 'circle-check' : 'link'), document.createTextNode(s.title || s.kindName || ''));
      into.append(b);
    }
    if (got.length > max) { const more = document.createElement('span'); more.className = 'hint'; more.textContent = `and ${got.length - max} more`; into.append(more); }
    into.hidden = !got.length;
  }

  // --- the List ----------------------------------------------------------------------------------------------------------
  let outline = null;
  let progressBar = null;
  function renderList() {
    const all = list();
    const p = scProgress(all, state.settings.progressBy);
    const what = state.settings.progressBy === 'work' ? kindWord('work', { many: true }) : kindWord('milestone', { many: true });
    if (!progressBar) progressBar = host.ui.progress($('list-progress'), { done: p.done, total: p.total, label: `The ${label('plan')}'s progress`, words: (d, t) => `${d} of ${t} ${what} done` });
    else progressBar.set(p);
    hide($('list-progress'), !p.total);
    lastRolled = host.util.rollup(all.filter((e) => e.kind !== 'note'));
    const opts = {
      entries: all,
      depth: 2,
      name: cap(label('plan')),
      canEdit,
      labels: { empty: `Nothing on the ${label('plan')} yet.` },
      title: (e) => e.title,
      row: (e, content) => drawLine(e, content),
      onOpen: (e) => openEditor(e.id),
      menu: (e) => rowMenu(e),
      onMove: (m) => moveEntry(m),
    };
    if (!outline) outline = host.ui.outline($('outline'), opts);
    else outline.set(all);
  }
  let lastRolled = {};
  function drawLine(e, content) {
    const r = lastRolled[e.id];
    const el = clone('tpl-line');
    el.dataset.kind = e.kind;
    if (e.done) el.classList.add('done');
    if (scLate(e, today())) el.classList.add('late');
    const tick = el.querySelector('[data-action="tick"]');
    if (e.kind !== 'note' && canEdit) {
      tick.hidden = false;
      const mark = tick.querySelector('.ic');
      setIcon(mark, e.done ? 'circle-check' : '');
      mark.classList.toggle('ring', !e.done); // not done: an empty ring
      tick.setAttribute('aria-pressed', e.done ? 'true' : 'false');
      tick.setAttribute('aria-label', e.done ? `Mark "${e.title}" not done` : `Mark "${e.title}" done`);
      tick.dataset.tip = e.done ? 'Not done' : 'Done';
      tick.addEventListener('click', () => toggleDone(e.id));
    }
    setIcon(slot(el, 'mark-wrap').querySelector('.ic'), KIND_ICON[e.kind]);
    slot(el, 'mark-wrap').title = cap(kindWord(e.kind));
    fill(el, { title: e.title, sub: subWords(e) });
    el.querySelector('[data-action="open"]').setAttribute('aria-label', `${cap(kindWord(e.kind))}: ${e.title}`);
    el.querySelector('[data-action="open"]').addEventListener('click', () => openEditor(e.id));
    tagChips(e, slot(el, 'chips-wrap'));
    linkChips(e, slot(el, 'linked-wrap'), 3);
    const rollWrap = slot(el, 'roll-wrap');
    if (e.kind === 'milestone' && r && r.total) host.ui.progress(rollWrap, { done: r.done, total: r.total, label: `${e.title}: progress` });
    else rollWrap.hidden = true;
    content.append(el);
    hydrate(el);
  }
  function rowMenu(e) {
    if (!canEdit) return [];
    const items = [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(e.id) }];
    if (e.kind !== 'note') items.push({ id: 'done', label: e.done ? 'Mark not done' : 'Mark done', icon: e.done ? 'rotate-left' : 'circle-check', onClick: () => toggleDone(e.id) });
    if (e.kind === 'milestone') items.push({ id: 'add-under', label: cap(`Add ${kindWord('work')} under it`), icon: 'plus', onClick: () => openEditor(null, { kind: 'work', parent: e.id }) });
    items.push({ id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: () => confirmDelete(e.id) });
    return items;
  }
  async function confirmDelete(id) {
    const e = entry(id);
    if (!e) return;
    let ok = true;
    if (host.ui.confirm) {
      try { ok = await host.ui.confirm({ title: `Delete "${e.title}"?`, message: `It comes off the ${label('plan')} for everyone.`, action: 'Delete', kind: 'destructive' }); } catch (err) { ok = false; }
    }
    if (!ok) return;
    try { await removeEntry(id); } catch (err) { say(err && err.message ? err.message : 'It could not be deleted.'); }
  }
  async function toggleDone(id) {
    const had = state.entries.get(id);
    if (!had || !canEdit || had.e.kind === 'note') return;
    const e = { ...had.e };
    if (e.kind === 'milestone') { e.ticked = !e.done; e.done = e.ticked; } else e.done = !e.done;
    try { await saveEntry(e, had.version); } catch (err) { say(err && err.status === 409 ? 'Someone else changed it just now. Try again.' : (err && err.message) || 'It could not be saved.'); }
  }
  async function moveEntry(m) {
    const had = state.entries.get(m.id);
    if (!had || !canEdit) return;
    try { await saveEntry({ ...had.e, parent: m.parent || null, order: m.order }, had.version); } catch (err) { say(err && err.status === 409 ? 'Someone else changed it just now. Try again.' : (err && err.message) || 'It could not be moved.'); render(); }
  }

  // --- the Timeline --------------------------------------------------------------------------------------------------------
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v)); return el; };
  let narrow = false;
  function renderTimeline() {
    const all = list();
    const dayWidth = narrow ? 10 : 16;
    const t = scTimeline(all, { dayWidth, today: today() });
    const grid = $('tl-grid');
    grid.style.setProperty('--tl-width', `${t.width}px`);
    grid.style.setProperty('--tl-day', `${dayWidth}px`);
    // the weeks
    $('tl-weeks').replaceChildren(...t.weeks.map((w) => {
      const c = document.createElement('span');
      c.className = 'tl-week';
      c.style.setProperty('--x', `${w.x}px`);
      c.textContent = dayShort(w.day);
      return c;
    }));
    // the rows
    const rows = t.rows.map((r) => {
      const e = entry(r.id);
      const el = clone('tpl-tl-row');
      el.dataset.kind = e.kind;
      if (e.done) el.classList.add('done');
      if (scLate(e, today())) el.classList.add('late');
      setIcon(el.querySelector('.tl-label .ic'), KIND_ICON[e.kind]);
      fill(el, { name: e.title, bar: e.kind === 'work' ? e.title : '' });
      const bar = el.querySelector('.tl-bar');
      bar.style.setProperty('--x', `${r.x}px`);
      bar.style.setProperty('--w', `${r.w}px`);
      const what = `${cap(kindWord(e.kind))}: ${e.title}, ${span(e)}${e.done ? ', done' : ''}`;
      bar.setAttribute('aria-label', what);
      bar.dataset.tip = `${e.title} · ${span(e)}`;
      el.querySelector('.tl-label').setAttribute('aria-label', what);
      for (const b of el.querySelectorAll('[data-action="open"]')) b.addEventListener('click', () => openEditor(e.id));
      return el;
    });
    $('tl-rows').replaceChildren(...rows);
    const hasRows = t.rows.length > 0;
    hide($('tl-frame'), !hasRows);
    $('tl-none').textContent = hasRows ? '' : `Nothing on the ${label('plan')} has a date yet.`;
    hide($('tl-none'), hasRows);
    grid.style.setProperty('--tl-rows', String(t.rows.length));
    // today, and the lines between what waits and what it waits on
    const lines = $('tl-lines');
    lines.replaceChildren();
    const rowH = narrow ? 48 : 40;
    lines.setAttribute('width', String(t.width));
    lines.setAttribute('height', String(t.rows.length * rowH));
    if (t.today !== null && hasRows) lines.append(svgEl('line', { class: 'tl-today', x1: t.today + dayWidth / 2, x2: t.today + dayWidth / 2, y1: 0, y2: t.rows.length * rowH }));
    if (state.settings.dependencies) {
      const at = new Map(t.rows.map((r) => [r.id, r]));
      const defs = svgEl('defs');
      const marker = svgEl('marker', { id: 'tl-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
      marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: 'tl-arrow' }));
      defs.append(marker);
      lines.append(defs);
      for (const l of t.lines) {
        const a = at.get(l.from);
        const b = at.get(l.to);
        const x1 = a.kind === 'milestone' ? a.x + dayWidth / 2 : a.x + a.w;
        const y1 = a.row * rowH + rowH / 2;
        const x2 = b.kind === 'milestone' ? b.x + dayWidth / 2 - 7 : b.x;
        const y2 = b.row * rowH + rowH / 2;
        const bend = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 12));
        const late = x2 < x1; // it starts before what it waits on ends
        lines.append(svgEl('path', { d: `M${x1},${y1} H${bend} V${y2} H${x2}`, class: late ? 'tl-line clash' : 'tl-line', 'marker-end': 'url(#tl-arrow)' }));
      }
    }
    // what has no day
    const undated = t.undated.map(entry).filter(Boolean);
    hide($('tl-undated'), !undated.length);
    $('tl-undated-list').replaceChildren(...undated.map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-chip undated';
      if (e.done) b.classList.add('done');
      b.append(icon(KIND_ICON[e.kind]), document.createTextNode(e.title));
      b.setAttribute('aria-label', `${cap(kindWord(e.kind))}: ${e.title}, no date`);
      b.addEventListener('click', () => openEditor(e.id));
      return b;
    }));
    // bring today into sight once, the first time it is drawn
    if (!timelineScrolled && hasRows && t.today !== null) {
      timelineScrolled = true;
      requestAnimationFrame(() => { const f = $('tl-frame'); f.scrollLeft = Math.max(0, t.today - f.clientWidth / 3); });
    }
  }
  let timelineScrolled = false;

  // --- the entry, in the editor window ---------------------------------------------------------------------------------------
  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  const checked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);
  let ownersPick = null;
  const dates = { start: null, end: null };
  const formSnapshot = () => JSON.stringify([$('f-kind').value, $('f-title').value, $('f-start').value, $('f-end').value, ownersPick ? ownersPick.get() : [], $('f-parent').value, checked($('f-waits')), $('f-phase').value, checked($('f-tags')), $('f-done').checked, $('f-notes').value]);
  const formDirty = () => Boolean(state.editing && !state.editing.readOnly && state.editing.opened !== undefined && state.editing.opened !== formSnapshot());
  const editor = host.ui.editor($('editor'), {
    size: 'medium',
    isDirty: formDirty,
    onClose: () => {
      state.editing = null;
      for (const k of ['start', 'end']) if (dates[k]) { dates[k].destroy(); dates[k] = null; }
      if (ownersPick) { ownersPick.destroy(); ownersPick = null; }
    },
  });
  // Show the fields the chosen kind has.
  function fitKind() {
    const kind = $('f-kind').value;
    const ed = state.editing;
    hide($('f-dates'), kind === 'note');
    hide($('f-end-field'), kind !== 'work');
    $('f-start-label').textContent = kind === 'milestone' ? 'Day' : 'Starts';
    $('f-owners-label').textContent = cap(label('owner', { many: true }));
    hide($('f-owners-field'), kind !== 'work');
    hide($('f-waits-field'), kind === 'note' || !state.settings.dependencies || !$('f-waits').childNodes.length);
    hide($('f-done-field'), kind === 'note');
    const under = ed && ed.id ? list().filter((x) => x.kind === 'work' && x.parent === ed.id).length : 0;
    $('f-done-label').textContent = kind === 'milestone' && under ? 'Done, whatever is under it' : 'Done';
    $('f-start').required = Boolean(state.settings.datesRequired) && kind !== 'note';
    $('f-end').required = Boolean(state.settings.datesRequired) && kind === 'work';
  }
  $('f-kind').addEventListener('change', fitKind);
  // A start after the end moves the end with it, so a span is never backwards.
  $('f-start').addEventListener('change', () => { if ($('f-end').value && $('f-start').value && $('f-end').value < $('f-start').value) { $('f-end').value = $('f-start').value; if (dates.end) dates.end.refresh(); } });

  function choice(value, text, on) {
    const el = clone('tpl-check');
    el.querySelector('input').value = value;
    el.querySelector('input').checked = on;
    fill(el, { name: text });
    return el;
  }
  async function showLinks(id) {
    $('f-links-field').hidden = true;
    if (!id || !host.objects || !host.objects.linksTo) return;
    let summaries = [];
    try { summaries = await host.objects.linksTo(pointer(id)); } catch (err) { summaries = []; }
    if (!state.editing || state.editing.id !== id) return;
    const box = $('f-links');
    box.replaceChildren(...summaries.map((s) => {
      const b = document.createElement(s.open ? 'button' : 'span');
      b.className = 'link-chip';
      if (s.done) b.classList.add('done');
      if (s.open) { b.type = 'button'; b.addEventListener('click', () => host.objects.open(s.ref).catch((err) => editorError(err.message))); }
      const kind = document.createElement('b');
      kind.textContent = s.kindName || (s.module && s.module.name) || '';
      b.append(kind, document.createTextNode(` ${s.title || ''}`));
      return b;
    }));
    $('f-links-field').hidden = !summaries.length;
  }

  function openEditor(id, seed) {
    const found = id ? state.entries.get(id) : null;
    if (id && !found) return;
    if (!id && !canEdit) return;
    const s = seed || {};
    const shown = found ? found.e : scClean('new', { kind: s.kind || 'work', title: s.title || '', start: s.start || '', end: s.end || '', notes: s.notes || '', parent: s.parent || null, ref: s.ref || null });
    const readOnly = !canEdit;
    state.editing = { id: id || null, version: found ? found.version : undefined, readOnly, ref: shown.ref, by: shown.by, order: shown.order, parent: shown.parent };
    $('editor-title').textContent = id ? (readOnly ? shown.title : `Change this ${kindWord(shown.kind)}`) : cap(`Add ${kindWord(shown.kind, { a: true })}`);
    $('f-readonly').textContent = readOnly ? `You can look at the ${label('plan')} but not change it.` : '';
    hide($('f-readonly'), !readOnly);
    $('f-kind').replaceChildren(...SC_KINDS.map((k) => Object.assign(document.createElement('option'), { value: k, textContent: cap(kindWord(k)) })));
    $('f-kind').value = shown.kind;
    $('f-title').value = shown.title;
    $('f-start').value = shown.start;
    $('f-end').value = shown.end;
    // owners
    if (ownersPick) ownersPick.destroy();
    ownersPick = host.ui.peoplePicker($('f-owners'), { people: state.people, value: shown.owners, name: cap(label('owner', { many: true })) });
    // part of: the milestones (never itself, never something under it)
    const milestones = list().filter((x) => x.kind === 'milestone' && x.id !== id && !(id && x.parent === id));
    $('f-parent').replaceChildren(...[{ id: '', title: 'Nothing: at the top' }, ...milestones].map((x) => Object.assign(document.createElement('option'), { value: x.id, textContent: x.title })));
    $('f-parent').value = shown.parent && milestones.some((x) => x.id === shown.parent) ? shown.parent : '';
    hide($('f-parent-field'), !milestones.length && !shown.parent);
    $('f-parent-label').textContent = `Part of ${kindWord('milestone', { a: true })}`;
    // waits on: every milestone and work but itself and what already waits on it
    const others = scOrdered(list()).map((x) => x.entry).filter((x) => x.kind !== 'note' && x.id !== id && x.id !== shown.parent && (!id || !scMakesLoop(list(), id, x.id)));
    $('f-waits').replaceChildren(...others.map((x) => choice(x.id, `${x.title}${x.start ? ` (${span(x)})` : ''}`, shown.waitsOn.includes(x.id))));
    $('f-waits-note').textContent = 'It can start once these are done.';
    // phase
    const phases = state.phases;
    $('f-phase').replaceChildren(...[{ id: '', label: 'No phase' }, ...phases].map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
    $('f-phase').value = shown.phase && phases.some((p) => p.id === shown.phase) ? shown.phase : '';
    hide($('f-phase-field'), !phases.length);
    // tags
    $('f-tags-label').textContent = cap(label('tag', { many: true }));
    $('f-tags').replaceChildren(...state.settings.tags.map((t) => choice(t.id, t.label, shown.tags.includes(t.id))));
    hide($('f-tags-field'), !state.settings.tags.length);
    $('f-done').checked = shown.kind === 'milestone' ? shown.ticked : shown.done;
    $('f-notes').value = shown.notes;
    $('f-by').textContent = shown.by ? `Added by ${nameOf(shown.by) || 'someone'}` : '';
    editorError('');
    for (const el of $('form').querySelectorAll('input, select, textarea')) el.disabled = readOnly;
    hide($('f-save'), readOnly);
    hide($('f-cancel'), readOnly);
    hide($('f-delete'), readOnly || !id);
    hide($('f-actions'), readOnly);
    $('f-delete').textContent = 'Delete';
    state.editing.armed = false;
    fitKind();
    dates.start = host.ui.datePicker($('f-start'), { clearable: true });
    dates.end = host.ui.datePicker($('f-end'), { clearable: true });
    state.editing.opened = formSnapshot();
    editor.open({ focus: readOnly ? editor.element : $('f-title') });
    dates.start.refresh();
    dates.end.refresh();
    showLinks(id);
  }
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ed = state.editing;
    if (!ed || ed.readOnly) return;
    const kind = $('f-kind').value;
    const parent = $('f-parent').value || null;
    const moved = (parent || null) !== (ed.parent || null);
    const draft = scClean(ed.id || host.util.id(), {
      kind,
      title: $('f-title').value,
      start: $('f-start').value,
      end: $('f-end').value,
      owners: ownersPick ? ownersPick.get() : [],
      waitsOn: checked($('f-waits')),
      ticked: kind === 'milestone' && $('f-done').checked,
      done: kind === 'work' ? $('f-done').checked : kind === 'milestone' ? (ed.id ? (entry(ed.id) || {}).done : false) : undefined,
      progress: ed.id ? (entry(ed.id) || {}).progress : null,
      phase: $('f-phase').value,
      tags: checked($('f-tags')),
      notes: $('f-notes').value,
      parent,
      order: ed.order && !moved ? ed.order : orderAtEnd(parent),
      by: ed.by || info.user.key,
      ref: ed.ref,
    });
    // what the person typed, checked before it is cleaned away
    if ($('f-start').value && !scIsDay($('f-start').value)) { editorError('The start is a day, such as 2026-10-14.'); return; }
    if (kind === 'work' && $('f-end').value && !scIsDay($('f-end').value)) { editorError('The end is a day, such as 2026-10-14.'); return; }
    if (kind === 'work' && $('f-start').value && $('f-end').value && $('f-end').value < $('f-start').value) { editorError('The end is before the start.'); return; }
    const problem = scProblem(draft, { datesRequired: state.settings.datesRequired, label: (k) => kindWord(k) });
    if (problem) { editorError(problem); (draft.title ? $('f-start') : $('f-title')).focus(); return; }
    $('f-save').disabled = true;
    try {
      await saveEntry(draft, ed.version);
      editor.close();
    } catch (err) {
      if (err && err.status === 409) {
        if (err.current && state.editing) state.editing.version = err.current.version;
        editorError('Someone else changed this while you had it open. Save again to keep your changes.');
      } else editorError(err && err.message ? err.message : 'It could not be saved.');
    } finally {
      $('f-save').disabled = false;
    }
  });
  $('f-delete').addEventListener('click', async () => {
    const ed = state.editing;
    if (!ed || !ed.id || ed.readOnly) return;
    if (!ed.armed) { ed.armed = true; $('f-delete').textContent = 'Really delete?'; return; }
    try {
      await removeEntry(ed.id);
      editor.close();
    } catch (err) {
      editorError(err && err.message ? err.message : 'It could not be deleted.');
    }
  });

  // --- what other modules may ask of this one ----------------------------------------------------------------------------------
  // An add per kind. When the plan needs dates and none came, the editor opens with what came, to be finished there.
  const REFUSED = `you may not add to the ${label('plan')} here`;
  async function addFrom(kind, input, ctx) {
    if (!canEdit) throw new Error(REFUSED);
    const e = scFromAction(kind, input, (ctx && ctx.by) || info.user.key);
    if (!e.title) throw new Error(`the ${kindWord(kind)} needs a title`);
    if (scProblem(e, { datesRequired: state.settings.datesRequired, label: (k) => kindWord(k) })) {
      openEditor(null, { kind, title: e.title, start: e.start, end: e.end, notes: e.notes, ref: e.ref });
      return {};
    }
    const saved = await saveEntry({ ...e, id: host.util.id(), order: orderAtEnd(null) });
    return { ref: pointer(saved.id) };
  }
  if (host.actions && host.actions.provide) {
    host.actions.provide({
      addMilestone: (input, ctx) => addFrom('milestone', input, ctx),
      addWork: (input, ctx) => addFrom('work', input, ctx),
      addNote: (input, ctx) => addFrom('note', input, ctx),
    });
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'plan') return;
      const show = () => openEditor(ref.id);
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- settings, phases ---------------------------------------------------------------------------------------------------------
  function takeSettings(v) {
    const s = v && typeof v === 'object' ? v : {};
    state.settings = {
      datesRequired: s.datesRequired !== false,
      dependencies: s.dependencies !== false,
      progressBy: s.progressBy === 'work' ? 'work' : 'milestones',
      defaultView: s.defaultView === 'list' ? 'list' : 'timeline',
      tags: (Array.isArray(s.tags) ? s.tags : []).filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string'),
    };
  }
  const takePhases = () => { try { state.phases = (host.phases() || []).filter((p) => p && typeof p.id === 'string'); } catch (err) { state.phases = []; } };
  host.on('phaseStates', () => { takePhases(); redraw(); });

  // --- start -----------------------------------------------------------------------------------------------------------------
  const fit = () => {
    const w = host.rootElement.clientWidth;
    if (!w) return;
    const next = w < 520;
    if (next === narrow) return;
    narrow = next;
    $('app').classList.toggle('narrow', narrow);
    if (state.loaded && state.view === 'timeline') render();
  };
  fit();
  new ResizeObserver(fit).observe(host.rootElement);
  viewSwitch = host.ui.viewSwitch({ id: 'view', label: 'View', options: VIEW_OPTIONS(), value: 'timeline', onChange: showView });
  let wired = false;
  async function load() {
    $('msg').hidden = true;
    $('loading').hidden = true;
    $('app').hidden = false;
    try {
      const [people, settings] = await Promise.all([
        host.people().catch(() => []),
        host.settings.get().catch(() => null),
        loadEntries(),
      ]);
      state.people = people;
      takeSettings(settings);
      takePhases();
      // The view: the person's own choice, else the List on a phone, else the plan's default.
      let mine = '';
      try { mine = localStorage.getItem(VIEW_KEY) || ''; } catch (err) { /* none */ }
      state.view = mine === 'list' || mine === 'timeline' ? mine : narrow ? 'list' : state.settings.defaultView;
      await Promise.all([...new Set(['plus', 'pen', 'trash', 'rotate-left', 'circle-check', 'link', 'flag', 'bars-progress', 'note-sticky', 'diagram-project', 'chart-gantt', 'list', ...state.settings.tags.map((t) => t.icon).filter(Boolean)])].map(wantIcon));
      state.loaded = true;
      render();
      loadLinks().catch(() => {});
      if (!wired) {
        wired = true;
        host.settings.onChange((v) => { takeSettings(v); if (state.loaded) render(); });
      }
      if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
    } catch (err) {
      $('app').hidden = true;
      showMsg(`The ${label('plan')} could not load`, err.message, load);
    }
  }
  await load();
})();
