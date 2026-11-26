// The Service terms section (documentation/plans/plan-weather-part.md, step 2; plan-github-pull.md, step 3): each outside service (weather, GitHub) this server has, its
// credit, a link to its terms, whether the administrator has accepted them, and Accept and Withdraw for the administrator.
// A service's terms are accepted once for the whole server, so the same section is on the host console (hosted, route
// /api/host/weather/terms) and on the admin page (a single install, /api/weather/terms). Each page holds the markup
// (#weather-terms-section and the ids below) and calls wireServiceTerms with its route. On a hosted server an owner sees the
// status on the admin page and a sentence that the host's administrator accepts, with no buttons. The server's own sentences
// are shown as they come.
import { api } from '/brand.js';
import { confirmDialog } from '/confirm.js';

const ACCEPT_WORDS = 'I have read the terms and accept them for this server.';
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ` on ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`;
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

// `where`: 'single' (the admin page of a single install), 'hosted' (an owner's admin page on a hosted server) or 'host'
// (the host console). Only the sentence for a person who cannot accept differs.
export function wireServiceTerms(route, where = 'single') {
  const $ = (id) => document.getElementById(id);
  const section = $('weather-terms-section');
  const list = $('weather-terms-list');
  const note = $('weather-terms-note');
  const status = $('weather-terms-status');
  if (!section || !list || !note || !status) return { load: async () => {} };

  let timer = 0;
  const say = (text, error = false) => {
    clearTimeout(timer);
    status.textContent = text;
    status.classList.toggle('error', error);
    if (text && !error) timer = setTimeout(() => { status.textContent = ''; }, 5000);
  };

  function draw(answer) {
    const services = Array.isArray(answer && answer.services) ? answer.services : [];
    const may = Boolean(answer && answer.mayAccept);
    note.textContent = may ? '' : where === 'hosted'
      ? "The host's administrator accepts a service's terms, on the host console."
      : "The server's administrator accepts a service's terms.";
    note.hidden = may;
    list.replaceChildren();
    if (!services.length) list.append(el('li', 'sdk-hint', 'This server has no outside service.'));
    for (const s of services) {
      const li = el('li', 'weather-terms-row');
      const head = el('div', 'weather-terms-head');
      head.append(el('strong', '', s.name));
      const tag = el('span', 'sdk-status', s.accepted ? `Accepted by ${s.by}${when(s.at)}` : 'Not accepted');
      if (!s.accepted) tag.dataset.tone = 'warn';
      head.append(tag);
      li.append(head);
      if (s.credit) li.append(el('p', 'sdk-hint', s.credit));
      if (/^https:\/\//.test(s.terms || '')) {
        const p = el('p', 'weather-terms-link');
        const a = el('a', '', `Read ${s.name}'s terms`);
        a.href = s.terms;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.append(a);
        li.append(p);
      }
      if (may) li.append(controls(s));
      list.append(li);
    }
  }

  function controls(s) {
    const box = el('div', 'weather-terms-actions');
    const url = `${route}/${encodeURIComponent(s.id)}`;
    const run = async (method, body, done) => {
      try {
        draw(await api(method, url, body));
        say(done);
      } catch (err) {
        say(err.message, true);
      }
    };
    if (s.accepted) {
      const withdraw = el('button', 'btn btn-small btn-danger', 'Withdraw');
      withdraw.type = 'button';
      withdraw.addEventListener('click', async () => {
        if (!await confirmDialog({ title: `Withdraw ${s.name}'s terms?`, message: `Nothing is asked of ${s.name} for every ${where === 'host' ? 'environment' : 'space'} on this server until the terms are accepted again.`, action: 'Withdraw', kind: 'destructive' })) return;
        await run('DELETE', undefined, `Withdrew ${s.name}.`);
      });
      box.append(withdraw);
      return box;
    }
    const label = el('label', 'sdk-choice-row');
    const box1 = document.createElement('input');
    box1.type = 'checkbox';
    const text = el('span', 'sdk-choice-text', ACCEPT_WORDS);
    label.append(box1, text);
    const accept = el('button', 'btn btn-small', 'Accept');
    accept.type = 'button';
    accept.disabled = true;
    box1.addEventListener('change', () => { accept.disabled = !box1.checked; });
    accept.addEventListener('click', () => run('PUT', { accept: true }, `Accepted ${s.name}'s terms.`));
    box.append(label, accept);
    return box;
  }

  async function load() {
    try {
      draw(await api('GET', route));
      section.hidden = false;
    } catch (err) {
      section.hidden = true; // not allowed: no section at all
    }
  }
  return { load };
}
