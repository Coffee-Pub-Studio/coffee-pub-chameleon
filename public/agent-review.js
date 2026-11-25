// The review of what agents ask and what they changed (plan-agent-edit-delete.md, "The shared piece"): one drawn piece used in two
// places, the agent's page in Manage > Users (both kinds of agent, agent-page.js) and a space's Agents view (space.js, through
// mountSpaceReview below, for that space's approvers: owners, the admin and its moderators).
//
//   createReview({ api, say, hour12, word, answerUrl(ask), undoUrl(change), textOf(change)?, beforeUndo(change)?, onChanged(), toastUndo? })
//     (toastUndo: after a delete, a "Deleted." toast with Undo; off in the space's view, whose list has the Undo in sight, since a
//     toast can't sit above a modal dialog)
//     drawWaiting(ul, asks, status)   Waiting for you: each ask in words with Approve and Decline. When the server says it can't be
//                                     approved now (`decidable` false), its `why` stands greyed in Approve's place; Decline stays.
//                                     Approving a delete ask opens the approval dialog first; any other ask is answered at once.
//     drawDone(ul, changes, status)   What it changed: each change in words with Undo, or its `why` greyed in Undo's place.
//   approvalDialog(ask, { word })     the question before a delete: what it is, where, who made it, what goes with it, the agent's
//                                     own words, then Delete and Decline. Resolves 'approve', 'decline' or null (closed).
//   mountSpaceReview({ nav, api, word, hour12, space(), mayReview() })   the space's Agents view and its nav entry.
//
// Text only: every value from the server (a title, a name, the agent's reason) goes in through textContent. The words of an entry are
// the server's (`text`, `why`); nothing here makes up a title from an id.
import { api as brandApi, actionToast, word as brandWord } from '/brand.js';

