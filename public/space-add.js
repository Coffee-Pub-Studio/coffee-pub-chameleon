// Add <space>: the one form that makes a space (Thomas, 2026-11-23: every member and moderator may make one, always; owners and the
// admin as before). Opened from the top bar's "+ New <space>" (brand.js, every page), Home's Add card (space.js) and Manage's Spaces
// tab (admin.js), so it is drawn here once. Its fields: the name, a description, the template (only while the owner's Space templates
// switch is on and there are templates to choose from) and the people to add from the environment's members (never an agent: an
// owner adds one in Set up). It asks POST /api/spaces, which decides who may make one; a refusal is read in the form with the
// server's own sentence, and Add can be pressed again. A member who makes one is its moderator, and the form says so.
//
// openSpaceAdd({ api, word, owner, self, doc }) resolves the space the server made ({ id, name, ... }), or null when cancelled.
//   api(method, url, body) the page's request helper (throws an Error whose message is the server's sentence)
//   word(key, opts)        the environment's words (envWord in the top bar)
//   owner                  whether the person has every right here (their form adds no moderator line)
//   self                   their own account key, left out of the people list
// The reads it needs are open to every account: GET /api/environment/space-templates and GET /api/presence (its `users`).
// Text only: every name goes in through textContent or .value, never as HTML.

import { optionList, SAME } from '/template-choice.js';

let open = false;

