// An agent's page, in Manage > Users (plan-agent-access.md, step 2): its name, its token (made here, shown once), Turn off and
// Delete, and What it did, the log the server keeps. The page's own markup is #agent-page in admin.html; admin.js hands it the
// agent (a row of Users) and what it needs to talk to the server and to say things.
//
// Text only, everywhere: every value from the API or the log (a name, an address, a route, an action, a message) goes in through
// textContent, never as markup (tools/check-agent-pages.mjs drives a script-looking name and address through it).
import { confirmDialog } from '/confirm.js';

const MAX_NAME = 40;
// The agent's name as a person reads it, with the mark that it is not a person.
export const agentName = (user) => `${String((user && (user.displayName || user.key)) || 'Agent')} (agent)`;

// A time as the page shows it: "Nov 16, 3:40 PM", the year only when it is not this one.
export function whenText(iso, hour12 = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' };
  return d.toLocaleString([], { month: 'short', day: 'numeric', ...year, hour: 'numeric', minute: '2-digit', hour12 });
}
const dayText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

// What each of the gate's routes reads like in the log (the route is the gate's pattern, as the server writes it). `w` is the
// page's word(): a module, an object and a space read as this environment's own words.
const READS = {
  '/api/agent/me': () => 'Looked at its own limits',
  '/api/modules/:id/context': (w) => `Read what ${w('module', { a: true })} is for`,
  '/api/modules/:id/data': (_w, name) => (name ? `Read ${name} data` : 'Read data'),
  '/api/modules/:id/data/:key': (_w, name) => (name ? `Read ${name} data` : 'Read data'),
  '/api/objects/search': (w) => `Searched ${w('object', { many: true })}`,
  '/api/objects/links': (w) => `Read what ${w('object', { a: true })} links to`,
  '/api/objects/kinds': (w) => `Read the kinds of ${w('object')}`,
  '/api/objects/resolve': (w) => `Looked up ${w('object', { many: true })}`,
  '/api/spaces/:id/actions': () => 'Listed what it can ask for',
  '/api/spaces/:id/action/:requestId': () => 'Checked on a request',
};
// Chat lines depend on the method (GET reads, POST posts), so they are told apart in logLine, not in READS.
const CHAT_ROUTE = '/api/spaces/:id/chat';
const known = (route) => typeof route === 'string' && Object.hasOwn(READS, route);
// "addMilestone" -> "add milestone"; the module's id before the colon is left out.
const actionWords = (action) => {
  const name = String(action || '').split(':').pop();
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim() || 'something';
};

// A module's id as a name ("my-notes" -> "My Notes"): the page has no module list, so the id stands for it. Only a safe id
// (as the server writes it) counts; anything else is no module.
const moduleName = (id) => (typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id) ? id.split('-').filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') : '');

// One log line (an entry of GET /api/users/:key/agent-log) as { text, note, detail }: what it did in plain words, whether it is
// a note (a line that counted against nothing), and the rest of it (when, address, how it went). `spaceName(id)` gives a space's name.
export function logLine(entry, { spaceName = () => '', hour12 = true, word = (w) => w } = {}) {
  const e = entry && typeof entry === 'object' ? entry : {};
  const status = Number.isInteger(e.status) ? e.status : null;
  const parts = [whenText(e.at, hour12)];
  if (e.address) parts.push(String(e.address));
  if (e.kind === null || e.kind === undefined) {
    // A note: the agent went over its limit, or its token was refused.
    const text = status === 429 ? 'Over its limit' : status === 401 ? 'Token refused' : 'Note';
    return { text, note: true, detail: parts.filter(Boolean).join(' · ') };
  }
  const where = e.space ? ` in ${spaceName(e.space) || `${word('space', { a: true })} that is gone`}` : '';
  let text;
  let refused = false;
  if (e.route === CHAT_ROUTE && e.method === 'GET') text = `Read Chat${where}`;
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 200) text = `Posted in Chat${where}`;
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 403) text = `Refused post${where}`;
  else if (e.route === '/api/spaces/:id/action') text = `Ask for ${actionWords(e.action)}${where}`;
  else if (known(e.route)) text = `${READS[e.route](word, moduleName(e.module))}${where}`;
  else { refused = true; text = `Refused: ${`${String(e.method || '')} ${String(e.route || '')}`.trim()}`; } // a route off the gate's list: the server writes its fixed shape
  if (status !== null && status >= 400) parts.push(refused ? String(status) : `didn't work (${status})`);
  const detail = parts.filter(Boolean).join(' · ');
  // The server writes a read's count as a number and a post's id as a string; only the count is shown.
  let message = typeof e.message === 'string' && e.message ? e.message : '';
  if (e.route === CHAT_ROUTE && e.method === 'GET') { const n = e.message; message = Number.isInteger(n) && n >= 0 ? `${n} ${n === 1 ? 'message' : 'messages'}` : ''; }
  else if (e.route === CHAT_ROUTE && e.method === 'POST' && status === 200) message = ''; // the message id means nothing to a person
  return { text, note: false, detail, message };
}