// How long ago, in plain words: "just now", "2 minutes ago", "3 hours ago", "4 days ago".
export function agoWords(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  const n = (v, unit) => `${v} ${unit}${v === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return n(Math.floor(s / 60), 'minute');
  if (s < 86400) return n(Math.floor(s / 3600), 'hour');
  return n(Math.floor(s / 86400), 'day');
}
// A time as the lists show it: "Nov 16, 3:40 PM", the year only when it is not this one.
function whenWords(iso, hour12 = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' };
  return d.toLocaleString([], { month: 'short', day: 'numeric', ...year, hour: 'numeric', minute: '2-digit', hour12 });
}
const make = (doc, tag, cls, text) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (doc, cls, label) => { const b = make(doc, 'button', cls, label); b.type = 'button'; return b; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };
// The agent's name with its mark, as the lists name it.
const agentWords = (ask) => `${(ask.agent && ask.agent.name) || 'An agent'} (agent)`;

// What goes with a delete, one line each with its icon, for the dialog's list. Only what the server gave (a person who may not
// read the module gets none of it).
export function approvalLines(ask, word = brandWord) {
  const a = ask && typeof ask === 'object' ? ask : {};
  const lines = [];
  const where = [a.moduleName ? `In ${a.moduleName}` : '', a.space && a.space.name ? `in ${a.space.name}` : ''].filter(Boolean).join(', ');
  if (where) lines.push(['puzzle-piece', where]);
  if (a.madeBy && a.madeBy.name) lines.push(['user', `Made by ${a.madeBy.name}`]);
  const g = a.goesWith || {};
  const kids = Number(g.children) || 0;
  if (kids > 0) lines.push(['layer-group', kids === 1 ? '1 thing that belongs to it goes too' : `${kids} things that belong to it go too`]);
  const held = Number(g.holders) || 0;
  if (held > 0) lines.push(['clone', held === 1 ? 'It is shown in 1 other place, which will show it is gone' : `It is shown in ${held} other places, which will show it is gone`]);
  if (Number(a.links) > 0) lines.push(['link', `${plural(Number(a.links), word('object'), word('object', { many: true }))} link to it`]);
  return lines;
}

// The approval dialog: the Dialogs family's question shell (.sdk-dialog-confirm, as confirm.js), with Decline and Delete in place
// of Cancel and the action, because declining is an answer and closing is not. Escape and the close button close it without an
// answer; a click outside does nothing. `run(decision)` sends the answer while the dialog stays open: if it throws, its message
// shows under the question and, for a 409 (the ask ended), both answers turn off. Resolves the decision sent, or null.
export function approvalDialog(ask, { word = brandWord, run, doc = document } = {}) {
  return new Promise((resolve) => {
    const id = `agent-approve-${Math.random().toString(36).slice(2, 8)}`;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const dlg = make(doc, 'dialog', 'sdk-dialog sdk-dialog-confirm agent-approve');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `${id}-t`);
    dlg.setAttribute('aria-describedby', `${id}-d`);
    dlg.dataset.kind = 'destructive';
    const head = make(doc, 'div', 'sdk-dialog-head');
    const kind = String(ask.kind || word('object'));
    const title = make(doc, 'h2', 'sdk-dialog-title', ask.title ? `Delete the ${kind} "${ask.title}"?` : `Delete this ${kind}?`);
    title.id = `${id}-t`;
    const close = button(doc, 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.append(title, close);
    const body = make(doc, 'div', 'sdk-dialog-body');
    body.id = `${id}-d`;
    body.append(make(doc, 'p', '', `${agentWords(ask)} asks to delete it. Nothing is deleted until you say so.`));
    const lines = approvalLines(ask, word);
    if (lines.length) {
      const ul = make(doc, 'ul', 'sdk-confirm-effects');
      for (const [icon, text] of lines) {
        const li = make(doc, 'li');
        const i = make(doc, 'i', `fa-solid fa-${icon} fa-fw`);
        i.setAttribute('aria-hidden', 'true');
        li.append(i, make(doc, 'span', '', text));
        ul.append(li);
      }
      body.append(ul);
    }
    if (ask.reason) {
      const said = make(doc, 'figure', 'agent-approve-said');
      said.append(make(doc, 'figcaption', '', `${agentWords(ask)} says:`), make(doc, 'blockquote', '', String(ask.reason)));
      body.append(said);
    }
    body.append(make(doc, 'p', '', 'You can undo it for 7 days.'));
    const problem = make(doc, 'p', 'sdk-error');
    problem.setAttribute('role', 'alert');
    problem.hidden = true;
    body.append(problem);
    const foot = make(doc, 'div', 'sdk-dialog-foot');
    const decline = button(doc, 'btn', 'Decline');
    decline.dataset.approveAnswer = 'decline';
    const del = button(doc, 'btn btn-danger', 'Delete');
    del.dataset.approveAnswer = 'approve';
    foot.append(decline, del);
    dlg.append(head, body, foot);

    let settled = false;
    let busy = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    const answer = async (decision) => {
      if (busy) return;
      busy = true;
      del.disabled = true;
      decline.disabled = true;
      dlg.setAttribute('aria-busy', 'true');
      try {
        if (run) await run(decision);
        done(decision);
      } catch (err) {
        problem.textContent = (err && err.message) || 'It could not be done.';
        problem.hidden = false;
        const ended = err && err.status === 409; // answered elsewhere, run out, or changed since: nothing more to answer
        del.disabled = ended;
        decline.disabled = ended;
        (ended ? close : del).focus();
      } finally {
        busy = false;
        dlg.removeAttribute('aria-busy');
      }
    };
    const focusables = () => [...dlg.querySelectorAll('button')].filter((e) => !e.disabled);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(null); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    close.addEventListener('click', () => done(null));
    decline.addEventListener('click', () => answer('decline'));
    del.addEventListener('click', () => answer('approve'));
    doc.body.append(dlg);
    try { dlg.showModal(); } catch { dlg.remove(); resolve(null); return; }
    decline.focus(); // as a confirm that removes: focus off the action, so Enter does not delete
  });
}

// The two lists. `answerUrl(ask)` and `undoUrl(change)` are the routes of the place drawing them (the agent's page or the space).
export function createReview({ api = brandApi, say = null, hour12 = () => true, word = brandWord, answerUrl, undoUrl, textOf = (c) => String(c.text || ''), beforeUndo = null, onChanged = () => {}, toastUndo = true, doc = document } = {}) {
  const asks = new Map();
  const changes = new Map();
  const statusOf = new WeakMap(); // a list -> its status line
  const tell = (el, text, error = false) => {
    if (!el) return;
    if (say) { say(el, text, error); return; }
    el.textContent = text;
    el.classList.toggle('error', error);
  };

  async function answer(ask, decision, status) {
    tell(status, '');
    if (decision === 'approve' && ask.ask === 'delete') {
      let made = null;
      const sent = await approvalDialog(ask, {
        word,
        doc,
        run: async (d) => {
          const out = await api('POST', answerUrl(ask), d === 'approve' ? { decision: 'approve', version: ask.version, tz: timeZone() } : { decision: 'decline' });
          made = out && out.change ? out.change : null;
        },
      });
      if (sent === 'approve') {
        tell(status, 'Deleted');
        if (toastUndo && made && made.undoable) {
          actionToast({ kind: 'ok', icon: 'circle-check', title: 'Deleted.', actions: [{ id: 'undo', label: 'Undo' }], onAction: () => { undo(made, status); } });
        }
      } else if (sent === 'decline') tell(status, 'Declined');
      onChanged(); // drawn again whatever happened: a 409 may have ended it while the dialog was open
      return;
    }
    for (const b of doc.querySelectorAll(`[data-ask="${CSS.escape(ask.id)}"]`)) b.disabled = true;
    try {
      await api('POST', answerUrl(ask), decision === 'approve' ? { decision: 'approve', ...(Number.isSafeInteger(ask.version) ? { version: ask.version } : {}) } : { decision });
      tell(status, decision === 'approve' ? 'Approved' : 'Declined');
    } catch (err) {
      tell(status, err.message, true); // the server's plain sentence (409: answered, run out or not possible)
    }
    onChanged();
  }

  async function undo(change, status) {
    tell(status, '');
    if (beforeUndo && !(await beforeUndo(change))) return;
    try {
      await api('POST', undoUrl(change), { tz: timeZone() });
      tell(status, 'Undone');
    } catch (err) {
      tell(status, err.message, true);
    }
    onChanged();
  }

  function wire(ul) {
    if (ul.dataset.reviewWired) return;
    ul.dataset.reviewWired = '1';
    ul.addEventListener('click', (event) => {
      const a = event.target.closest('[data-agent-answer]');
      if (a && !a.disabled) { const ask = asks.get(a.dataset.ask); if (ask) answer(ask, a.dataset.agentAnswer, statusOf.get(ul)); return; }
      const u = event.target.closest('[data-agent-undo]');
      if (u && !u.disabled) { const c = changes.get(u.dataset.agentUndo); if (c) undo(c, statusOf.get(ul)); }
    });
  }

  function drawWaiting(ul, list, status) {
    wire(ul);
    statusOf.set(ul, status);
    const waiting = (list || []).filter((a) => a && a.state === 'waiting');
    ul.replaceChildren();
    for (const a of waiting) {
      asks.set(a.id, a);
      const li = make(doc, 'li', 'agent-ask');
      li.dataset.agentAsk = a.id;
      const what = make(doc, 'span', 'agent-ask-what');
      const ends = a.expiresAt ? whenWords(a.expiresAt, hour12()) : '';
      what.append(make(doc, 'span', '', String(a.text || '')), make(doc, 'span', 'agent-ask-when', [a.at ? `Asked ${agoWords(a.at)}` : '', ends ? `Runs out ${ends}` : ''].filter(Boolean).join(' · ')));
      if (a.reason) what.append(make(doc, 'span', 'agent-ask-said', `"${a.reason}"`));
      const buttons = make(doc, 'span', 'agent-ask-buttons');
      const refused = a.decidable === false && typeof a.why === 'string' && a.why;
      if (refused) {
        const why = make(doc, 'span', 'agent-review-why', a.why);
        why.dataset.agentWhy = '';
        buttons.append(why);
      } else {
        const b = button(doc, 'btn btn-primary btn-small', 'Approve');
        b.dataset.agentAnswer = 'approve';
        b.dataset.ask = a.id;
        buttons.append(b);
      }
      const d = button(doc, 'btn btn-small', 'Decline');
      d.dataset.agentAnswer = 'decline';
      d.dataset.ask = a.id;
      buttons.append(d);
      li.append(what, buttons);
      ul.append(li);
    }
    return waiting.length;
  }

  function drawDone(ul, list, status) {
    wire(ul);
    statusOf.set(ul, status);
    ul.replaceChildren();
    for (const c of list || []) {
      changes.set(c.id, c);
      const li = make(doc, 'li', `agent-change${c.undone ? ' is-undone' : ''}`);
      li.dataset.agentChange = c.id;
      const what = make(doc, 'span', 'agent-change-what');
      const by = c.undoneBy && c.undoneBy.name ? ` by ${c.undoneBy.name}` : '';
      const when = [whenWords(c.at, hour12()), c.undone ? `Undone${by}${c.undoneAt ? ` ${agoWords(c.undoneAt)}` : ''}` : ''].filter(Boolean).join(' · ');
      what.append(make(doc, 'span', 'agent-change-text', textOf(c)), make(doc, 'span', 'agent-change-when', when));
      li.append(what);
      if (!c.undone) {
        const buttons = make(doc, 'span', 'agent-change-buttons');
        if (c.undoable) {
          const b = button(doc, 'btn btn-small', 'Undo');
          b.dataset.agentUndo = c.id;
          buttons.append(b);
        } else {
          const why = make(doc, 'span', 'agent-review-why', String(c.why || 'It can no longer be undone.'));
          why.dataset.agentWhy = '';
          buttons.append(why);
        }
        li.append(buttons);
      }
      ul.append(li);
    }
    return ul.children.length;
  }

  return { drawWaiting, drawDone, undo };
}

// --- a space's Agents view ----------------------------------------------------------------------------------------------------------
// One entry in the top bar's right zone, beside Set up (the nav registry; no bar of its own): "Agents", with the count of asks
// waiting here on it. It shows to this space's approvers while an agent has asked something here or changed something here in the
// last days (GET /api/spaces/:id/agent-review), and opens the view: Waiting for you, then What it changed, in one dialog (the
// object picker's shell: 560px, full screen on a phone). Closed with Close or Escape; a click outside does nothing.
// `space()` is the space the page is in (or null); `mayReview()` whether this person approves there (owners, the admin, its
// moderators). Returns { refresh(), open(askId?), forget() }.
export function mountSpaceReview({ nav, api = brandApi, word = brandWord, hour12 = () => true, space, mayReview, doc = document }) {
  let state = null; // { space, waiting, done, days } for the space shown
  let view = null; // { dlg, waitingList, doneList, ... } while open
  let asking = 0;
  const id = 'agent-review';
  const enc = encodeURIComponent;
  const shown = () => Boolean(state && space() && state.space === space().id && (state.waiting.length || state.done.length));
  const label = () => {
    const n = state ? state.waiting.length : 0;
    return n ? `Agents, ${plural(n, 'ask', 'asks')} waiting for you` : 'Agents';
  };
  nav.register({ id, bar: 'primary', zone: 'right', group: 'space', groupOrder: 85, order: 2, place: 'end', icon: 'robot', label: 'Agents', visible: shown, onClick: () => open() });

  const review = createReview({
    api,
    word,
    hour12,
    doc,
    answerUrl: (a) => `/api/spaces/${enc(a.space.id)}/asks/${enc(a.id)}`,
    undoUrl: (c) => `/api/spaces/${enc(c.space.id)}/changes/${enc(c.id)}/undo`,
    toastUndo: false,
    onChanged: () => { refresh(); try { window.appRefreshNotices?.(); } catch { /* the bell catches up on its next count */ } },
  });

  function paintEntry() {
    const t = nav.get(id);
    if (!t) return;
    const n = state ? state.waiting.length : 0;
    if (t.label !== label()) nav.register({ ...t, label: label() });
    nav.setBadge(id, n, n ? { label: `${plural(n, 'ask', 'asks')} waiting` } : {});
    nav.draw();
  }

  async function refresh() {
    const s = space();
    if (!s || !mayReview()) { state = null; paintEntry(); if (view) closeView(); return; }
    const mine = ++asking;
    let got;
    try { got = await api('GET', `/api/spaces/${enc(s.id)}/agent-review`); } catch { if (mine === asking) { state = null; paintEntry(); } return; }
    if (mine !== asking || !space() || space().id !== s.id) return;
    state = { space: s.id, waiting: got.waiting || [], done: got.done || [], days: Number.isInteger(got.days) ? got.days : 7 };
    paintEntry();
    if (view) paintView();
  }

  function paintView() {
    if (!view || !state) return;
    const n = review.drawWaiting(view.waitingList, state.waiting, view.waitingStatus);
    view.waitingEmpty.hidden = n > 0;
    const m = review.drawDone(view.doneList, state.done, view.doneStatus);
    view.doneEmpty.hidden = m > 0;
    view.doneHint.textContent = `What agents added, changed or deleted here in the last ${state.days} days. Undo puts back what was there.`;
    if (view.focusAsk) {
      const li = view.waitingList.querySelector(`[data-agent-ask="${CSS.escape(view.focusAsk)}"]`);
      view.focusAsk = '';
      if (li) { li.classList.add('is-asked'); li.scrollIntoView({ block: 'nearest' }); (li.querySelector('[data-agent-answer]') || li).focus?.(); }
    }
  }

  function closeView() {
    if (!view) return;
    const { dlg, opener } = view;
    view = null;
    if (dlg.open) dlg.close();
    dlg.remove();
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  async function open(askId = '') {
    if (view) { if (askId) { view.focusAsk = askId; paintView(); } return; }
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : nav.elementOf?.(id) || null;
    const dlg = make(doc, 'dialog', 'sdk-dialog sdk-dialog-pick agent-review-sheet');
    dlg.setAttribute('aria-labelledby', 'agent-review-title');
    const head = make(doc, 'div', 'sdk-dialog-head');
    const title = make(doc, 'h2', 'sdk-dialog-title', 'Agents');
    title.id = 'agent-review-title';
    const close = button(doc, 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    head.append(title, close);
    const body = make(doc, 'div', 'sdk-dialog-body agent-review-body');
    const section = (heading, emptyText, label) => {
      const wrap = make(doc, 'section', 'agent-review-part');
      const h = make(doc, 'h3', 'agent-review-heading', heading);
      const hint = make(doc, 'p', 'hint');
      const empty = make(doc, 'p', 'hint', emptyText);
      empty.hidden = true;
      const ul = make(doc, 'ul', 'agent-asks');
      ul.setAttribute('aria-label', label);
      const status = make(doc, 'p', 'status');
      status.setAttribute('role', 'status');
      wrap.append(h, hint, empty, ul, status);
      body.append(wrap);
      return { hint, empty, ul, status };
    };
    const w = section('Waiting for you', 'Nothing is waiting for you.', 'Waiting for you');
    w.hint.hidden = true;
    const d = section('What it changed', 'No agent has changed anything here lately.', 'What it changed, newest first');
    d.ul.className = 'agent-changes';
    dlg.dataset.agentReview = '';
    dlg.append(head, body);
    view = { dlg, opener, waitingList: w.ul, waitingStatus: w.status, waitingEmpty: w.empty, doneList: d.ul, doneStatus: d.status, doneEmpty: d.empty, doneHint: d.hint, focusAsk: askId };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!doc.querySelector('dialog.agent-approve[open]')) closeView(); });
    close.addEventListener('click', () => closeView());
    doc.body.append(dlg);
    try { dlg.showModal(); } catch { view = null; dlg.remove(); return; }
    close.focus();
    paintView();
    await refresh();
  }

  return { refresh, open, forget: () => { asking += 1; state = null; closeView(); paintEntry(); } };
}

// The address that opens a space's Agents view at one ask, as the bell line carries it: "/?agents=<space>#ask-<id>". Null for
// anything else.
export function reviewAddress(search = '', hash = '') {
  const spaceId = new URLSearchParams(search).get('agents');
  if (!spaceId || !/^[A-Za-z0-9_-]{1,64}$/.test(spaceId)) return null;
  const m = /^#ask-([a-f0-9]{1,32})$/.exec(String(hash || ''));
  return { space: spaceId, ask: m ? m[1] : '' };
}
