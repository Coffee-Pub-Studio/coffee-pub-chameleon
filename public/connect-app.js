// The approval page for an app asking to connect (public/connect-app.html; documentation/plans/plan-mcp-oauth.md).
// Reads GET /api/oauth/requests/:id and draws one of its states: the form for someone who may allow, "only an owner can",
// "agents are off", or "this sign-in has ended". Allow and Don't allow answer { redirect }, which the page then goes to.
// Text only: the app's name, an agent's name and a space's name go in through textContent and value, never as markup.
import { loadBranding, api, word } from '/brand.js';
import { sameSiteNext } from '/next-address.js';
import { agentName } from '/agent-page.js';

const $ = (id) => document.getElementById(id);
const LIFETIME_LABELS = { '30d': '30 days', '60d': '60 days', '90d': '90 days', '1y': '1 year', never: 'Never expires' };
const NAME_MAX = 40;
const NEW_AGENT = 'new';

let view = null; // the server's answer for it

const params = new URLSearchParams(location.search);
const requestId = params.get('request') || '';

const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
function showError(text) { $('connect-error').textContent = text; $('connect-error').hidden = !text; }
function plainState(title, lead, back) {
  $('connect-title').textContent = title;
  $('connect-lead').textContent = lead;
  $('connect-fact').textContent = '';
  $('connect-form').hidden = true;
  $('connect-back-row').hidden = !back;
}
function goBack() {
  if (history.length > 1 && document.referrer) history.back();
  else location.href = '/';
}

// The agent chosen on the form: 'new', or an agent's key.
const chosen = () => $('connect-agent').value;
const agentOf = (key) => (view.agents || []).find((a) => a.key === key) || null;
const kindWord = (k) => (k === 'setup' ? `Makes and names ${word('space', { many: true })}` : `Works in ${word('space', { many: true })}`);
// Whether the one it becomes is a set-up agent: a new one of that kind, or an existing one.
const isSetup = () => (chosen() === NEW_AGENT ? ($('connect-kind-field').hidden ? false : $('connect-kind').value === 'setup') : (agentOf(chosen()) || {}).kind === 'setup');

// Draws what depends on who it becomes: the name box, the kind, the spaces, what it can do and the note about what ends.
function paintChoice() {
  const fresh = chosen() === NEW_AGENT;
  const existing = agentOf(chosen());
  $('connect-name-field').hidden = !fresh;
  $('connect-kind-field').hidden = !fresh || (view.kinds || []).length < 2;
  const setup = isSetup();
  $('connect-spaces-field').hidden = setup;
  const note = $('connect-agent-note');
  const ends = existing && existing.connected ? 'This ends its current connection.' : existing && existing.hasToken ? 'This ends its current token.' : '';
  note.textContent = ends;
  note.hidden = !ends;
  const spaces = word('space', { many: true });
  $('connect-spaces-note').textContent = `None ticked is fine: it can't see anything until you add it to ${word('space', { a: true })}.`;
  $('connect-can').textContent = setup
    ? `It can make ${spaces} and name them. Adding or taking off people waits for ${word('owner', { a: true })}.`
    : `It can read what ${word('member', { a: true })} can read in these ${spaces}, read their Chat, and ask their ${word('module', { many: true })} for changes. It can't delete anything, change settings or see other ${spaces}.`;
}