const make = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

// The token, once: a dialog with the token in a box, Copy and the plain warning. The only place the token is ever on a page.
export function showToken({ token, expiresAt, agent, hour12 = true }) {
  return new Promise((resolve) => {
    const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm agent-token-dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'agent-token-title');
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', `Token for ${agentName(agent)}`);
    title.id = 'agent-token-title';
    head.append(title);
    const body = make('div', 'sdk-dialog-body');
    const warning = make('p', 'agent-token-warning', 'This is shown once. If you lose it, make a new one; the old one then stops working.');
    const box = make('code', 'key agent-token-value', token);
    box.tabIndex = 0;
    const row = make('div', 'row');
    const copy = make('button', 'btn btn-small', 'Copy');
    copy.type = 'button';
    copy.dataset.agent = 'copy';
    const status = make('span', 'status');
    status.setAttribute('role', 'status');
    row.append(copy, status);
    const ends = make('p', 'hint', `It works until ${dayText(expiresAt) || 'its end'}. Keep it as a secret, never in a chat.`);
    body.append(warning, box, row, ends);
    const foot = make('div', 'sdk-dialog-foot');
    const done = make('button', 'btn btn-primary', 'Done');
    done.type = 'button';
    done.dataset.agent = 'token-done';
    foot.append(done);
    dlg.append(head, body, foot);
    const root = document.documentElement;
    const was = root.style.overflow;
    const close = () => {
      if (dlg.open) dlg.close();
      root.style.overflow = was;
      dlg.remove();
      if (opener && opener.isConnected) opener.focus();
      resolve();
    };
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(token);
        status.textContent = 'Copied';
      } catch {
        // No clipboard here: the box is selected so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        status.textContent = 'Select and copy it by hand';
      }
    });
    done.addEventListener('click', close);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    dlg.showModal();
    copy.focus();
  });
}