// What the form offers: { templates: { on, environment, choices } | null, people: [{ key, displayName }] | null }. A read that fails
// is null, and the form goes on without that part.
async function loadOffer(api, self) {
  const [templates, presence] = await Promise.all([
    api('GET', '/api/environment/space-templates').catch(() => null),
    api('GET', '/api/presence').catch(() => null),
  ]);
  const people = presence && Array.isArray(presence.users)
    ? presence.users.filter((u) => u && u.key && u.key !== self && !u.agent)
      .map((u) => ({ key: u.key, displayName: u.displayName || u.key }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
    : null;
  return { templates, people };
}

// The request's body from what the form holds: the name and description as typed (trimmed), the people ticked, and the template
// only when one is chosen ("Same as the <environment>" sends none). Pure, for tools/check-members-make-spaces.mjs.
export function addBody({ name = '', description = '', members = [], template = SAME } = {}) {
  const body = { name: String(name).trim(), description: String(description).trim(), members: [...members] };
  if (template) body.template = template;
  return body;
}

export async function openSpaceAdd({ api, word, owner = false, self = '', doc = document } = {}) {
  if (open) return null;
  open = true;
  let offer;
  try { offer = await loadOffer(api, self); } catch { offer = { templates: null, people: null }; }
  return new Promise((resolve) => {
    const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const spaceWord = word('space', { cap: true });
    const dlg = make('dialog', 'sdk-dialog sdk-dialog-confirm sdk-dialog-prompt space-add');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'space-add-title');
    const head = make('div', 'sdk-dialog-head');
    const title = make('h2', 'sdk-dialog-title', `Add ${spaceWord}`);
    title.id = 'space-add-title';
    const close = make('button', 'sdk-icon-btn btn-quiet btn-small sdk-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.dataset.close = '';
    const x = make('i', 'fa-solid fa-xmark');
    x.setAttribute('aria-hidden', 'true');
    close.appendChild(x);
    head.append(title, close);
    const body = make('div', 'sdk-dialog-body');

    // Name and description.
    const nameField = make('label', 'sdk-field');
    nameField.append(make('span', 'sdk-label', 'Name'));
    const name = make('input');
    name.type = 'text';
    name.id = 'space-add-name';
    name.autocomplete = 'off';
    name.maxLength = 40;
    name.placeholder = `New ${word('space')}`;
    nameField.append(name);
    const aboutField = make('label', 'sdk-field');
    const aboutLabel = make('span', 'sdk-label', 'Description ');
    aboutLabel.append(make('span', 'sdk-optional', '(optional)'));
    aboutField.append(aboutLabel);
    const description = make('textarea');
    description.id = 'space-add-description';
    description.rows = 2;
    description.maxLength = 300;
    aboutField.append(description);
    body.append(nameField, aboutField);

    // The template, while the owner lets a space have its own and there is one to choose.
    const t = offer.templates;
    let select = null;
    if (t && t.on && Array.isArray(t.choices) && t.choices.length) {
      const field = make('label', 'sdk-field');
      field.append(make('span', 'sdk-label', 'Template'));
      select = make('select');
      select.id = 'space-add-template';
      const options = optionList({ choices: t.choices, environment: t.environment }, SAME, word);
      for (const o of options) {
        const e = make('option', '', o.label);
        e.value = o.value;
        select.append(e);
      }
      select.value = SAME;
      field.append(select);
      const hint = make('span', 'sdk-hint');
      hint.id = 'space-add-template-about';
      const showAbout = () => { hint.textContent = (options.find((o) => o.value === select.value) || {}).description || ''; };
      select.addEventListener('change', showAbout);
      showAbout();
      field.append(hint);
      body.append(field);
    }

    // The people to add: the environment's members, ticked one by one.
    const people = make('div', 'sdk-field');
    people.id = 'space-add-people';
    people.setAttribute('role', 'group');
    const peopleLabel = make('span', 'sdk-label', `${word('member', { many: true, cap: true })} `);
    peopleLabel.id = 'space-add-people-label';
    peopleLabel.append(make('span', 'sdk-optional', '(optional)'));
    people.setAttribute('aria-labelledby', peopleLabel.id);
    people.append(peopleLabel);
    if (!offer.people) people.append(make('p', 'sdk-hint', "Couldn't load the list. You can add people later."));
    else if (!offer.people.length) people.append(make('p', 'sdk-hint', `Nobody else is in this ${word('environment')} yet.`));
    else {
      const list = make('div', 'sdk-choice-list');
      for (const p of offer.people) {
        const row = make('label', 'sdk-choice-row');
        const box = make('input');
        box.type = 'checkbox';
        box.value = p.key;
        box.dataset.member = p.key;
        const text = make('span', 'sdk-choice-text');
        text.append(make('span', 'sdk-choice-label', p.displayName));
        row.append(box, text);
        list.append(row);
      }
      people.append(list);
    }
    body.append(people);
    if (!owner) {
      const yours = make('p', 'hint', `You'll be its ${word('moderator')}.`);
      yours.id = 'space-add-yours';
      body.append(yours);
    }
    const problem = make('p', 'sdk-error');
    problem.setAttribute('role', 'alert');
    problem.dataset.error = '';
    body.append(problem);

    const foot = make('div', 'sdk-dialog-foot');
    const cancel = make('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.close = '';
    const ok = make('button', 'btn btn-primary', 'Add');
    ok.type = 'button';
    ok.dataset.ok = '';
    foot.append(cancel, ok);
    dlg.append(head, body, foot);

    const root = doc.documentElement;
    const was = root.style.overflow;
    const opener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    let settled = false;
    let running = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      open = false;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      root.style.overflow = was;
      dlg.remove();
      if (value === null && opener && opener.isConnected) opener.focus();
      resolve(value);
    };
    const accept = async () => {
      if (running) return;
      running = true;
      ok.disabled = true;
      problem.textContent = '';
      const members = [...dlg.querySelectorAll('input[data-member]:checked')].map((b) => b.value);
      try {
        const answer = await api('POST', '/api/spaces', addBody({ name: name.value, description: description.value, members, template: select ? select.value : SAME }));
        done(answer.space);
      } catch (err) {
        problem.textContent = (err && err.message) || `The ${word('space')} could not be added. Try again.`;
        ok.disabled = false;
        ok.focus();
      } finally {
        running = false;
      }
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!running) done(null); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target === name) { e.preventDefault(); accept(); return; }
      if (e.key !== 'Tab') return;
      const f = [...dlg.querySelectorAll('button, input, select, textarea')].filter((el) => !el.disabled && !el.hidden);
      if (!f.length) return;
      const i = f.indexOf(doc.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) { if (!running) done(null); return; }
      if (e.target.closest('[data-ok]') && !ok.disabled) accept();
    });
    doc.body.appendChild(dlg);
    root.style.overflow = 'hidden';
    try { dlg.showModal(); } catch { open = false; root.style.overflow = was; dlg.remove(); resolve(null); return; }
    name.focus();
  });
}
