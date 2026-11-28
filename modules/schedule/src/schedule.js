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
  // While a pull is on, work that came from it is the service's (plan-github-pull.md): read-only here, and nobody adds by hand.
  const pullOn = () => Boolean(state.pull.on);
  // In a space where changes go back to GitHub (the owner's switch), someone allowed to (write_out) can move, tick, rename and
  // tag the issues that were pulled; the rest of them (the body, comments, who it is for, deleting) stays GitHub's.
  const writeOn = () => Boolean(state.pull.on && state.pull.write);
  const through = () => canEdit && writeOn() && host.can('write_out');
  const isIssue = (e) => Boolean(e && e.kind === 'work' && e.source && e.source.number);
  const pulled = (e) => Boolean(e && e.source && pullOn());
  const locked = (e) => pulled(e) && !(through() && isIssue(e));
  const canAdd = () => canEdit && !pullOn();
  // Pulled work has one day while a space only follows the service, so it is never "late". Where changes go back the days are the space's
  // own, but the pull starts and ends an issue on the day it was opened: Late shows only once the end is after the start, which is
  // a target someone set (the roadmap import, the editor, an agent). A one-day target is not marked.
  const pageLate = (e) => !(e.source && (!writeOn() || !(e.end > e.start))) && scLate(e, today());
  const canChange = (e) => canEdit && !locked(e);
  // The fields are the space's own and never go to the service, so someone who may edit sets them on pulled issues too while changes go
  // back (the server takes a change of the space's own fields without the right to change GitHub). Defining one needs `columns`.
  const canSetFields = (e) => canEdit && (!pulled(e) || (writeOn() && isIssue(e)));
  const canFields = () => host.can('columns');
  const sayLocked = () => say(SC_PULLED_SAY, 'danger');
  const label = (key, o) => host.util.label(key, o);
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const KIND_ICON = { milestone: 'flag', work: 'bars-progress', note: 'note-sticky' };

  // --- state ---------------------------------------------------------------------------------------------------------
  const state = {
    entries: new Map(), // id -> { e, version }
    boardRaw: null, // the stored `board:main` (null: the template's default columns), and its version
    boardVersion: undefined,
    fields: [], // the plan's fields (scFieldsFrom), in order
    fieldRows: new Map(), // key -> { value, version }: what is stored under `field:`
    people: [],
    settings: { datesRequired: true, dependencies: true, progressBy: 'milestones', defaultView: 'timeline', boardColumns: 'stages', sizing: 'off', tags: [] },
    phases: [],
    links: new Map(), // id -> [summary] (what links to each entry: To-do's tasks and the rest)
    view: '',
    filter: scFilterEmpty(), // this person's Board filters (kept in this browser)
    rows: '', // where changes can't be stored in the board (a followed plan), this person's own rows for the Board (kept in this browser)
    loaded: false,
    pull: { on: false, name: 'GitHub', last: '', next: '', error: '', write: false }, // the space's issue pull (host.issues.status)
    sent: '', // the last refused change to GitHub, as the server said it (shown in the status line for a while)
    canFollow: false, // an owner may set the pull up (host.setup.can): the empty plan offers the way
    editing: null,
    openWanted: null,
  };
  const list = () => [...state.entries.values()].map((x) => x.e);
  const entry = (id) => (state.entries.get(id) || {}).e || null;
  const nameOf = (key) => (state.people.find((p) => p.key === key) || {}).name || '';
  const today = () => host.util.ymd(new Date());
  const tagOf = (id) => state.settings.tags.find((t) => t.id === id) || null;
  const phaseOf = (id) => state.phases.find((p) => p.id === id) || null;
  const fieldOf = (id) => state.fields.find((f) => f.id === id) || null;
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
  const say = (text, kind) => { if (text && host.ui && host.ui.toast) host.ui.toast(String(text), kind ? { kind } : undefined).catch(() => {}); };
  const dayDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); };
  const thisYear = new Date().getFullYear();
  const dayShort = (d) => { const x = dayDate(d); return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(x.getFullYear() !== thisYear ? { year: 'numeric' } : {}) }); };
  const span = (e) => (e.kind === 'work' && e.end && e.end !== e.start ? `${dayShort(e.start)} to ${dayShort(e.end)}` : e.start ? dayShort(e.start) : '');

  // --- the store -----------------------------------------------------------------------------------------------------
  const remember = (id, value, version) => {
    if (!value || typeof value !== 'object') { state.entries.delete(id); return; }
    const e = scClean(id, value);
    if (!e.title) e.title = 'Untitled'; // stored without a title (written some other way): never an empty row or chip
    state.entries.set(id, { e, version });
  };
  async function loadEntries() {
    state.entries.clear();
    state.boardRaw = null;
    state.boardVersion = undefined;
    state.fieldRows.clear();
    const [rows, boards, fields] = await Promise.all([host.storage.list(SC_PREFIX), host.storage.list(SC_BOARD_PREFIX), host.storage.list(SC_FIELD_PREFIX)]);
    for (const it of rows) remember(it.key.slice(SC_PREFIX.length), it.value, it.version);
    for (const it of boards) takeBoard(it.key, it.value, it.version, false);
    for (const it of fields) takeField(it.key, it.value, it.version, false);
  }
  const BOARD_KEY = `${SC_BOARD_PREFIX}main`;
  // The board the space has: the stored one when it reads, else the template's default columns in the template's words (the
  // same answer the server's setColumn reads, scBoardOf).
  const currentBoard = () => scBoardFrom(state.boardRaw, state.settings.boardColumns, (k) => label(k));
  function takeBoard(key, value, version, deleted) {
    if (key !== BOARD_KEY) return false;
    state.boardRaw = deleted ? null : value;
    state.boardVersion = deleted ? undefined : version;
    return true;
  }
  // A `field:<id>` record, as stored; false when the key is not one.
  function takeField(key, value, version, deleted) {
    if (!String(key).startsWith(SC_FIELD_PREFIX)) return false;
    if (deleted) state.fieldRows.delete(key); else state.fieldRows.set(key, { value, version });
    state.fields = scFieldsWithSize(scFieldsFrom([...state.fieldRows].map(([k, x]) => ({ key: k, value: x.value }))), state.settings.sizing);
    return true;
  }
  let drawSoon = 0;
  const redraw = () => { if (!state.loaded || drawSoon) return; drawSoon = requestAnimationFrame(() => { drawSoon = 0; render(); }); };
  host.on('change', (e) => {
    if (e.scope !== 'spaces' && e.scope !== 'person' && e.scope !== 'environment' && (takeBoard(String(e.key), e.value, e.version, e.deleted) || takeField(String(e.key), e.value, e.version, e.deleted))) { redraw(); return; }
    if (!String(e.key).startsWith(SC_PREFIX) || e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    remember(String(e.key).slice(SC_PREFIX.length), e.deleted ? null : e.value, e.version);
    redraw();
  });
  host.on('changes', (e) => {
    if (e.scope === 'spaces' || e.scope === 'person' || e.scope === 'environment') return;
    const all = Array.isArray(e.changes) ? e.changes : [];
    const boardChange = all.find((c) => String(c.key) === BOARD_KEY);
    if (boardChange) { if (!boardChange.deleted && boardChange.value === undefined) { if (state.loaded) loadEntries().then(render).catch(() => {}); return; } takeBoard(BOARD_KEY, boardChange.value, boardChange.version, boardChange.deleted); }
    const fieldChanges = all.filter((c) => String(c.key).startsWith(SC_FIELD_PREFIX));
    if (fieldChanges.some((c) => !c.deleted && c.value === undefined)) { if (state.loaded) loadEntries().then(render).catch(() => {}); return; }
    for (const c of fieldChanges) takeField(String(c.key), c.value, c.version, c.deleted);
    const changes = all.filter((c) => String(c.key).startsWith(SC_PREFIX));
    if (!changes.length) { if (boardChange || fieldChanges.length) redraw(); return; }
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
    if (!canEdit || pullOn()) return; // pulled milestones are GitHub's: the pull settles them
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
    return scOrderAtEnd(list(), parent, (x, y) => host.util.order(x, y));
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
    { id: 'board', label: 'Board', icon: 'table-columns' },
  ];
  let viewSwitch = null;
  const VIEW_KEY = `schedule-view:${info.context.spaceId || ''}`;
  function showView(next) {
    state.view = next === 'list' || next === 'board' ? next : 'timeline';
    try { localStorage.setItem(VIEW_KEY, state.view); } catch (err) { /* not remembered */ }
    host.menu.close();
    render();
  }
  const ADDS = () => (canAdd() ? SC_KINDS.map((k) => ({ id: k, label: cap(`Add ${kindWord(k, { a: true })}`), icon: KIND_ICON[k] })) : []);
  function chrome() {
    host.add.set(ADDS()).catch(() => {});
    const onBoard = state.view === 'board' && state.entries.size > 0;
    host.toolbar.set([
      ...(pullOn() && canEdit ? [{ type: 'button', id: 'plan-pull', icon: 'rotate', label: pulling ? 'Pulling' : 'Pull now', zone: 'end' }] : []),
      { type: 'button', id: 'plan-more', icon: 'right-left', label: 'Export and import', zone: 'end' },
      ...(onBoard ? filterItems() : []),
    ]).catch(() => {});
    const p = scProgress(list(), state.settings.progressBy);
    const what = state.settings.progressBy === 'work' ? kindWord('work', { many: true }) : kindWord('milestone', { many: true });
    const status = p.total ? [{ text: `${p.done} of ${p.total} ${what} done`, icon: 'diagram-project' }] : [];
    const v = onBoard ? boardWork() : null;
    if (v && v.on) status.push({ text: `Showing ${v.shown.length} of ${v.works.length} ${kindWord('work', { many: v.works.length !== 1 })}`, icon: 'filter' });
    // A status item holds 60 characters: the line that says changes go back is its own item; a refusal shows as a short item with the sentence as its hover text.
    if (writeOn()) status.unshift({ text: `Changes go to ${state.pull.name || 'GitHub'}`, icon: 'arrow-up-right-from-square' });
    if (pullOn()) status.unshift(pullStatus());
    if (state.sent) status.unshift({ text: `Not changed on ${state.pull.name || 'GitHub'}`, title: state.sent, icon: 'triangle-exclamation' });
    host.status.set(status).catch(() => {});
  }
  // --- the pull from GitHub (host.issues): the status line, Pull now, and keeping the page in step with a pull ---------------------
  let pulling = false;
  function ago(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    const m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
    return `${Math.round(h / 24)} days ago`;
  }
  function pullStatus() {
    const p = state.pull;
    const name = p.name || 'GitHub';
    if (p.error) {
      const at = Date.parse(p.next);
      const when = Number.isFinite(at) ? ` Trying again at ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.` : '';
      return { text: `${p.error}${when}`, icon: 'triangle-exclamation' };
    }
    const c = p.counts && p.counts.total ? `, ${p.counts.open} open of ${p.counts.total}` : '';
    return { text: p.last ? `From ${name}, pulled ${ago(p.last)}${c}` : `From ${name}, not pulled yet`, icon: 'rotate' };
  }
  // Takes a status from the server. A change of whether the pull is on redraws the controls that depend on it.
  function takePull(v) {
    const was = pullOn();
    const had = state.pull.last;
    const wrote = writeOn();
    state.pull = v && typeof v === 'object' ? { on: Boolean(v.on), name: v.name || 'GitHub', last: v.last || '', next: v.next || '', error: v.error || '', counts: v.counts || null, write: Boolean(v.on && v.write) } : { on: false, name: 'GitHub', last: '', next: '', error: '', write: false };
    if (was !== pullOn() || wrote !== writeOn()) {
      if (outline) { outline.destroy(); outline = null; $('outline').replaceChildren(); }
      if (board) { board.destroy(); board = null; $('board').replaceChildren(); }
    }
    return was !== pullOn() || wrote !== writeOn() || had !== state.pull.last;
  }
  async function refreshPull(reload) {
    if (!host.issues || !host.issues.status) return;
    let v;
    try { v = await host.issues.status(); } catch (err) { return; }
    const changed = takePull(v);
    if (changed && state.loaded) { if (reload) { try { await loadEntries(); } catch (err) { /* kept as it was */ } } render(); } else if (state.loaded) chrome();
  }
  async function pullNow() {
    if (pulling || !canEdit || !pullOn() || !host.issues) return;
    pulling = true;
    chrome();
    try {
      takePull(await host.issues.pullNow());
      await loadEntries();
    } catch (err) {
      say(err && err.message ? err.message : 'It could not be pulled.', 'danger');
      await refreshPull(false);
    } finally { pulling = false; render(); }
  }
  // The number and the link a pulled entry carries: "#12" and "Open on GitHub" (a new tab, no referrer).
  const sourceNumber = (e) => (e.source && e.source.number ? `#${e.source.number}` : '');
  function sourceLink(e) {
    if (!e.source || !e.source.url) return null;
    const a = document.createElement('a');
    a.className = 'src-link';
    a.href = e.source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.referrerPolicy = 'no-referrer';
    a.setAttribute('aria-label', `Open ${sourceNumber(e) || 'it'} on ${e.source.from === 'github' ? 'GitHub' : state.pull.name}`);
    a.dataset.tip = `Open on ${e.source.from === 'github' ? 'GitHub' : state.pull.name}`;
    a.append(icon('arrow-up-right-from-square'));
    a.addEventListener('click', (ev) => ev.stopPropagation());
    return a;
  }
  const sourceMenu = (e) => (e.source && e.source.url ? [{ id: 'github', label: `Open on ${e.source.from === 'github' ? 'GitHub' : state.pull.name}`, icon: 'arrow-up-right-from-square', href: e.source.url }] : []);
  host.on('add', (e) => { if (canAdd() && SC_KINDS.includes(e.id)) openEditor(null, { kind: e.id }); });

  // --- render ----------------------------------------------------------------------------------------------------------
  function render() {
    if (!state.loaded) return;
    viewSwitch.set(state.view, VIEW_OPTIONS());
    const empty = state.entries.size === 0;
    hide($('body'), empty); // the empty notice sits at the top, with no empty block above it
    hide($('view-timeline'), empty || state.view !== 'timeline');
    hide($('view-list'), empty || state.view !== 'list');
    hide($('view-board'), empty || state.view !== 'board');
    if (empty) renderEmpty(); else { $('msg').hidden = true; if (state.view === 'timeline') renderTimeline(); else if (state.view === 'board') renderBoard(); else renderList(); }
    hydrate(root);
    chrome();
  }
  function renderEmpty() {
    const el = clone('tpl-state');
    fill(el, { title: `No ${label('plan')} yet`, text: pullOn() ? `Nothing has been pulled from ${state.pull.name} yet.` : canEdit ? `Add ${kindWord('milestone', { a: true })} or ${kindWord('work', { a: true })} to start the ${label('plan')}. Each can have dates, ${label('owner', { many: true })} and what it waits on.` : `Nothing is on the ${label('plan')} yet.` });
    const actions = slot(el, 'actions-wrap');
    if (canAdd()) {
      const b = document.createElement('button'); // one clear action; the + in the bar adds the other kinds
      b.type = 'button';
      b.className = 'btn btn-primary';
      b.append(icon('plus'), ' ', cap(`Add ${kindWord('milestone', { a: true })}`));
      b.addEventListener('click', () => openEditor(null, { kind: 'milestone' }));
      actions.append(b);
    }
    if (!pullOn() && state.canFollow && host.setup && host.setup.open) { // an owner: the way to the setting, in Set up (not a dialog of ours)
      const f = document.createElement('button');
      f.type = 'button';
      f.className = canAdd() ? 'btn' : 'btn btn-primary';
      f.append(icon('link'), ' Follow a GitHub repository');
      f.addEventListener('click', () => { host.setup.open('modules').catch((err) => say(err && err.message ? err.message : 'Set up could not be opened.', 'danger')); });
      actions.append(f);
    }
    if (!actions.childNodes.length) actions.hidden = true;
    $('msg').replaceChildren(...el.childNodes);
    delete $('msg').dataset.kind;
    $('msg').hidden = false;
  }

  // The name of the board column work is in, when it is not the board's first column (so the List and the Timeline agree with the Board).
  function columnName(e) {
    if (e.kind !== 'work') return '';
    const b = currentBoard();
    const at = scColumnOf(e, b);
    return at && b.columns[0] && at.id !== b.columns[0].id ? at.label : '';
  }
  // The words under an entry's title: its dates, owners, phase and what it waits on.
  function subWords(e) {
    const parts = [];
    const when = span(e);
    if (when) parts.push(when);
    else if (e.kind !== 'note') parts.push('No date');
    const col = columnName(e);
    if (col) parts.push(col);
    if (e.owners.length) parts.push(e.owners.map((k) => nameOf(k) || 'Someone who left').join(', '));
    const ph = e.phase && phaseOf(e.phase);
    if (ph) parts.push(ph.label);
    if (narrow) for (const w of scFieldWords(e, state.fields)) parts.push(w.label); // the List's field columns are for a wide window
    if (state.settings.dependencies && e.waitsOn.length) {
      const names = e.waitsOn.map(entry).filter(Boolean).map((w) => w.title);
      if (names.length) parts.push(`Waits on ${names.join(', ')}`);
    }
    if (pageLate(e)) parts.push('Late');
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
  // The List's columns for the fields: one cell for each field, empty when the work has no choice (so the columns line up).
  function fieldCells(e, into) {
    into.replaceChildren();
    into.hidden = !state.fields.length;
    if (!state.fields.length) return;
    for (const f of state.fields) {
      const c = document.createElement('span');
      c.className = 'fcell';
      const w = e.kind === 'work' ? scFieldWords(e, [f])[0] : null;
      if (w) {
        c.textContent = w.label;
        c.dataset.tip = f.label;
        c.setAttribute('aria-label', `${f.label}: ${w.label}`);
      } else c.setAttribute('aria-hidden', 'true');
      into.append(c);
    }
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
      canEdit: canAdd(),
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
    if (pageLate(e)) el.classList.add('late');
    const tick = el.querySelector('[data-action="tick"]');
    if (e.kind !== 'note' && canChange(e)) {
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
    if (e.source) {
      const num = sourceNumber(e);
      const titleEl = slot(el, 'title');
      if (num) { const n = document.createElement('span'); n.className = 'src-num'; n.textContent = num; titleEl.before(n); }
      const link = sourceLink(e);
      if (link) slot(el, 'linked-wrap').after(link);
    }
    el.querySelector('[data-action="open"]').setAttribute('aria-label', `${cap(kindWord(e.kind))}: ${e.title}`);
    el.querySelector('[data-action="open"]').addEventListener('click', () => openEditor(e.id));
    tagChips(e, slot(el, 'chips-wrap'));
    linkChips(e, slot(el, 'linked-wrap'), 3);
    fieldCells(e, slot(el, 'fields-wrap'));
    const rollWrap = slot(el, 'roll-wrap');
    if (e.kind === 'milestone' && r && r.total) host.ui.progress(rollWrap, { done: r.done, total: r.total, label: `${e.title}: progress` });
    else rollWrap.hidden = true;
    content.append(el);
    hydrate(el);
  }
  const editItem = (id) => ({ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(id) });
  function rowMenu(e) {
    if (locked(e)) return [...(canSetFields(e) && state.fields.length ? [editItem(e.id)] : []), ...sourceMenu(e)];
    if (pulled(e)) return [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(e.id) }, closeItem(e), ...sourceMenu(e)];
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
    if (pulled(e)) { say(SC_NO_DELETE_SAY, 'danger'); return; }
    let ok = true;
    if (host.ui.confirm) {
      try { ok = await host.ui.confirm({ title: `Delete "${e.title}"?`, message: `It comes off the ${label('plan')} for everyone.`, action: 'Delete', kind: 'destructive' }); } catch (err) { ok = false; }
    }
    if (!ok) return;
    try { await removeEntry(id); } catch (err) { say(err && err.message ? err.message : 'It could not be deleted.'); }
  }
  // --- changes to pulled work: sent to GitHub first -----------------------------------------------------------------------------
  // The server sends the change to GitHub and stores what GitHub answers. Nothing here changes unless GitHub took it: a refusal
  // leaves the card where it was and says why in one line (the server's own sentence, also in the status line for a while).
  // A conflict (409) brings GitHub's version, which is drawn instead. Changes go one at a time, each from the work as stored then.
  let sentTimer = 0;
  let lane = Promise.resolve();
  function sayWhy(text) {
    state.sent = text;
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => { state.sent = ''; chrome(); }, 12000);
    say(text, 'danger');
  }
  // `make(entry)` gives the entry as it should be (or null for nothing to send). Resolves { ok, error }. `quiet` skips the redraw after a
  // write that went through, for a write that is one of several (the caller draws once at the end); a refusal is always drawn.
  function sendPulled(id, make, quiet) {
    const run = async () => {
      const had = state.entries.get(id);
      if (!had) return { ok: false, error: 'That is not on the plan any more.' };
      const next = make(had.e);
      if (!next) return { ok: true, error: '' };
      try {
        const saved = await host.storage.set(SC_PREFIX + id, scValue(next), { version: had.version });
        if (saved && saved.value) remember(id, saved.value, saved.version);
        if (state.sent) { state.sent = ''; clearTimeout(sentTimer); }
        if (!quiet) render();
        return { ok: true, error: '' };
      } catch (err) {
        if (err && err.current && err.current.value) remember(id, err.current.value, err.current.version);
        const error = (err && err.message) || `${state.pull.name} did not answer. Nothing was changed; try again.`;
        sayWhy(error);
        render();
        return { ok: false, error };
      }
    };
    const out = lane.then(run, run);
    lane = out.catch(() => {});
    return out;
  }
  // A new issue in a column: the title is asked for, GitHub makes it, and it is drawn as GitHub answered.
  async function newIssue(columnId) {
    if (!through() || !host.issues || !host.issues.create) return;
    const text = await host.ui.prompt({ title: `Add an issue to ${state.pull.name}`, label: 'Title', placeholder: 'Area: what is wrong', action: 'Add', maxLength: SC_TITLE_MAX, validate: (v) => (scLine(v, 10000) ? '' : 'Give it a title.') });
    if (text === null || !scLine(text, 10000)) return;
    try {
      const made = await host.issues.create({ title: scLine(text, SC_TITLE_MAX), column: columnId });
      if (made && made.key && made.value) remember(String(made.key).slice(SC_PREFIX.length), made.value, made.version);
      render();
    } catch (err) { sayWhy((err && err.message) || `${state.pull.name} did not answer. Nothing was changed; try again.`); }
  }
  // Close, for pulled work: the issue is closed on GitHub (it moves to the done column); Reopen is the tick taken off.
  const closeItem = (e) => ({ id: 'done', label: e.done ? 'Reopen' : 'Close', icon: e.done ? 'rotate-left' : 'circle-check', onClick: () => toggleDone(e.id) });

  async function toggleDone(id) {
    const had = state.entries.get(id);
    if (had && pulled(had.e) && through() && isIssue(had.e)) {
      await sendPulled(id, (e) => { const r = scSetDone(e, !e.done, { label: (k) => kindWord(k), board: currentBoard(), today: today() }); return r.entry; });
      return;
    }
    if (!had || !canChange(had.e) || had.e.kind === 'note') return;
    // The tick is the rule's (scSetDone): a milestone's `ticked`, and work moving to the board's done or open column with it.
    const r = scSetDone(had.e, !had.e.done, { label: (k) => kindWord(k), board: currentBoard(), today: today() });
    if (r.problem) { say(r.problem); return; }
    try { await saveEntry(r.entry, had.version); } catch (err) { say(err && err.status === 409 ? 'Someone else changed it just now. Try again.' : (err && err.message) || 'It could not be saved.'); }
  }
  async function moveEntry(m) {
    const had = state.entries.get(m.id);
    if (!had || !canChange(had.e)) return;
    try { await saveEntry({ ...had.e, parent: m.parent || null, order: m.order }, had.version); } catch (err) { say(err && err.status === 409 ? 'Someone else changed it just now. Try again.' : (err && err.message) || 'It could not be moved.'); render(); }
  }

  // --- the Board ----------------------------------------------------------------------------------------------------------------
  // The work as cards in the board's columns (host.ui.board; plan-projects-kanban.md). A card is work only. Inside a column the
  // order is the work's `rank`, else the end day (none last), then the place in the outline (scCardOrder, schedule-lib.js, where how
  // ranks are made and kept is written). A move, with where it landed (`before`), runs the setColumn handler of the actions library
  // in the page (carried below), the same one the server runs for an agent, so both give the same writes and refusals. On the phone's
  // stacked layout a card moves by its menu (Move up, Move down, Move to top, Move to bottom) and the keys, as on a wide one.
  let board = null;
  let boardOpts = null;
  let boardRowsBy = '';
  let boardAsk = 0;
  const BOARD_FOLD_KEY = `schedule-board-folds:${info.context.spaceId || ''}`;
  // --- the filters: this person's own view of the Board, kept in this browser (schedule-filter:<space>) ---
  const FILTER_KEY = `schedule-filter:${info.context.spaceId || ''}`;
  function loadFilter() {
    try { state.filter = scFilterClean(JSON.parse(localStorage.getItem(FILTER_KEY) || 'null'), null); } catch (err) { state.filter = scFilterEmpty(); }
  }
  function keepFilter() { try { localStorage.setItem(FILTER_KEY, JSON.stringify(state.filter)); } catch (err) { /* not kept */ } }
  // The kept filter with what is gone dropped (a person who has no work now, a removed tag, phase or milestone).
  function currentFilter() {
    const work = list().filter((e) => e.kind === 'work');
    return scFilterClean(state.filter, {
      who: new Set(work.flatMap((e) => e.owners)),
      tags: new Set(state.settings.tags.map((t) => t.id)),
      phases: new Set(state.phases.map((p) => p.id)),
      milestones: new Set(list().filter((e) => e.kind === 'milestone').map((e) => e.id)),
      fields: new Map(state.fields.map((f) => [f.id, new Set(f.options.map((o) => o.id))])),
    });
  }
  // All the work, the work that passes the filter, and whether a filter is on.
  function boardWork() {
    const f = currentFilter();
    const byId = new Map(list().map((e) => [e.id, e]));
    const works = list().filter((e) => e.kind === 'work');
    return { f, byId, works, shown: works.filter((e) => scFilterMatch(e, f, byId)), on: scFilterOn(f) };
  }
  function filterItems() {
    const { f, byId, works } = boardWork();
    const count = (fn) => works.filter(fn).length;
    const items = [];
    const keys = [...new Set(works.flatMap((e) => e.owners))];
    const people = keys.map((k) => ({ k, name: nameOf(k) || 'Someone who left' })).sort((x, y) => x.name.localeCompare(y.name));
    if (works.length) {
      items.push({ type: 'chips', id: 'f-who', label: 'Who', options: [
        ...people.map((p) => ({ id: p.k, label: p.name, count: count((e) => e.owners.includes(p.k)), on: f.who.includes(p.k), default: false })),
        { id: SC_NONE, label: 'No one', count: count((e) => !e.owners.length), on: f.who.includes(SC_NONE), default: false },
      ] });
    }
    // The plan's own tags (its `tags` setting), not the host's tag list: the ids here are the plan's.
    const tags = state.settings.tags;
    if (tags.length) {
      items.push({ type: 'chips', id: 'f-tags', label: cap(label('tag', { many: true })), options: tags.map((t) => ({ id: t.id, label: t.label, count: count((e) => e.tags.includes(t.id)), on: f.tags.includes(t.id), default: false, ...(/^#[0-9a-f]{6}$/.test(t.color || '') ? { tint: t.color } : {}) })) });
    }
    if (state.phases.length) {
      items.push({ type: 'chips', id: 'f-phase', label: 'Phase', single: true, value: f.phase || 'all', options: [
        { id: 'all', label: 'Every phase', count: works.length },
        ...state.phases.map((p) => ({ id: p.id, label: p.label, count: count((e) => e.phase === p.id) })),
        { id: SC_NONE, label: 'No phase', count: count((e) => !e.phase) },
      ] });
    }
    const milestones = scOrdered(list()).map((x) => x.entry).filter((e) => e.kind === 'milestone');
    if (milestones.length) {
      items.push({ type: 'chips', id: 'f-milestone', label: cap(kindWord('milestone')), single: true, value: f.milestone || 'all', options: [
        { id: 'all', label: `Every ${kindWord('milestone')}`, count: works.length },
        ...milestones.map((m) => ({ id: m.id, label: m.title, count: count((e) => scMilestoneOf(e, byId) === m.id) })),
        { id: SC_NONE, label: `No ${kindWord('milestone')}`, count: count((e) => !scMilestoneOf(e, byId)) },
      ] });
    }
    // One choice list for each field of the plan (the person's own view, like the rest).
    state.fields.forEach((fd, i) => {
      items.push({ type: 'chips', id: `f-field-${i}`, label: fd.label, single: true, value: f.fields[fd.id] || 'all', options: [
        { id: 'all', label: `Every ${fd.label.toLowerCase()}`, count: works.length },
        ...fd.options.map((o) => ({ id: o.id, label: o.label, count: count((e) => (e.fields || {})[fd.id] === o.id) })),
        { id: SC_NONE, label: `No ${fd.label.toLowerCase()}`, count: count((e) => !(e.fields || {})[fd.id]) },
      ] });
    });
    return items;
  }
  function takeFilter(e) {
    const f = currentFilter();
    const id = String(e.id);
    const value = String(e.value == null ? '' : e.value);
    const flip = (arr) => (e.on ? [...new Set([...arr, value])] : arr.filter((x) => x !== value));
    if (id === 'f-who') f.who = flip(f.who);
    else if (id === 'f-tags') f.tags = flip(f.tags);
    else if (id === 'f-phase') f.phase = value === 'all' ? '' : value;
    else if (id === 'f-milestone') f.milestone = value === 'all' ? '' : value;
    else if (/^f-field-\d+$/.test(id) && state.fields[Number(id.slice(8))]) {
      const fid = state.fields[Number(id.slice(8))].id;
      const next = { ...f.fields };
      if (value === 'all') delete next[fid]; else next[fid] = value;
      f.fields = next;
    } else return false;
    state.filter = f;
    keepFilter();
    redraw();
    return true;
  }
  function boardCards(b, shown, rowOf) {
    // `rev` is what the card says inside (what drawCard writes, read before it is on the page), so the Board draws again only a card
    // whose words changed; what a card shows comes from other entries, people, tags and settings too, not from these fields alone.
    return shown.slice().sort(scCardOrder(list())).map((e) => {
      const card = { id: e.id, column: scColumnOf(e, b).id, title: e.title, row: rowOf.get(e.id) || '' };
      const probe = document.createElement('div');
      drawCard(card, probe);
      card.rev = probe.innerHTML;
      return card;
    });
  }
  // What a card says inside, as plain text and spans: the title, the end day with "Late" and who is doing it, up to two tags, the
  // milestone it is under, and a "Waits on" mark when something it waits on is not done.
  function drawCard(card, el) {
    const e = entry(card.id);
    if (!e) return;
    const wrap = document.createElement('div');
    wrap.className = `bd${e.done ? ' done' : ''}`;
    const title = document.createElement('span');
    title.className = 'bd-title';
    if (e.source) { const num = sourceNumber(e); if (num) { const n = document.createElement('span'); n.className = 'src-num'; n.textContent = `${num} `; title.append(n); } }
    title.append(document.createTextNode(e.title));
    wrap.append(title);
    const meta = document.createElement('div');
    meta.className = 'bd-meta';
    const add = (cls, text) => { const s = document.createElement('span'); if (cls) s.className = cls; s.textContent = text; meta.append(s); };
    const endDay = e.end || e.start;
    add('', endDay ? dayShort(endDay) : 'No date');
    const srcLink = sourceLink(e);
    if (srcLink) meta.append(srcLink);
    if (pageLate(e)) add('bd-late', 'Late');
    if (e.owners.length) add('', e.owners.map((k) => nameOf(k) || 'Someone who left').join(', '));
    if (state.settings.dependencies) {
      const waiting = e.waitsOn.map(entry).filter((w) => w && !w.done);
      if (waiting.length) add('bd-wait', `Waits on ${waiting[0].title}${waiting.length > 1 ? ` and ${waiting.length - 1} more` : ''}`);
    }
    wrap.append(meta);
    const words = scFieldWords(e, state.fields);
    if (words.length) {
      const row = document.createElement('div');
      row.className = 'bd-fields';
      for (const w of words) { const c = document.createElement('span'); c.className = 'bd-field'; c.textContent = w.label; c.title = w.field; row.append(c); }
      wrap.append(row);
    }
    const tags = e.tags.map(tagOf).filter(Boolean);
    if (tags.length) {
      const row = document.createElement('div');
      row.className = 'bd-tags';
      for (const t of tags.slice(0, 2)) {
        const c = document.createElement('span');
        c.className = 'tag';
        if (t.color) c.style.setProperty('--tone', t.color);
        c.textContent = t.label;
        row.append(c);
      }
      if (tags.length > 2) { const more = document.createElement('span'); more.className = 'hint'; more.textContent = `and ${tags.length - 2} more`; row.append(more); }
      wrap.append(row);
    }
    const under = e.parent ? entry(e.parent) : null;
    if (under && under.kind === 'milestone') {
      const u = document.createElement('span');
      u.className = 'bd-under';
      u.textContent = under.title;
      wrap.append(u);
    }
    el.append(wrap);
  }
  function cardMenu(card) {
    const e = entry(card.id);
    if (locked(e)) return [...(canSetFields(e) && state.fields.length ? [editItem(card.id)] : []), ...sourceMenu(e)];
    if (pulled(e)) return [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(card.id) }, closeItem(e), ...sourceMenu(e)];
    if (!canEdit) return [];
    return [
      { id: 'edit', label: 'Edit', icon: 'pen', onClick: () => openEditor(card.id) },
      { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: () => confirmDelete(card.id) },
    ];
  }
  // The rows the Board draws: the board's own (`rowsBy`), or in a space that follows a service, where the board is the service's and
  // can't be changed, this person's own choice kept in this browser. A field's rows need the field to be there.
  const ROWS_KEY = `schedule-rows:${info.context.spaceId || ''}`;
  function rowsNow(b) {
    const raw = pullOn() ? state.rows : (b.rowsBy || '');
    return SC_ROWS_FIELD.test(raw) && !fieldOf(raw.slice(6)) ? '' : raw;
  }
  function rowsLabels(rowsBy) {
    const f = SC_ROWS_FIELD.test(rowsBy) ? fieldOf(rowsBy.slice(6)) : null;
    if (f) return { noRow: `No ${f.label.toLowerCase()}`, otherRow: `Change the ${f.label.toLowerCase()} in Edit.` };
    return rowsBy === 'owners'
      ? { noRow: 'No one', otherRow: 'Change who is doing it in Edit.' }
      : { noRow: `No ${kindWord('milestone')}`, otherRow: `Change the ${kindWord('milestone')} in Edit.` };
  }
  function renderBoard() {
    const b = currentBoard();
    const rowsBy = rowsNow(b);
    const rowsKey = `${rowsBy}|${SC_ROWS_FIELD.test(rowsBy) ? fieldOf(rowsBy.slice(6)).label : ''}`;
    const v = boardWork();
    const { rows, of } = scBoardRows(v.shown, rowsBy, list(), nameOf, 'Someone who left', state.fields);
    const cards = boardCards(b, v.shown, of);
    const columns = b.columns.map((c) => ({ id: c.id, label: c.label, done: Boolean(c.done), ...(c.color ? { color: c.color } : {}) }));
    // The rows' own words (the no-row row, the line for a drop on another row) are given when the board is made, so a change of rows draws it again.
    if (board && boardRowsBy !== rowsKey) { board.destroy(); board = null; }
    if (!board) {
      boardRowsBy = rowsKey;
      boardOpts = {
        name: cap(label('plan')),
        columns,
        cards,
        rows,
        foldKey: BOARD_FOLD_KEY,
        labels: rowsLabels(rowsBy),
        canMove: (c) => canChange(entry(c.id)),
        canAdd: (columnId) => (pullOn() ? through() && !(currentBoard().columns.find((c) => c.id === columnId) || {}).done : canAdd()),
        card: drawCard,
        menu: cardMenu,
        columnMenu,
        onOpen: (c) => openEditor(c.id),
        onAdd: (columnId) => { if (pullOn()) newIssue(columnId); else openEditor(null, { kind: 'work', column: columnId, ...scFilterSeed(currentFilter()) }); },
        onMove: (m) => moveCard(m),
      };
      if (v.on) boardOpts.empty = 'Nothing matches.';
      board = host.ui.board($('board'), boardOpts);
    } else {
      if (v.on) boardOpts.empty = 'Nothing matches.'; else delete boardOpts.empty;
      board.set(cards, columns, rows);
    }
    const rowsAsk = canColumns() || (pullOn() && canEdit);
    hide($('rows-wrap'), !rowsAsk);
    hide($('col-add'), !canColumns());
    hide($('fields-edit'), !canFields());
    hide($('board-bar'), !rowsAsk && !canFields());
    $('rows-milestone').textContent = cap(kindWord('milestone'));
    const sw = $('rows-switch');
    const first = sw.querySelector('.mf-switch-btn');
    let any = false;
    for (const btn of sw.querySelectorAll('.mf-switch-btn')) {
      const on = btn.dataset.rows === rowsBy;
      any = any || on;
      btn.setAttribute('aria-checked', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    if (!any && first) first.tabIndex = 0; // a field's rows: none of the three is on, and the switch is still reachable
    const pick = $('rows-field');
    pick.replaceChildren(...[{ id: '', label: 'A field' }, ...state.fields].map((f) => Object.assign(document.createElement('option'), { value: f.id ? `field:${f.id}` : '', textContent: f.label })));
    pick.value = SC_ROWS_FIELD.test(rowsBy) ? rowsBy : '';
    hide(pick, !state.fields.length);
  }
  // The Rows switch (the `columns` right; the server refuses anyone else): one board:main write with Undo, as a column change.
  async function setRows(value) {
    const b = currentBoard();
    const next = value === 'milestone' || value === 'owners' || (SC_ROWS_FIELD.test(String(value)) && fieldOf(value.slice(6))) ? value : '';
    if (pullOn()) { // the board is the service's: the rows are this person's own view
      if (!canEdit || next === state.rows) return;
      state.rows = next;
      try { if (next) localStorage.setItem(ROWS_KEY, next); else localStorage.removeItem(ROWS_KEY); } catch (err) { /* not kept */ }
      render();
      return;
    }
    if (!canColumns() || next === (b.rowsBy || '')) return;
    const board2 = { ...b };
    if (next) board2.rowsBy = next; else delete board2.rowsBy;
    const what = next === 'owners' ? 'person' : next === 'milestone' ? kindWord('milestone') : next ? fieldOf(next.slice(6)).label.toLowerCase() : '';
    await changeColumns(board2, [], next ? `The board has rows by ${what}.` : 'The board has no rows.');
  }
  for (const btn of $('rows-switch').querySelectorAll('.mf-switch-btn')) btn.addEventListener('click', () => setRows(btn.dataset.rows));
  $('rows-field').addEventListener('change', () => setRows($('rows-field').value));
  async function moveCard(m) {
    if (!canEdit || !carried) return;
    if (locked(entry(m.id))) { sayLocked(); render(); return; }
    if (pulled(entry(m.id))) {
      // Column and done go together (scSetColumn); GitHub takes the move first, and the card stays where it was if it does not. The
      // rank is the space's own and goes with it; a move inside a column changes nothing on GitHub (the server sends only what GitHub holds).
      const b = currentBoard();
      const here = entry(m.id);
      const moved = scSetColumn(here, m.column, b, { label: (k) => kindWord(k), today: today() });
      if (!moved.entry) return;
      const placed = scPlace(list(), moved.entry, moved.entry.column, b, m.before || '');
      // The work above it that needs a rank goes first (the rank alone, so the column never shows the card half way), then the card.
      // The ranks are written one after another without a redraw between them (the first move in a column of unranked cards writes one
      // for every card above the drop), and the board is drawn once, with the card's own write. The first refusal stops the move.
      for (const o of placed.others) {
        const r = await sendPulled(o.id, (e) => (e.rank === o.rank ? null : { ...e, rank: o.rank }), true);
        if (!r.ok) return;
      }
      await sendPulled(m.id, (e) => { const r = scSetColumn(e, m.column, b, { label: (k) => kindWord(k), today: today() }); return r.entry ? { ...r.entry, rank: placed.entry.rank } : null; });
      return;
    }
    const ask = ++boardAsk;
    try { await carried.setColumn({ ref: pointer(m.id), column: m.column, ...(m.before ? { before: m.before } : {}) }, {}); } catch (err) {
      say(err && err.message ? err.message : 'It could not be moved.', 'danger');
      if (ask === boardAsk) render();
    }
  }

  // --- the columns: rename, move, "Counts as done", add, delete (the `columns` right; the server refuses anyone else) -----------------
  // Each change is the rules' answer (scRenameColumn, scMoveColumn, scSetColumnFlag, scAddColumn, scDeleteColumn) written as ONE
  // board:main write, then the work it rewrites; Undo (the bar the import uses) puts the board and the work back. A board still on
  // the template's columns becomes a stored board on the first change, and Undo takes that record away again.
  const canColumns = () => host.can('columns') && !pullOn(); // the board follows the pull while it is on
  let columnsBusy = false;
  // `value` (optional) is the board record to store in place of scBoardValue(next): a change that must leave the stored record as it is.
  async function changeColumns(next, rewritten, text, value) {
    if (columnsBusy) return false;
    columnsBusy = true;
    const plan = { created: [], was: rewritten.map((e) => storedNow(e.id)).filter(Boolean), board: { was: state.boardRaw } };
    try {
      try { await writeBoard(value || scBoardValue(next)); } catch (err) { say(err && err.status === 409 ? 'Someone else changed the columns just now. Try again.' : (err && err.message) || 'The columns could not be changed.', 'danger'); render(); return false; }
      try {
        for (const e of rewritten) { const had = state.entries.get(e.id); await write(e, had ? had.version : undefined); }
      } catch (err) {
        try { await putBack(plan); } catch (again) { /* read on the next load */ }
        say((err && err.message) || 'The columns could not be changed.', 'danger');
        return false;
      }
      render();
      offerUndo(plan, text);
      return true;
    } finally { columnsBusy = false; }
  }
  const rollup = (entries) => host.util.rollup(entries);
  async function renameColumn(c) {
    const b = currentBoard();
    const text = await host.ui.prompt({ title: 'Rename the column', label: 'Name', value: c.label, action: 'Rename', validate: (v) => scRenameColumn(b, c.id, v).problem || '' });
    if (text === null || scLine(text, 10000) === c.label) return;
    const r = scRenameColumn(currentBoard(), c.id, text);
    if (r.problem) { say(r.problem, 'danger'); return; }
    await changeColumns(r.board, [], `Renamed the column ${scLine(text, 10000)}.`);
  }
  async function addColumn() {
    if (!canColumns()) return;
    const b = currentBoard();
    const text = await host.ui.prompt({ title: 'Add a column', label: 'Name', action: 'Add', validate: (v) => scAddColumn(b, v).problem || '' });
    if (text === null) return;
    const r = scAddColumn(currentBoard(), text);
    if (r.problem) { say(r.problem, 'danger'); return; }
    await changeColumns(r.board, [], `Added the column ${r.column.label}.`);
  }
  async function moveColumn(c, by) {
    const r = scMoveColumn(currentBoard(), c.id, by);
    if (r.problem) { say(r.problem, 'danger'); return; }
    await changeColumns(r.board, [], `Moved the column ${c.label} ${by < 0 ? 'left' : 'right'}.`);
  }
  // The column's colour: the picker (no opacity) opens at the menu's place; a pick is one board write with Undo. The colour is the space's own.
  async function setColumnColour(c, color) {
    const r = scSetColumnColor(currentBoard(), c.id, color);
    if (r.problem) { say(r.problem, 'danger'); return; }
    // A stored board is patched where it stands (only this column's colour differs); the template's default board is stored whole, as a rename does.
    await changeColumns(r.board, [], color ? `Coloured the column ${c.label}.` : `Took the colour off the column ${c.label}.`, scColourBoardValue(state.boardRaw, c.id, color) || undefined);
  }
  // The menu hands the column without its colour, so it is read from the board; the picker opens where the menu's row was (the row goes
  // when the menu closes, so its place is taken first).
  const colourOf = (id) => (currentBoard().columns.find((x) => x.id === id) || {}).color || '';
  async function colourColumn(c, el) {
    const was = colourOf(c.id);
    const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    const at = r ? { x: Math.round(r.left), y: Math.round(r.bottom) } : { x: 8, y: 4 };
    const pick = await host.ui.colorPicker({ at, value: was || undefined, opacity: false, label: 'Column colour' });
    if (pick && pick.color && pick.color !== was) await setColumnColour(c, pick.color);
  }
  async function flagColumn(c) {
    const r = scSetColumnFlag(currentBoard(), list(), c.id, !c.done, { rollup, today: today() });
    if (r.problem) { say(r.problem, 'danger'); return; }
    await changeColumns(r.board, r.entries, `${c.label} ${c.done ? 'no longer counts' : 'now counts'} as done.`);
  }
  const deleteEditor = host.ui.editor($('col-delete'), { size: 'small' });
  let deleting = null; // the column being deleted
  function deleteColumn(c) {
    const b = currentBoard();
    const others = b.columns.filter((x) => x.id !== c.id);
    // The refusals that do not depend on where the work goes are said at once, in the rules' own sentences.
    const probe = scDeleteColumn(b, c.id, others[0] ? others[0].id : '', list(), { rollup, today: today() });
    if (probe.problem) { say(probe.problem, 'danger'); return; }
    const n = list().filter((e) => e.kind === 'work' && scColumnOf(e, b).id === c.id).length;
    deleting = c;
    $('col-delete-title').textContent = `Delete the column ${c.label}`;
    const sel = $('col-to');
    sel.replaceChildren(...others.map((x) => { const o = document.createElement('option'); o.value = x.id; o.textContent = x.label; return o; }));
    $('col-to-hint').textContent = n ? `${n} ${kindWord('work', { many: n !== 1 })} will move there.` : 'There is no work in it.';
    $('col-error').hidden = true;
    deleteEditor.open({ focus: sel });
  }
  $('col-cancel').addEventListener('click', () => deleteEditor.close());
  $('col-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = deleting;
    if (!c) return;
    const r = scDeleteColumn(currentBoard(), c.id, $('col-to').value, list(), { rollup, today: today() });
    if (r.problem) { $('col-error').textContent = r.problem; $('col-error').hidden = false; return; }
    deleteEditor.close();
    deleting = null;
    await changeColumns(r.board, r.entries, `Deleted the column ${c.label}.`);
  });
  $('col-add').addEventListener('click', addColumn);
  function columnMenu(c) {
    if (!canColumns()) return [];
    const b = currentBoard();
    const at = b.columns.findIndex((x) => x.id === c.id);
    return [
      { id: 'rename', label: 'Rename', icon: 'pen', onClick: () => renameColumn(c) },
      { id: 'left', label: 'Move left', icon: 'arrow-left', disabled: at <= 0, onClick: () => moveColumn(c, -1) },
      { id: 'right', label: 'Move right', icon: 'arrow-right', disabled: at < 0 || at >= b.columns.length - 1, onClick: () => moveColumn(c, 1) },
      { id: 'done', label: 'Counts as done', icon: c.done ? 'square-check' : 'square', regular: !c.done, current: Boolean(c.done), onClick: () => flagColumn(c) },
      { id: 'colour', label: 'Colour', icon: 'palette', onClick: (item, el) => colourColumn(c, el) },
      ...(colourOf(c.id) ? [{ id: 'nocolour', label: 'No colour', icon: 'xmark', onClick: () => setColumnColour(c, '') }] : []),
      { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteColumn(c) },
    ];
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
    const weeks = $('tl-weeks');
    weeks.replaceChildren();
    for (const w of t.weeks) {
      const c = document.createElement('span');
      c.className = 'tl-week';
      c.style.setProperty('--x', `${w.x}px`);
      c.textContent = dayShort(w.day);
      weeks.append(c);
    }
    // the rows
    const rows = t.rows.map((r) => {
      const e = entry(r.id);
      const el = clone('tpl-tl-row');
      el.dataset.kind = e.kind;
      if (e.done) el.classList.add('done');
      if (pageLate(e)) el.classList.add('late');
      setIcon(el.querySelector('.tl-label .ic'), KIND_ICON[e.kind]);
      fill(el, { name: `${e.source && e.source.number ? `#${e.source.number} ` : ''}${e.title}`, bar: e.kind === 'work' ? e.title : '' });
      const bar = el.querySelector('.tl-bar');
      bar.style.setProperty('--x', `${r.x}px`);
      bar.style.setProperty('--w', `${r.w}px`);
      const cutWords = r.cut === 'both' ? ', runs past both ends of the Timeline' : r.cut === 'start' ? ', starts before the Timeline' : r.cut === 'end' ? ', runs past the end of the Timeline' : '';
      if (r.cut) bar.classList.add(`cut-${r.cut}`);
      const colName = columnName(e);
      const what = `${cap(kindWord(e.kind))}: ${e.title}, ${span(e)}${colName ? `, ${colName}` : ''}${e.done ? ', done' : ''}${cutWords}`;
      bar.setAttribute('aria-label', what);
      bar.dataset.tip = `${e.title} · ${span(e)}${colName ? ` · ${colName}` : ''}`;
      el.querySelector('.tl-label').setAttribute('aria-label', what);
      for (const b of el.querySelectorAll('[data-action="open"]')) b.addEventListener('click', () => openEditor(e.id));
      return el;
    });
    const rowsBox = $('tl-rows');
    rowsBox.replaceChildren();
    for (const r of rows) rowsBox.append(r);
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
    // what has no day, and what is dated outside the weeks drawn
    const undated = [...t.undated, ...t.outside].map(entry).filter(Boolean);
    hide($('tl-undated'), !undated.length);
    $('tl-undated-title').textContent = t.outside.length ? 'Not on the Timeline' : 'Not scheduled';
    const strip = $('tl-undated-list');
    strip.replaceChildren();
    for (const e of undated) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-chip undated';
      if (e.done) b.classList.add('done');
      const when = span(e);
      b.append(icon(KIND_ICON[e.kind]), document.createTextNode(when ? `${e.title} (${when})` : e.title));
      b.setAttribute('aria-label', `${cap(kindWord(e.kind))}: ${e.title}, ${when || 'no date'}`);
      b.addEventListener('click', () => openEditor(e.id));
      strip.append(b);
    }
    // bring today into sight once, the first time it is drawn
    if (!timelineScrolled && hasRows && t.today !== null) {
      timelineScrolled = true;
      requestAnimationFrame(() => { const f = $('tl-frame'); f.scrollLeft = Math.max(0, t.today - f.clientWidth / 3); });
    }
  }
  let timelineScrolled = false;

  // --- the entry, in the editor window ---------------------------------------------------------------------------------------
  const editorError = (text) => { $('f-error').textContent = text; $('f-error').hidden = !text; };
  // The choices on the editor's field selects: { fieldId: optionId } for those with one.
  const fieldPicks = () => Object.fromEntries([...$('f-fields').querySelectorAll('select[data-field]')].filter((x) => x.value).map((x) => [x.dataset.field, x.value]));
  // What the work holds after the editor: the choices of fields the plan no longer has stay as they were, the rest are the selects'.
  const fieldsFromForm = (was) => ({ ...Object.fromEntries(Object.entries(was || {}).filter(([k]) => !fieldOf(k))), ...fieldPicks() });
  const checked = (box) => [...box.querySelectorAll('input:checked')].map((i) => i.value);
  let ownersPick = null;
  const dates = { start: null, end: null, target: null };
  const formSnapshot = () => JSON.stringify([$('f-kind').value, $('f-title').value, $('f-start').value, $('f-end').value, $('f-target').value, ownersPick ? ownersPick.get() : [], $('f-parent').value, checked($('f-waits')), $('f-phase').value, checked($('f-tags')), $('f-done').checked, $('f-notes').value, fieldPicks()]);
  const formDirty = () => Boolean(state.editing && !state.editing.readOnly && state.editing.opened !== undefined && state.editing.opened !== formSnapshot());
  const editor = host.ui.editor($('editor'), {
    size: 'medium',
    isDirty: formDirty,
    onClose: () => {
      state.editing = null;
      for (const k of ['start', 'end', 'target']) if (dates[k]) { dates[k].destroy(); dates[k] = null; }
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
    hide($('f-waits-field'), kind === 'note' || !state.settings.dependencies || !Number($('f-waits').dataset.count));
    hide($('f-done-field'), kind === 'note');
    hide($('f-fields'), kind !== 'work' || !state.fields.length);
    const under = ed && ed.id ? list().filter((x) => x.kind === 'work' && x.parent === ed.id).length : 0;
    $('f-done-label').textContent = kind === 'milestone' && under ? 'Done, whatever is under it' : 'Done';
    $('f-start').required = Boolean(state.settings.datesRequired) && kind !== 'note';
    $('f-end').required = Boolean(state.settings.datesRequired) && kind === 'work';
  }
  $('f-kind').addEventListener('change', fitKind);
  // A start after the end moves the end with it, so a span is never backwards.
  $('f-start').addEventListener('change', () => { if ($('f-end').value && $('f-start').value && $('f-end').value < $('f-start').value) { $('f-end').value = $('f-start').value; if (dates.end) dates.end.refresh(); } });

  // Waits on, as a short control: only the work already chosen is listed, with a search that lists up to 8 matches to add. A chosen one is
  // a ticked box, taken off by unticking it; the rest are found by typing. `checked($('f-waits'))` still reads the choice.
  const WAITS_FOUND_MAX = 8;
  const WAITS_NOTE = 'It can start once these are done.';
  const waitLabel = (x) => `${x.title}${x.start ? ` (${span(x)})` : ''}`;
  function setupWaits(others, chosen) {
    const box = $('f-waits-chosen');
    const found = $('f-waits-found');
    const search = $('f-waits-search');
    const row = (x, on) => {
      const el = choice(x.id, waitLabel(x), on);
      el.querySelector('input').addEventListener('change', (ev) => {
        if (ev.target.checked) box.append(el); else if (box.contains(el)) el.remove();
        drawFound();
      });
      return el;
    };
    function drawFound() {
      const q = search.value.trim().toLowerCase();
      const have = new Set([...box.querySelectorAll('input')].map((i) => i.value));
      const hits = q ? others.filter((x) => !have.has(x.id) && waitLabel(x).toLowerCase().includes(q)) : [];
      found.replaceChildren(...hits.slice(0, WAITS_FOUND_MAX).map((x) => row(x, false)));
      $('f-waits-note').textContent = !q ? WAITS_NOTE : !hits.length ? 'Nothing matches.' : hits.length > WAITS_FOUND_MAX ? `${hits.length} matches: type more to narrow them.` : WAITS_NOTE;
    }
    const chosenIds = new Set(chosen);
    box.replaceChildren(...others.filter((x) => chosenIds.has(x.id)).map((x) => row(x, true)));
    search.value = '';
    search.oninput = drawFound;
    $('f-waits').dataset.count = String(others.length);
    drawFound();
  }
  // The pulled issue's view (see openEditor): the link, the description as plain text (never markup), and only what an issue has.
  const targetOf = (e) => (e.end && e.start && e.end > e.start ? e.end : '');
  function showIssueView(shown, on) {
    for (const el of [$('f-kind').closest('label'), $('f-notes-field')]) hide(el, on);
    if (on) for (const id of ['f-dates', 'f-owners-field', 'f-parent-field', 'f-waits-field', 'f-phase-field']) hide($(id), true);
    const src = $('f-source');
    src.replaceChildren();
    const link = on ? sourceLink(shown) : null;
    if (link) { link.classList.add('src-open'); link.append(document.createTextNode(` Open on ${shown.source.from === 'github' ? 'GitHub' : state.pull.name}`)); src.append(link); }
    hide(src, !link);
    $('f-desc').textContent = on ? shown.notes : '';
    hide($('f-desc-field'), !on || !shown.notes);
    // The one day an issue has here: a target. It is the work's `end` (its `start` stays the day the issue was opened and is not shown), the
    // plan's own and never sent to GitHub; empty, or the day it was opened, means none.
    $('f-target').value = on && targetOf(shown);
    $('f-target-note').textContent = on ? `Kept here, not on ${state.pull.name}. Empty means no target.` : '';
    hide($('f-target-field'), !on);
  }
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
    // A "+" in a board column opens new work in that column (its done flag with it, so the Done box starts as the column says).
    const seedCol = s.column ? currentBoard().columns.find((c) => c.id === s.column) : null;
    const shown = found ? found.e : scClean('new', { kind: s.kind || 'work', title: s.title || '', start: s.start || '', end: s.end || '', notes: s.notes || '', parent: s.parent || null, ref: s.ref || null, owners: s.owners || [], phase: s.phase || '', tags: s.tags || [], ...(seedCol ? { column: seedCol.id, done: Boolean(seedCol.done) } : {}), fields: s.fields || {} });
    // A pulled issue is read-only unless changes go back and the person may change it, or may at least set its fields (the space's own).
    const readOnly = !canEdit || (locked(shown) && !canSetFields(shown));
    const partly = !readOnly && pulled(shown); // a pulled issue: the title, tags and Done change on GitHub (with the right to), and the fields here
    const fieldsOnly = partly && locked(shown);
    // A pulled issue gets its own view, not the whole form greyed: its number and a link, the title, the description (read only), Done, tags
    // and the plan's fields. Kind, days, who is doing it, Part of, Waits on and Phase are not an issue's and are not shown.
    const issueView = pulled(shown) && isIssue(shown);
    state.editing = { partly, fieldsOnly, id: id || null, version: found ? found.version : undefined, readOnly, ref: shown.ref, by: shown.by, order: shown.order, parent: shown.parent, column: shown.column, wasDone: shown.done };
    $('editor-title').textContent = issueView ? `Issue ${sourceNumber(shown)}` : id ? (readOnly ? shown.title : `Change this ${kindWord(shown.kind)}`) : cap(`Add ${kindWord(shown.kind, { a: true })}`);
    $('f-readonly').textContent = readOnly ? (locked(shown) ? SC_PULLED_SAY : `You can look at the ${label('plan')} but not change it.`) : fieldsOnly ? `Only the fields change here. The title, ${label('tag', { many: true })} and Done come from ${state.pull.name}.${host.util.approvalLine() ? ` ${host.util.approvalLine()}` : ''}` : partly ? `The title, ${label('tag', { many: true })} and Done change on ${state.pull.name}.${state.fields.length ? ' The fields stay here.' : ''}` : '';
    hide($('f-readonly'), !readOnly && !partly);
    $('f-kind').replaceChildren(...SC_KINDS.map((k) => Object.assign(document.createElement('option'), { value: k, textContent: cap(kindWord(k)) })));
    $('f-kind').value = shown.kind;
    $('f-title').value = shown.title;
    $('f-start').value = shown.start;
    $('f-end').value = shown.end;
    // owners
    if (ownersPick) ownersPick.destroy();
    ownersPick = host.ui.peoplePicker($('f-owners'), { people: state.people, value: shown.owners, name: cap(label('owner', { many: true })) });
    // part of: the milestones (never itself, never something under it)
    const below = new Set(); // everything under this entry, however deep: never a place to put it
    if (id) {
      const kids = new Map();
      for (const x of list()) if (x.parent) { if (!kids.has(x.parent)) kids.set(x.parent, []); kids.get(x.parent).push(x.id); }
      const stack = [id];
      while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!below.has(k)) { below.add(k); stack.push(k); }
    }
    const milestones = list().filter((x) => x.kind === 'milestone' && x.id !== id && !below.has(x.id));
    $('f-parent').replaceChildren(...[{ id: '', title: 'Nothing: at the top' }, ...milestones].map((x) => Object.assign(document.createElement('option'), { value: x.id, textContent: x.title })));
    $('f-parent').value = shown.parent && milestones.some((x) => x.id === shown.parent) ? shown.parent : '';
    hide($('f-parent-field'), !milestones.length && !shown.parent);
    $('f-parent-label').textContent = `Part of ${kindWord('milestone', { a: true })}`;
    // waits on: every milestone and work but itself and what already waits on it
    const others = scOrdered(list()).map((x) => x.entry).filter((x) => x.kind !== 'note' && x.id !== id && x.id !== shown.parent && (!id || !scMakesLoop(list(), id, x.id)));
    setupWaits(others, shown.waitsOn);
    // phase
    const phases = state.phases;
    $('f-phase').replaceChildren(...[{ id: '', label: 'No phase' }, ...phases].map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.label })));
    $('f-phase').value = shown.phase && phases.some((p) => p.id === shown.phase) ? shown.phase : '';
    hide($('f-phase-field'), !phases.length);
    // fields: one choice each
    $('f-fields').replaceChildren(...state.fields.map((fd) => {
      const wrap = document.createElement('label');
      wrap.className = 'sdk-field';
      const text = document.createElement('span');
      text.className = 'sdk-label';
      text.textContent = fd.label;
      const sel = document.createElement('select');
      sel.dataset.field = fd.id;
      const cur = (shown.fields || {})[fd.id] || '';
      const known = fd.options.some((o) => o.id === cur);
      sel.replaceChildren(...[{ id: '', label: `No ${fd.label.toLowerCase()}` }, ...fd.options].map((o) => Object.assign(document.createElement('option'), { value: o.id, textContent: o.label })));
      sel.value = known ? cur : '';
      wrap.append(text, sel);
      return wrap;
    }));
    // tags
    $('f-tags-label').textContent = cap(label('tag', { many: true }));
    $('f-tags').replaceChildren(...state.settings.tags.map((t) => choice(t.id, t.label, shown.tags.includes(t.id))));
    hide($('f-tags-field'), !state.settings.tags.length);
    $('f-done').checked = shown.kind === 'milestone' ? shown.ticked : shown.done;
    $('f-notes').value = shown.notes;
    $('f-by').textContent = shown.by ? `Added by ${nameOf(shown.by) || 'someone'}` : '';
    editorError('');
    for (const el of $('form').querySelectorAll('input, select, textarea')) el.disabled = readOnly || (partly && !($('f-fields').contains(el) || $('f-target-field').contains(el) || (!fieldsOnly && (el.id === 'f-title' || el.id === 'f-done' || $('f-tags').contains(el)))));
    hide($('f-save'), readOnly);
    hide($('f-cancel'), readOnly);
    hide($('f-delete'), readOnly || partly || !id);
    hide($('f-actions'), readOnly);
    $('f-delete').textContent = 'Delete';
    state.editing.armed = false;
    fitKind();
    showIssueView(shown, issueView);
    dates.start = host.ui.datePicker($('f-start'), { clearable: true });
    dates.end = host.ui.datePicker($('f-end'), { clearable: true });
    dates.target = host.ui.datePicker($('f-target'), { clearable: true });
    state.editing.opened = formSnapshot();
    editor.open({ focus: readOnly ? editor.element : $('f-title') });
    dates.start.refresh();
    dates.end.refresh();
    dates.target.refresh();
    showLinks(id);
  }
  $('f-cancel').addEventListener('click', () => editor.cancel());
  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ed = state.editing;
    if (!ed || ed.readOnly) return;
    if (ed.partly) { await savePulled(ed); return; }
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
      column: kind === 'work' ? ed.column : undefined,
      done: kind === 'work' ? Boolean(ed.wasDone) : kind === 'milestone' ? (ed.id ? (entry(ed.id) || {}).done : false) : undefined,
      progress: ed.id ? (entry(ed.id) || {}).progress : null,
      phase: $('f-phase').value,
      tags: checked($('f-tags')),
      fields: kind === 'work' ? fieldsFromForm(ed.id ? (entry(ed.id) || {}).fields : {}) : {},
      notes: $('f-notes').value,
      parent,
      order: ed.order && !moved ? ed.order : orderAtEnd(parent),
      by: ed.by || info.user.key,
      ref: ed.ref,
    });
    // what the person typed, checked before it is cleaned away
    if ($('f-start').value && !scIsDay($('f-start').value)) { editorError('The start is a day from 1900 to 2200, such as 2026-10-14.'); return; }
    if (kind === 'work' && $('f-end').value && !scIsDay($('f-end').value)) { editorError('The end is a day from 1900 to 2200, such as 2026-10-14.'); return; }
    if (kind === 'work' && $('f-start').value && $('f-end').value && $('f-end').value < $('f-start').value) { editorError('The end is before the start.'); return; }
    // The Done box is the tick (scSetDone): work moves to the board's done column when ticked, and out of it when not.
    let toSave = draft;
    if (kind === 'work' && $('f-done').checked !== Boolean(draft.done)) {
      const r = scSetDone(draft, $('f-done').checked, { label: (k) => kindWord(k), board: currentBoard(), today: today() });
      if (r.entry) toSave = r.entry;
    }
    const problem = scProblem(draft, { datesRequired: state.settings.datesRequired, label: (k) => kindWord(k) });
    if (problem) { editorError(problem); (draft.title ? $('f-start') : $('f-title')).focus(); return; }
    $('f-save').disabled = true;
    try {
      await saveEntry(toSave, ed.version);
      editor.close();
      if (!ed.id && kind === 'work' && state.view === 'board') {
        const v = boardWork();
        if (v.on && !scFilterMatch(toSave, v.f, v.byId)) say('Added. The filter hides it.');
      }
    } catch (err) {
      if (err && err.status === 409) {
        if (err.current && state.editing) state.editing.version = err.current.version;
        editorError('Someone else changed this while you had it open. Save again to keep your changes.');
      } else editorError(err && err.message ? err.message : 'It could not be saved.');
    } finally {
      $('f-save').disabled = false;
    }
  });
  // The title, tags and Done of a pulled issue: sent to GitHub, and the editor stays open with the reason if GitHub does not take it.
  async function savePulled(ed) {
    const title = scLine($('f-title').value, 10000);
    if (!title && !ed.fieldsOnly) { editorError('Give it a title.'); $('f-title').focus(); return; }
    if (title.length > SC_TITLE_MAX && !ed.fieldsOnly) { editorError(`Give it a title of at most ${SC_TITLE_MAX} characters.`); $('f-title').focus(); return; }
    const done = $('f-done').checked;
    const picked = checked($('f-tags'));
    // The target date is the work's `end` (the space's own, never sent): empty, or the day the issue was opened, is no target.
    const target = $('f-target').value;
    const was = entry(ed.id);
    if (target && was && was.start && target < was.start) { editorError(`The target date is before the day it was opened (${dayShort(was.start)}).`); $('f-target').focus(); return; }
    const endOf = (e) => (target ? target : e.start || e.end);
    $('f-save').disabled = true;
    try {
      const r = await sendPulled(ed.id, (e) => {
        if (ed.fieldsOnly) return { ...e, fields: fieldsFromForm(e.fields), end: endOf(e) };
        let next = { ...e, title, tags: [...e.tags.filter((t) => !tagOf(t)), ...picked], fields: fieldsFromForm(e.fields), end: endOf(e) }; // a tag the plan no longer lists stays as it is
        if (done !== Boolean(e.done)) { const d = scSetDone(next, done, { label: (k) => kindWord(k), board: currentBoard(), today: today() }); if (d.entry) next = d.entry; }
        return next;
      });
      if (r.ok) editor.close(); else editorError(r.error);
    } finally { $('f-save').disabled = false; }
  }
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

  // --- the fields: Edit fields (the `columns` right; the server refuses anyone else) --------------------------------------------------
  // A draft of the plan's fields is changed in the window (scAddField, scRenameField, scAddOption, ... in schedule-lib.js), and Save writes
  // the records that changed, then the work that lost a choice (scFieldsRewrite), as one change with Undo. The fields are the space's own: in a
  // space that follows a service nothing here is sent to it.
  const fieldsEditor = host.ui.editor($('fields-editor'), { size: 'medium' });
  let draft = null; // the fields being edited
  let fieldsBusy = false;
  const fieldsError = (text) => { $('fields-error').textContent = text || ''; $('fields-error').hidden = !text; };
  function fieldButton(name, text, iconName, onClick, o) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-quiet btn-small sdk-icon-btn';
    b.setAttribute('aria-label', text);
    b.dataset.tip = text;
    if (o && o.disabled) b.disabled = true;
    if (o && o.danger) b.classList.add('btn-danger');
    b.append(icon(iconName));
    b.addEventListener('click', onClick);
    return b;
  }
  function changeDraft(r, focus) {
    if (r.problem) { fieldsError(r.problem); return false; }
    fieldsError('');
    draft = r.fields;
    drawFields(focus);
    return true;
  }
  function drawFields(focus) {
    const box = $('fields-list');
    box.replaceChildren();
    draft.forEach((f, i) => {
      const block = document.createElement('div');
      block.className = 'fe-field';
      block.setAttribute('role', 'group');
      block.setAttribute('aria-label', f.label);
      const head = document.createElement('div');
      head.className = 'fe-row';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'fe-name';
      name.value = f.label;
      name.maxLength = SC_FIELD_LABEL_MAX;
      name.setAttribute('aria-label', `Name of the field ${f.label}`);
      name.dataset.focus = `f:${f.id}`;
      name.addEventListener('change', () => { if (!changeDraft(scRenameField(draft, f.id, name.value))) name.value = f.label; });
      head.append(name,
        fieldButton('up', `Move ${f.label} up`, 'arrow-up', () => changeDraft(scMoveField(draft, f.id, -1), `f:${f.id}`), { disabled: i === 0 }),
        fieldButton('down', `Move ${f.label} down`, 'arrow-down', () => changeDraft(scMoveField(draft, f.id, 1), `f:${f.id}`), { disabled: i === draft.length - 1 }),
        fieldButton('del', `Delete the field ${f.label}`, 'trash', () => changeDraft(scDeleteField(draft, f.id)), { danger: true }));
      const opts = document.createElement('ul');
      opts.className = 'fe-opts';
      f.options.forEach((o, j) => {
        const li = document.createElement('li');
        li.className = 'fe-row';
        const text = document.createElement('input');
        text.type = 'text';
        text.value = o.label;
        text.maxLength = SC_FIELD_LABEL_MAX;
        text.setAttribute('aria-label', `Choice ${j + 1} of ${f.label}`);
        text.dataset.focus = `o:${f.id}:${o.id}`;
        text.addEventListener('change', () => { if (!changeDraft(scRenameOption(draft, f.id, o.id, text.value))) text.value = o.label; });
        li.append(text,
          fieldButton('up', `Move ${o.label} up`, 'arrow-up', () => changeDraft(scMoveOption(draft, f.id, o.id, -1), `o:${f.id}:${o.id}`), { disabled: j === 0 }),
          fieldButton('down', `Move ${o.label} down`, 'arrow-down', () => changeDraft(scMoveOption(draft, f.id, o.id, 1), `o:${f.id}:${o.id}`), { disabled: j === f.options.length - 1 }),
          fieldButton('del', `Delete the choice ${o.label}`, 'trash', () => changeDraft(scDeleteOption(draft, f.id, o.id), `a:${f.id}`), { danger: true }));
        opts.append(li);
      });
      const add = document.createElement('div');
      add.className = 'fe-add';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = SC_FIELD_LABEL_MAX;
      input.placeholder = 'Add a choice';
      input.setAttribute('aria-label', `Add a choice to ${f.label}`);
      input.dataset.focus = `a:${f.id}`;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-small';
      go.textContent = 'Add';
      const addOption = () => { if (input.value.trim()) changeDraft(scAddOption(draft, f.id, input.value), `a:${f.id}`); };
      go.addEventListener('click', addOption);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addOption(); } });
      add.append(input, go);
      block.append(head, opts, add);
      box.append(block);
    });
    hydrate(box);
    const lost = scFieldsRewrite(list(), state.fields, draft).length;
    $('fields-note').textContent = lost ? `Saving takes a choice off ${lost} ${kindWord('work', { many: lost !== 1 })}. You can undo it.` : draft.length ? '' : 'No fields yet.';
    $('fields-new').disabled = draft.length >= SC_FIELDS_MAX;
    $('fields-new-go').disabled = draft.length >= SC_FIELDS_MAX;
    if (focus) { const el = [...box.querySelectorAll('[data-focus]')].find((x) => x.dataset.focus === focus); if (el) el.focus(); }
  }
  function openFieldsEditor() {
    if (!canFields()) return;
    draft = state.fields.map((f) => ({ ...f, options: f.options.map((o) => ({ ...o })) }));
    fieldsError('');
    $('fields-new').value = '';
    drawFields();
    fieldsEditor.open({ focus: $('fields-new') });
  }
  function addFieldFromInput() {
    const text = $('fields-new').value;
    if (!text.trim()) return;
    const r = scAddField(draft, text);
    if (changeDraft(r, r.field ? `a:${r.field.id}` : '')) $('fields-new').value = '';
  }
  $('fields-new-go').addEventListener('click', addFieldFromInput);
  $('fields-new').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addFieldFromInput(); } });
  $('fields-edit').addEventListener('click', openFieldsEditor);
  $('fields-cancel').addEventListener('click', () => fieldsEditor.cancel());
  $('fields-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (fieldsBusy || !draft) return;
    const diff = scFieldsDiff(state.fields, draft);
    if (!diff.write.length && !diff.remove.length) { fieldsEditor.close(); return; }
    const rewritten = scFieldsRewrite(list(), state.fields, draft);
    const touched = [...diff.write.map((f) => f.id), ...diff.remove];
    const plan = { created: [], was: rewritten.map((e) => storedNow(e.id)).filter(Boolean), fields: touched.map((id) => ({ id, was: (state.fieldRows.get(SC_FIELD_PREFIX + id) || {}).value || null })) };
    fieldsBusy = true;
    $('fields-save').disabled = true;
    try {
      for (const f of diff.write) await writeField(f.id, scFieldValue(f));
      for (const id of diff.remove) await removeField(id);
      for (const e of rewritten) { const had = state.entries.get(e.id); await write(e, had ? had.version : undefined); }
    } catch (err) {
      try { await putBack(plan); } catch (again) { /* read on the next load */ }
      fieldsError(err && err.status === 409 ? 'Someone else changed the fields just now. Close this and try again.' : (err && err.message) || 'The fields could not be changed.');
      return;
    } finally { fieldsBusy = false; $('fields-save').disabled = false; }
    fieldsEditor.close();
    render();
    offerUndo(plan, 'Changed the fields.');
  });
  async function writeField(id, value) {
    const key = SC_FIELD_PREFIX + id;
    const had = state.fieldRows.get(key);
    const saved = await host.storage.set(key, value, had ? { version: had.version } : {});
    takeField(key, value, saved && saved.version, false);
  }
  async function removeField(id) {
    const key = SC_FIELD_PREFIX + id;
    const had = state.fieldRows.get(key);
    if (!had) return;
    await host.storage.delete(key, { version: had.version });
    takeField(key, null, 0, true);
  }

  // --- what other modules may ask of this one ----------------------------------------------------------------------------------
  // The actions library's handlers (ACTION_HANDLERS in schedule-lib-actions.js: addMilestone, addWork, addNote, setDone,
  // updateEntry), carried out here by the SDK (host.actions.fromLibrary) when a person's page carries a request, as the server's
  // runner carries an agent's (the manifest's actions.server). The handler reads what the SDK gives both ways (ctx.settings,
  // ctx.util.label, order and rollup, ctx.space.phases) and answers everything an edit's save does: the entry, the milestones'
  // done and progress, and the link to what it was made from. They run under the rights of the page that carries them (canEdit).
  let carried = null; // the handlers, carried out in this page (set below, before anything is drawn)
  const REFUSED = `You may not add to the ${label('plan')} here.`;
  const CHANGE_REFUSED = `You may not change the ${label('plan')} here.`;
  // Once a request's writes are made, they show at once.
  async function afterAction({ writes }) {
    for (const w of writes) if (!takeBoard(String(w.key), w.value, w.version, false) && !takeField(String(w.key), w.value, w.version, false)) remember(String(w.key).slice(SC_PREFIX.length), w.value, w.version);
    render();
  }
  if (host.actions && host.actions.provide && host.actions.fromLibrary) carried = host.actions.fromLibrary(ACTION_HANDLERS, { after: afterAction });
  if (carried) {
    host.actions.provide(Object.fromEntries(Object.entries(carried).map(([name, fn]) => [name, (input, by) => {
      if (!canEdit) throw new Error(name.startsWith('add') ? REFUSED : CHANGE_REFUSED);
      if (pullOn() && (name.startsWith('add') || pulled(entry(input && input.ref && input.ref.id)))) throw new Error(SC_PULLED_SAY);
      return fn(input, by);
    }])));
  }
  if (host.objects && host.objects.onOpen) {
    host.objects.onOpen((ref) => {
      if (ref.module !== info.module.id || ref.kind !== 'plan') return;
      const show = () => openEditor(ref.id);
      if (state.loaded) show(); else state.openWanted = show;
    });
  }

  // --- the plan as a JSON file: Export, and Import (add to the plan, or replace it) -----------------------------------------------------
  // The format is in src/FORMAT.md; the rules (what is read, what is refused) are in schedule-lib-file.js. A file is read whole and
  // checked before anything is written. The writes are the plan's own (host.storage.set, one entry at a time, as an edit is), so
  // they need the edit right and meet the same guards; Replace needs the clear right as well. A write that fails puts back what was
  // there. For a short time after, Undo puts back what the import changed.
  const UNDO_SECONDS = 30;
  let importing = false;
  let undoTimer = 0;
  let undoPlan = null; // { created: [ids], was: [{ id, value }] }: what the last import changed
  const canClear = () => host.can('clear');
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
    if (!state.entries.size) { say('There is nothing in the plan to export yet.'); return; }
    try {
      const body = JSON.stringify(scExportFile(list(), { module: info.module.id, boards: [currentBoard()], fields: state.fields }), null, 2);
      await deliver(new Blob([body], { type: 'application/json' }), scExportName(today()));
    } catch (err) { say('This browser would not save the file.', 'danger'); }
  }
  // What a file holds, in the plan's words: "3 milestones, 5 work and 1 note".
  function countWords(entries) {
    const parts = SC_KINDS.map((k) => [k, entries.filter((e) => e.kind === k).length]).filter((x) => x[1]).map(([k, n]) => `${n} ${kindWord(k, { many: n !== 1 })}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || 'nothing';
  }
  const storedNow = (id) => { const x = state.entries.get(id); return x ? { id, value: scValue(x.e), version: x.version } : null; };
  // Puts back what an import changed: the entries it made come off, the ones it replaced or removed return. Others' work is left.
  async function writeBoard(value) {
    const saved = await host.storage.set(BOARD_KEY, value, state.boardVersion === undefined ? {} : { version: state.boardVersion });
    state.boardRaw = value;
    state.boardVersion = saved && saved.version;
  }
  async function putBack(plan) {
    if (plan.board) {
      try {
        if (plan.board.was) await writeBoard(plan.board.was);
        else if (state.boardRaw) { await host.storage.delete(BOARD_KEY, { version: state.boardVersion }); state.boardRaw = null; state.boardVersion = undefined; }
      } catch (err) { /* read again on its change */ }
    }
    for (const f of plan.fields || []) {
      try { if (f.was) await writeField(f.id, f.was); else await removeField(f.id); } catch (err) { /* read again on its change */ }
    }
    for (const id of plan.created) {
      const x = state.entries.get(id);
      if (!x) continue;
      try { await host.storage.delete(SC_PREFIX + id, { version: x.version }); } catch (err) { /* gone already */ }
      state.entries.delete(id);
      host.objects.setLinks(pointer(id), []).catch(() => {});
    }
    for (const w of plan.was) {
      const x = state.entries.get(w.id);
      const saved = await host.storage.set(SC_PREFIX + w.id, w.value, x ? { version: x.version } : {});
      state.entries.set(w.id, { e: scClean(w.id, w.value), version: saved && saved.version });
      host.objects.setLinks(pointer(w.id), w.value.ref ? [w.value.ref] : []).catch(() => {});
    }
    await settleMilestones();
    render();
  }
  // `newBoard`: the file's board to store first (the columns right, `columns`, is asked of the server by that write: a refusal is the
  // server's own sentence and nothing has been written yet).
  // `newFields`: the fields the file defines that the plan lacks or has to gain choices on (stored first; the `columns` right is asked of the
  // server by those writes). `mode` 'update' writes only the entries given, which are the plan's own changed in what the space owns.
  async function applyImport(entries, mode, newBoard, newFields) {
    const plan = { created: [], was: [] };
    importing = true;
    try {
      if (newBoard) {
        plan.board = { was: state.boardRaw };
        await writeBoard(scBoardValue(newBoard));
      }
      if (newFields && newFields.length) {
        plan.fields = newFields.map((f) => ({ id: f.id, was: (state.fieldRows.get(SC_FIELD_PREFIX + f.id) || {}).value || null }));
        for (const f of newFields) await writeField(f.id, scFieldValue(f));
      }
      const keep = new Set(entries.map((e) => e.id));
      for (const e of entries) {
        const had = storedNow(e.id);
        if (had) plan.was.push({ id: e.id, value: had.value }); else plan.created.push(e.id);
        await write(e, had ? had.version : undefined);
      }
      if (mode === 'replace') {
        for (const old of list().filter((x) => !keep.has(x.id))) {
          const had = storedNow(old.id);
          if (!had) continue;
          plan.was.push({ id: old.id, value: had.value });
          await host.storage.delete(SC_PREFIX + old.id, { version: had.version });
          state.entries.delete(old.id);
          host.objects.setLinks(pointer(old.id), []).catch(() => {});
        }
      }
    } catch (err) {
      try { await putBack(plan); } catch (again) { /* what could not be put back is read on the next load */ }
      throw err;
    } finally { importing = false; }
    for (const e of entries) if (e.ref) host.objects.setLinks(pointer(e.id), [e.ref]).catch(() => {});
    await settleMilestones();
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
  // Check file: the same reading as Import, nothing written. Says what the file would add, or its problems.
  async function showCheck(file, parsed) {
    const name = String(file.name || 'the file').slice(0, 60);
    let o;
    if (parsed.problem) {
      const all = parsed.problems || [parsed.problem];
      o = { title: all.length > 1 ? `This file has ${all.length} problems` : 'This file has a problem', message: `${all.map((p, i) => (all.length > 1 ? `${i + 1}. ${p}` : p)).join('\n\n')}${all.length > 5 && parsed.problems ? '\n\nOnly the first problems are listed: fix them and check again.' : ''}`, action: 'OK', cancel: 'Close' };
    } else {
      const n = parsed.entries.length;
      if (parsed.update) {
        const r = scApplyUpdate(parsed.entries, list());
        const more = [r.missing ? `${r.missing} ${r.missing === 1 ? 'is' : 'are'} not in the ${label('plan')}` : '', r.same ? `${r.same} would not change` : '', parsed.fields.length ? `${parsed.fields.length} ${parsed.fields.length === 1 ? 'field is' : 'fields are'} added or gain choices` : ''].filter(Boolean);
        o = { title: `This file is good: Update by id would change ${r.entries.length} ${r.entries.length === 1 ? 'entry' : 'entries'}`, message: `${n} ${n === 1 ? 'entry' : 'entries'} in ${name}${more.length ? `; ${more.join('; ')}` : ''}. Nothing was changed.`, action: 'OK', cancel: 'Close' };
      } else o = { title: `This file is good: it would add ${n} ${n === 1 ? 'entry' : 'entries'}`, message: `${countWords(parsed.entries)}, from ${name}. Nothing was changed.${parsed.fields && parsed.fields.length ? ` It adds ${parsed.fields.length} ${parsed.fields.length === 1 ? 'field' : 'fields'} or choices.` : ''}`, action: 'OK', cancel: 'Close' };
    }
    try { await host.ui.confirm(o); } catch (err) { /* closed */ }
  }
  async function importFile(file, mode) {
    if (!file || importing || (mode === 'update' || mode === 'check' ? !canEdit : !canAdd()) || (mode === 'replace' && !canClear())) return;
    if (file.size > SC_FILE.maxBytes) { say(`The file is too big: at most ${SC_FILE.maxBytes / 1024 / 1024} MB.`, 'danger'); return; }
    let text;
    try { text = await file.text(); } catch (err) { say('That file could not be read.', 'danger'); return; }
    const parsed = scParseFile(text, { label: (k) => kindWord(k), datesRequired: state.settings.datesRequired, fields: state.fields, mode });
    if (mode === 'check') { await showCheck(file, parsed); return; }
    if (parsed.problem) { say(parsed.problem, 'danger'); return; }
    if (parsed.fields && parsed.fields.length && !canFields()) { say('This file defines fields, and only someone who can change the columns and fields may add those. Take them out of the file, or ask them.', 'danger'); return; }
    if (mode === 'update') { await updateById(file, parsed); return; }
    if (mode === 'add' && state.entries.size + parsed.entries.length > SC_FILE.maxPlan) { say(`The plan holds at most ${SC_FILE.maxPlan} entries. This file would make ${state.entries.size + parsed.entries.length}.`, 'danger'); return; }
    const words = countWords(parsed.entries);
    const name = String(file.name || 'the file').slice(0, 60);
    let ok = false;
    try {
      ok = await host.ui.confirm(mode === 'add'
        ? { title: `Add ${words} to the ${label('plan')}?`, message: `From ${name}. What is in the ${label('plan')} now stays.`, action: 'Add to the plan' }
        : { title: `Replace the ${label('plan')}?`, message: `The ${state.entries.size} ${state.entries.size === 1 ? 'entry' : 'entries'} in the ${label('plan')} come off it and ${words} from ${name} go in.\n\nYou can undo this for ${UNDO_SECONDS} seconds.`, action: 'Replace the plan', kind: 'destructive' });
    } catch (err) { ok = false; }
    if (!ok) return;
    let entries;
    try {
      // The file's board is stored when it replaces the plan, or when the plan has no board of its own yet; an Add to a plan whose
      // board was edited keeps that board (work in a column it does not have lands in its first column, as scColumnOf says).
      const fileBoard = parsed.boards && parsed.boards[0] ? parsed.boards[0] : null;
      const newBoard = fileBoard && (mode === 'replace' || !state.boardRaw) ? fileBoard : null;
      entries = scImportEntries(parsed.entries, { mode, existing: list(), newId: () => host.util.id(), orderAfter: (prev) => host.util.order(prev, null), by: info.user.key, board: newBoard || currentBoard() });
      const plan = await applyImport(entries, mode, newBoard, parsed.fields);
      offerUndo(plan, mode === 'add' ? `Added ${words}.` : `Replaced the ${label('plan')} with ${words}.`);
    } catch (err) {
      say(err && err.status === 409 ? 'Someone else changed the plan just now. Nothing was imported. Try again.' : `Nothing was imported. ${(err && err.message) || ''}`.trim(), 'danger');
    }
  }
  // Update by id: only what the space owns (fields, days, owners, order) on the entries that are in the plan; nothing else about them.
  async function updateById(file, parsed) {
    const name = String(file.name || 'the file').slice(0, 60);
    const r = scApplyUpdate(parsed.entries, list());
    if (!r.entries.length && !parsed.fields.length) { say(r.missing ? `None of the ${parsed.entries.length} entries in the file is in the ${label('plan')}. Nothing was changed.` : 'Nothing in the file would change the plan.'); return; }
    const n = r.entries.length;
    let ok = false;
    try {
      ok = await host.ui.confirm({ title: `Update ${n} ${n === 1 ? 'entry' : 'entries'} by id?`, message: `From ${name}. This sets only the fields, days, ${label('owner', { many: true })} and order the file gives, on entries with the same id. Titles, columns and the rest stay.${r.missing ? `\n\n${r.missing} ${r.missing === 1 ? 'entry is' : 'entries are'} not in the ${label('plan')} and ${r.missing === 1 ? 'is' : 'are'} skipped.` : ''}\n\nYou can undo this for ${UNDO_SECONDS} seconds.`, action: 'Update by id' });
    } catch (err) { ok = false; }
    if (!ok) return;
    try {
      const plan = await applyImport(r.entries, 'update', null, parsed.fields);
      offerUndo(plan, `Updated ${n} ${n === 1 ? 'entry' : 'entries'} by id.`);
    } catch (err) {
      say(err && err.status === 409 ? 'Someone else changed the plan just now. Nothing was imported. Try again.' : `Nothing was imported. ${(err && err.message) || ''}`.trim(), 'danger');
    }
  }
  let picker = null;
  function pickFile(mode) {
    if ((mode === 'update' || mode === 'check' ? !canEdit : !canAdd()) || importing || (mode === 'replace' && !canClear())) return;
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
    const items = [{ id: 'export', label: 'Export as JSON', icon: 'file-export', disabled: !state.entries.size, hint: state.entries.size ? '' : 'Nothing yet', onClick: exportPlan }];
    if (canEdit) items.push({ id: 'check', label: 'Check file', icon: 'file-circle-check', disabled: importing, onClick: () => pickFile('check') });
    if (canEdit) items.push({ id: 'import-update', label: 'Import JSON: update by id', icon: 'file-import', disabled: importing, onClick: () => pickFile('update') });
    if (canAdd()) items.push({ id: 'import-add', label: 'Import JSON: add to the plan', icon: 'file-import', disabled: importing, onClick: () => pickFile('add') });
    if (canAdd() && canClear()) items.push({ id: 'import-replace', label: 'Import JSON: replace the plan', icon: 'file-import', danger: true, disabled: importing, onClick: () => pickFile('replace') });
    return items;
  }
  host.on('toolbar', (e) => {
    if (takeFilter(e)) return;
    if (e.id === 'plan-pull') { pullNow(); return; }
    if (e.id !== 'plan-more') return;
    host.menu.show({ id: 'plan-more', at: { x: Number(e.x) || 0, y: 4 }, items: moreItems() });
  });

  // --- settings, phases ---------------------------------------------------------------------------------------------------------
  function takeSettings(v) {
    const s = v && typeof v === 'object' ? v : {};
    state.settings = {
      datesRequired: s.datesRequired !== false,
      dependencies: s.dependencies !== false,
      progressBy: s.progressBy === 'work' ? 'work' : 'milestones',
      defaultView: s.defaultView === 'list' || s.defaultView === 'board' ? s.defaultView : 'timeline',
      boardColumns: s.boardColumns === 'priority' ? 'priority' : 'stages',
      sizing: s.sizing === 'points' || s.sizing === 'tshirt' ? s.sizing : 'off',
      tags: (Array.isArray(s.tags) ? s.tags : []).filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string'),
    };
    state.fields = scFieldsWithSize(state.fields, state.settings.sizing); // the setting's size field, until a plan stores its own
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
    if (state.loaded && (state.view === 'timeline' || state.view === 'list')) render();
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
      const [people, settings, pull, , canFollow] = await Promise.all([
        host.people().catch(() => []),
        host.settings.get().catch(() => null),
        host.issues && host.issues.status ? host.issues.status().catch(() => null) : null,
        loadEntries(),
        host.setup && host.setup.can ? host.setup.can().catch(() => false) : false,
      ]);
      state.canFollow = canFollow === true;
      takePull(pull);
      state.people = people;
      takeSettings(settings);
      takePhases();
      loadFilter();
      try { const kept = localStorage.getItem(ROWS_KEY) || ''; state.rows = scRowsByOk(kept) ? kept : ''; } catch (err) { state.rows = ''; }
      // The view: the person's own choice, else the List on a phone, else the plan's default.
      let mine = '';
      try { mine = localStorage.getItem(VIEW_KEY) || ''; } catch (err) { /* none */ }
      state.view = mine === 'list' || mine === 'timeline' || mine === 'board' ? mine : pullOn() ? 'board' : narrow ? 'list' : state.settings.defaultView;
      await Promise.all([...new Set(['plus', 'pen', 'trash', 'rotate-left', 'circle-check', 'link', 'right-left', 'file-export', 'file-import', 'file-circle-check', 'flag', 'bars-progress', 'note-sticky', 'diagram-project', 'chart-gantt', 'list', 'table-columns', 'arrow-left', 'arrow-right', 'square-check', 'square', 'rotate', 'arrow-up-right-from-square', 'triangle-exclamation', 'sliders', 'arrow-up', 'arrow-down', ...state.settings.tags.map((t) => t.icon).filter(Boolean)])].map(wantIcon));
      state.loaded = true;
      render();
      loadLinks().catch(() => {});
      if (!wired) {
        wired = true;
        host.settings.onChange((v) => { takeSettings(v); if (state.loaded) render(); });
        // A pull runs on the server's timer: look again each minute, and read the plan when it has moved.
        // Set up is the host's panel: the 'setup' event says it closed. Coming back to the page (a click here, or the tab shown again) looks at once too.
        const again = () => { if ($('app') && !document.hidden) refreshPull(true); };
        window.addEventListener('focus', again);
        document.addEventListener('visibilitychange', again);
        host.on('setup', () => refreshPull(true)); // Set up closed: the Follow button there acts at once
        const t = setInterval(() => { if (!$('app')) return void clearInterval(t); if (!document.hidden) refreshPull(true); }, 60000);
      }
      if (state.openWanted) { const f = state.openWanted; state.openWanted = null; f(); }
    } catch (err) {
      $('app').hidden = true;
      showMsg(`The ${label('plan')} could not load`, err.message, load);
    }
  }
  await load();
})();