// Wires #agent-page. `ctx`: { api, say(el, text, error), spaces() (the spaces as the page knows them), hour12(), word, onChanged(user)
// (a name or the switch changed), onDeleted(key) }. Returns { open(user), close() }.
export function mountAgentPage(ctx) {
  const $ = (sel) => document.querySelector(`#agent-page ${sel}`);
  let agent = null;
  let oldest = null; // the `at` of the oldest line shown, for the next page
  let token = null; // GET /api/users/:key/token's answer

  const spaceName = (id) => { const s = ctx.spaces().find((r) => r.id === id); return s ? s.name : ''; };
  const speak = (text, error = false) => ctx.say($('[data-agent-status]'), text, error);

  function paint() {
    $('[data-agent-title]').textContent = agentName(agent);
    const name = $('[data-agent-name]');
    if (document.activeElement !== name) name.value = agent.displayName || '';
    const off = agent.off === true;
    const chip = $('[data-agent-state]');
    chip.textContent = off ? 'Off' : 'On';
    chip.dataset.tone = off ? 'warn' : 'ok';
    $('[data-agent="off"]').textContent = off ? 'Turn on' : 'Turn off';
    $('[data-agent="off"]').classList.toggle('btn-primary', off);
    $('[data-agent-off-hint]').textContent = off
      ? 'It is off. Its token does nothing until you turn it on.'
      : 'Turning it off stops its token working at once. You can turn it on again.';
    const live = token && Date.parse(token.expiresAt) > Date.now();
    const post = $('[data-agent-chat-post]');
    post.checked = agent.chatPost === true;
    $('[data-agent-token-state]').textContent = !token ? 'No token yet.' : live ? `The token works until ${dayText(token.expiresAt)}.` : `The token ended ${dayText(token.expiresAt)}.`;
    $('[data-agent-used]').textContent = !token ? '' : token.lastUsedAt
      ? `Last used ${whenText(token.lastUsedAt, ctx.hour12())}${token.lastAddress ? ` from ${token.lastAddress}` : ''}`
      : 'Not used yet.';
    $('[data-agent="make"]').textContent = token ? 'Make a new token' : 'Make token';
    $('[data-agent="make"]').classList.toggle('btn-primary', !token);
    $('[data-agent="revoke"]').hidden = !token;
    $('[data-agent-make-hint]').textContent = token ? 'A new token ends the old one.' : `Claude uses the token to work in the ${ctx.word('space', { many: true })} you add it to.`;
  }

  async function loadToken() {
    try { token = (await ctx.api('GET', `/api/users/${encodeURIComponent(agent.key)}/token`)).token; } catch (err) { token = null; speak(err.message, true); }
  }

  async function loadLog(more) {
    const list = $('[data-agent-log]');
    const key = agent.key;
    let answer;
    try {
      answer = await ctx.api('GET', `/api/users/${encodeURIComponent(key)}/agent-log${more && oldest ? `?before=${encodeURIComponent(oldest)}` : ''}`);
    } catch (err) {
      $('[data-agent-log-status]').textContent = err.message;
      return;
    }
    if (!agent || agent.key !== key) return;
    $('[data-agent-log-status]').textContent = '';
    if (!more) { list.replaceChildren(); oldest = null; }
    for (const entry of answer.entries) {
      const line = logLine(entry, { spaceName, hour12: ctx.hour12(), word: ctx.word });
      const li = make('li', `agent-log-line${line.note ? ' is-note' : ''}`);
      li.append(make('span', 'agent-log-what', line.text), make('span', 'agent-log-detail', line.detail));
      if (line.message) li.append(make('span', 'agent-log-detail', line.message));
      list.append(li);
      oldest = entry.at;
    }
    $('[data-agent-log-empty]').hidden = list.children.length > 0;
    $('[data-agent="older"]').hidden = answer.more !== true;
  }

  async function make_() {
    $('[data-agent="make"]').disabled = true;
    try {
      const made = await ctx.api('POST', `/api/users/${encodeURIComponent(agent.key)}/token`);
      await loadToken();
      paint();
      await showToken({ token: made.token, expiresAt: made.expiresAt, agent, hour12: ctx.hour12() });
    } catch (err) {
      speak(err.message, true);
    } finally {
      $('[data-agent="make"]').disabled = false;
    }
  }

  // Post in Chat: the switch says what the server will hold; a refusal shows the server's sentence and the switch goes back.
  $('[data-agent-chat-post]').addEventListener('change', async (event) => {
    const box = event.target;
    if (!agent) return;
    const want = box.checked;
    box.disabled = true;
    try {
      const { user } = await ctx.api('PATCH', `/api/users/${encodeURIComponent(agent.key)}`, { chatPost: want });
      agent = { ...agent, ...user };
      ctx.onChanged(agent);
      speak(agent.chatPost ? 'It can post in Chat' : 'It can no longer post in Chat');
    } catch (err) {
      speak(err.message, true);
    } finally {
      box.checked = agent ? agent.chatPost === true : false;
      box.disabled = false;
    }
  });
  document.querySelector('#agent-page').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-agent]');
    if (!button || !agent) return;
    const what = button.dataset.agent;
    try {
      if (what === 'make') await make_();
      else if (what === 'revoke') {
        if (!await confirmDialog({ title: `Revoke the token of ${agentName(agent)}?`, message: 'It stops working at once. You can make a new one.', action: 'Revoke', kind: 'destructive' })) return;
        await ctx.api('DELETE', `/api/users/${encodeURIComponent(agent.key)}/token`);
        token = null;
        paint();
        speak('Token revoked');
      } else if (what === 'off') {
        const { user } = await ctx.api('PATCH', `/api/users/${encodeURIComponent(agent.key)}`, { off: agent.off !== true });
        agent = { ...agent, ...user };
        ctx.onChanged(agent);
        paint();
        speak(agent.off ? 'Turned off' : 'Turned on');
        loadLog(false);
      } else if (what === 'delete') {
        if (!await confirmDialog({ title: `Delete ${agentName(agent)}?`, message: 'Its token stops working. What it added keeps its name.', action: 'Delete', kind: 'final', typed: String(agent.displayName || agent.key) })) return;
        const key = agent.key;
        await ctx.api('DELETE', `/api/users/${encodeURIComponent(key)}`);
        agent = null;
        ctx.onDeleted(key);
      } else if (what === 'older') await loadLog(true);
      else if (what === 'rename') {
        const value = $('[data-agent-name]').value.trim();
        if (!value) { speak('Give it a name.', true); return; }
        const { user } = await ctx.api('PATCH', `/api/users/${encodeURIComponent(agent.key)}`, { displayName: value });
        agent = { ...agent, ...user };
        ctx.onChanged(agent);
        paint();
        speak('Saved');
      }
    } catch (err) {
      if (what !== 'make') speak(err.message, true);
    }
  });
  $('[data-agent-name]').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('[data-agent="rename"]').click(); } });
  $('[data-agent-name]').maxLength = MAX_NAME;

  return {
    async open(user) {
      agent = { ...user };
      token = null;
      oldest = null;
      $('[data-agent-log]').replaceChildren();
      $('[data-agent="older"]').hidden = true;
      $('[data-agent-log-empty]').hidden = true;
      speak('');
      paint();
      await loadToken();
      paint();
      await loadLog(false);
    },
    close() { agent = null; token = null; },
  };
}