function drawForm(v) {
  const app = v.app.name;
  $('connect-title').textContent = `Connect ${app}`;
  $('connect-lead').textContent = `${app} wants to work in ${v.environment} as an agent.`;
  $('connect-fact').textContent = `This name is what the app calls itself. After you allow it, you go back to ${v.app.returnsTo}.`;
  const agent = $('connect-agent');
  agent.replaceChildren();
  const fresh = el('option', 'A new agent');
  fresh.value = NEW_AGENT;
  agent.append(fresh);
  for (const a of v.agents || []) {
    const o = el('option', agentName({ displayName: a.name, kind: a.kind }));
    o.value = a.key;
    agent.append(o);
  }
  $('connect-name').value = app.slice(0, NAME_MAX);
  const kind = $('connect-kind');
  kind.replaceChildren();
  for (const k of v.kinds || ['agent']) { const o = el('option', kindWord(k)); o.value = k === 'setup' ? 'setup' : 'agent'; kind.append(o); }
  const box = $('connect-spaces');
  box.replaceChildren();
  for (const s of v.spaces || []) {
    const row = el('label', undefined, 'sdk-choice-row');
    const input = el('input');
    input.type = 'checkbox';
    input.value = s.id;
    input.name = 'space';
    const text = el('span', undefined, 'sdk-choice-text');
    text.append(el('span', s.name, 'sdk-choice-label'));
    row.append(input, text);
    box.append(row);
  }
  if (!(v.spaces || []).length) box.append(el('p', `There is no ${word('space')} yet.`, 'hint'));
  const life = $('connect-lifetime');
  life.replaceChildren();
  for (const l of v.lifetimes || []) { const o = el('option', LIFETIME_LABELS[l] || l); o.value = l; life.append(o); }
  life.value = v.defaultLifetime && (v.lifetimes || []).includes(v.defaultLifetime) ? v.defaultLifetime : '30d';
  $('connect-never').hidden = life.value !== 'never';
  $('connect-form').hidden = false;
  $('connect-back-row').hidden = true;
  paintChoice();
}

async function load() {
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) {
    plainState('Connect an app', 'This sign-in has ended. Start again from the app.', true);
    return;
  }
  try {
    view = await api('GET', `/api/oauth/requests/${encodeURIComponent(requestId)}`);
  } catch (err) {
    if (err.status === 401) { location.href = `/login?next=${encodeURIComponent(sameSiteNext(`${location.pathname}${location.search}`))}`; return; }
    plainState('Connect an app', err.serverSaid ? err.message : 'This did not load. Try again.', true);
    return;
  }
  const env = view.environment;
  if (!view.mayApprove) { plainState(`Connect ${view.app.name}`, `Only ${word('owner', { a: true })} can connect an app to ${env}. Ask ${word('owner', { a: true })} to do it.`, true); return; }
  if (!view.agentsOn) { plainState(`Connect ${view.app.name}`, `Agents are off for ${env}. ${word('owner', { a: true, cap: true })} can turn them on in Manage, Users.`, true); return; }
  drawForm(view);
}

function finish(redirect) {
  // The server answers the app's own address; only an address of the app (https, or loopback) is gone to.
  location.href = redirect;
}
async function answer(what) {
  showError('');
  const buttons = [$('connect-allow'), $('connect-deny')];
  for (const b of buttons) b.disabled = true;
  try {
    let body = { form: view.form };
    if (what === 'allow') {
      const fresh = chosen() === NEW_AGENT;
      body = { ...body, agent: chosen(), expires: $('connect-lifetime').value };
      if (fresh) {
        body.name = $('connect-name').value.trim() || view.app.name;
        if (!$('connect-kind-field').hidden) body.kind = $('connect-kind').value;
      }
      body.spaces = isSetup() ? [] : [...$('connect-spaces').querySelectorAll('input:checked')].map((i) => i.value);
    }
    const res = await api('POST', `/api/oauth/requests/${encodeURIComponent(requestId)}/${what}`, body);
    finish(res.redirect);
  } catch (err) {
    if (err.status === 401) { location.href = `/login?next=${encodeURIComponent(sameSiteNext(`${location.pathname}${location.search}`))}`; return; }
    showError(err.serverSaid ? err.message : 'This did not work. Try again.');
    for (const b of buttons) b.disabled = false;
  }
}

$('connect-agent').addEventListener('change', paintChoice);
$('connect-kind').addEventListener('change', paintChoice);
$('connect-lifetime').addEventListener('change', (e) => { $('connect-never').hidden = e.target.value !== 'never'; });
$('connect-form').addEventListener('submit', (e) => { e.preventDefault(); answer('allow'); });
$('connect-deny').addEventListener('click', () => answer('deny'));
$('connect-back').addEventListener('click', goBack);

loadBranding().finally(load);
