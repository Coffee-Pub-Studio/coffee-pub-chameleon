// The fields of a template that Manage's pages and the host console's editor share (plan-templates-redesign.md, decision
// 39: the host edits on the same pages as the owner, one code): Environment Basics (Template Name, Template Description,
// Home Icon, Default Profile Image) and Experience Labels (the words a template may change, the locked ones read-only).
//
// Each part is drawn into a box as markup (`basicsHtml`, `labelsHtml`), wired once (`wireFields`) and read back as template
// fields (`readBasics`, `readLabels`). A template that is not editable draws plain lines instead of fields. Nothing here
// talks to the server: the page decides where the fields go.
import { escapeHtml } from '/brand.js';
import { DEFAULTS, homeDefault, LOCKED } from '/words.js';

const e = escapeHtml;
const cap = (s) => (s ? s[0].toLocaleUpperCase('en') + s.slice(1) : s);
export const DEFAULT_HOME_ICON = 'couch';
const PROFILES = [['', 'The usual images'], ['roleplaying', 'Roleplaying'], ['participants', 'Participants'], ['characters', 'Characters']];
const usualArticle = (one) => `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`;
const profileLabel = (v) => (PROFILES.find(([p]) => p === v) || PROFILES[0])[1];

// The reason for the locked words: one line, shown once above them.
export const LOCKED_REASON = 'These read the same everywhere, so every guide, every sign-in page and every message matches.';

const field = (label, input, wide = false) => `<label class="tf-field${wide ? ' tf-wide' : ''}"><span class="field-label">${e(label)}</span>${input}</label>`;
const line = (label, value) => `<div class="tf-line"><dt>${e(label)}</dt><dd>${value}</dd></div>`;
const iconTag = (name) => `<i class="fa-solid fa-${e(name)} fa-fw" aria-hidden="true"></i>`;

// --- Environment Basics ---------------------------------------------------------------------------------------------------
// `icons`: the picture list ([{ id, classes, label }], Manage's) for a grid of choices, or null for a field that takes a
// Font Awesome name (the console's).
export function basicsHtml(t, { editable, icons = null, withName = true }) {
  const home = (t && t.icons && t.icons.home) || '';
  const profile = (t && t.spaceDefaults && t.spaceDefaults.profile) || '';
  if (!editable) {
    return `<dl class="tf-read">${line('Template Name', e(t.name))}${line('Template Description', e(t.description))}`
      + `${line('Home Icon', `${iconTag(home || DEFAULT_HOME_ICON)} ${home ? e(home) : 'The usual icon'}`)}${line('Default Profile Image', e(profileLabel(profile)))}</dl>`;
  }
  const iconField = icons
    ? `<div class="tf-icons"><input type="hidden" data-tf="home" value="${e(home)}"><div class="icon-grid" role="group" aria-label="Home Icon">`
      + `<button type="button" data-tf-icon="" aria-label="The usual icon" data-tip="The usual icon">${iconTag(DEFAULT_HOME_ICON)}</button>`
      + `${icons.map((i) => `<button type="button" data-tf-icon="${e(i.id)}" aria-label="${e(i.label || i.id)}" data-tip="${e(i.label || i.id)}"><i class="${e(i.classes)} fa-fw" aria-hidden="true"></i></button>`).join('')}</div></div>`
    : `<span class="icon-field"><i class="fa-solid fa-${e(home || DEFAULT_HOME_ICON)} fa-fw" data-tf-preview aria-hidden="true"></i><input type="text" data-tf="home" maxlength="40" value="${e(home)}" placeholder="${DEFAULT_HOME_ICON} (a Font Awesome name)" aria-label="Home Icon, a Font Awesome name" autocapitalize="off" spellcheck="false"></span>`;
  return `<div class="tf-form">`
    + (withName ? `${field('Template Name', `<input type="text" data-tf="name" maxlength="40" autocomplete="off" value="${e(t ? t.name : '')}">`)}${field('Template Description', `<input type="text" data-tf="description" maxlength="200" autocomplete="off" value="${e(t ? t.description : '')}">`, true)}` : '')
    + `<div class="tf-field tf-wide"><span class="field-label">Home Icon</span>${iconField}</div>`
    + field('Default Profile Image', `<select data-tf="profile">${PROFILES.map(([v, l]) => `<option value="${e(v)}"${v === profile ? ' selected' : ''}>${e(l)}</option>`).join('')}</select>`)
    + `</div>`;
}
// The template fields the Basics part holds. Editing, an emptied one is null (the server removes it).
export function readBasics(root, { editing = true } = {}) {
  const val = (k) => root.querySelector(`[data-tf="${k}"]`)?.value.trim() || '';
  const out = {};
  if (root.querySelector('[data-tf="name"]')) { out.name = val('name'); out.description = val('description'); }
  const home = val('home').replace(/^fa-/, '');
  out.icons = home ? { home } : (editing ? null : {});
  out.spaceDefaults = val('profile') ? { profile: val('profile') } : (editing ? null : {});
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// --- Experience Labels ----------------------------------------------------------------------------------------------------
const WORD_ROWS = ['space', 'member'].map((key) => [key, cap(DEFAULTS[key].one)]);
const wordRow = (key, name, w, base, { editable, article }) => {
  if (!editable) {
    const text = w ? `${e(w.one)} / ${e(w.many)}` : `<span class="hint">${e(base.one)} / ${e(base.many)}, the usual</span>`;
    return line(name, text);
  }
  return `<div class="tf-word" data-tf-word="${key}" role="group" aria-label="${e(name)}"><strong class="tf-word-name">${e(name)}</strong>`
    + `<label><span class="field-label">Singular</span><input type="text" data-tf-part="one" maxlength="30" autocomplete="off" spellcheck="false" value="${e(w ? w.one : '')}" placeholder="${e(base.one)}" aria-label="${e(name)}, singular"></label>`
    + `<label><span class="field-label">Plural</span><input type="text" data-tf-part="many" maxlength="30" autocomplete="off" spellcheck="false" value="${e(w ? w.many : '')}" placeholder="${e(base.many)}" aria-label="${e(name)}, plural"></label>`
    + (article ? `<label><span class="field-label">With its article</span><input type="text" data-tf-part="a" maxlength="41" autocomplete="off" spellcheck="false" value="${e(w && w.a ? w.a : '')}" placeholder="${e(usualArticle((w && w.one) || base.one))}" aria-label="${e(name)}, with its article (optional)"></label>` : '<span></span>')
    + `</div>`;
};
// `environmentParts`: the Home plural and the Lobby's name and description, which belong to the environment's default
// template only (decision 6). The console shows them for every template, since any may be an environment's default.
// `extra`: more words of the template, drawn after these and before the locked ones (Manage's module words).
export function labelsHtml(t, { editable, environmentParts = true, extra = '' }) {
  const words = (t && t.words) || {};
  const spaceMany = (words.space && words.space.many) || DEFAULTS.space.many;
  const rows = WORD_ROWS.map(([key, name]) => wordRow(key, name, words[key], DEFAULTS[key], { editable, article: true })).join('');
  const home = environmentParts ? wordRow('home', 'Home page', t && t.home, homeDefault({ many: spaceMany }), { editable, article: false }) : '';
  const lobby = (t && t.lobby) || {};
  const lobbyPart = !environmentParts ? '' : editable
    ? `<div class="tf-form tf-lobby"><label class="tf-field"><span class="field-label">Lobby name</span><input type="text" data-tf="lobby-name" maxlength="40" autocomplete="off" value="${e(lobby.name || '')}" placeholder="Lobby"></label>`
      + `<label class="tf-field tf-wide"><span class="field-label">Lobby description</span><input type="text" data-tf="lobby-description" maxlength="300" autocomplete="off" value="${e(lobby.description || '')}"></label></div>`
    : `<dl class="tf-read">${line('Lobby name', lobby.name ? e(lobby.name) : '<span class="hint">Lobby, the usual</span>')}${line('Lobby description', lobby.description ? e(lobby.description) : '<span class="hint">None</span>')}</dl>`;
  const locked = `<div class="tf-locked"><h3>Words that never change</h3><p class="hint">${e(LOCKED_REASON)}</p><dl class="tf-read tf-locked-list">`
    + `${LOCKED.map((k) => line(cap(DEFAULTS[k].one), `${e(DEFAULTS[k].one)} / ${e(DEFAULTS[k].many)}`)).join('')}</dl></div>`;
  const wordsBox = editable ? `<div class="tf-words">${rows}${home}</div>` : `<dl class="tf-read">${rows}${home}</dl>`;
  return `<div class="tf-labels"><h3>Words you can change</h3>${editable ? '<p class="hint">Leave a word blank for the usual one. Give both the singular and the plural.</p>' : ''}${wordsBox}${lobbyPart}</div>${extra}${locked}`;
}
export function readLabels(root, { editing = true } = {}) {
  const words = {};
  let home = null;
  for (const row of root.querySelectorAll('[data-tf-word]')) {
    const part = (p) => row.querySelector(`[data-tf-part="${p}"]`)?.value.trim() || '';
    const [one, many, a] = [part('one'), part('many'), part('a')];
    if (!one && !many && !a) continue;
    const w = a ? { one, many, a } : { one, many };
    if (row.dataset.tfWord === 'home') home = w; else words[row.dataset.tfWord] = w;
  }
  const out = { words };
  if (root.querySelector('[data-tf-word="home"]')) out.home = home || (editing ? null : undefined);
  if (root.querySelector('[data-tf="lobby-name"]')) {
    const lobby = {};
    const name = root.querySelector('[data-tf="lobby-name"]').value.trim();
    const description = root.querySelector('[data-tf="lobby-description"]').value.trim();
    if (name) lobby.name = name;
    if (description) lobby.description = description;
    out.lobby = Object.keys(lobby).length ? lobby : (editing ? null : {});
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Behaviour of the fields in `root` (call once; the fields can be drawn again inside it): the article's placeholder follows
// the singular being typed, Home's follows the space plural, the picture grid and the icon preview follow the choice.
export function wireFields(root) {
  root.addEventListener('input', (ev) => {
    const row = ev.target.closest('[data-tf-word]');
    if (row && ev.target.matches('[data-tf-part="one"]')) {
      const a = row.querySelector('[data-tf-part="a"]');
      if (a) a.placeholder = usualArticle(ev.target.value.trim() || DEFAULTS[row.dataset.tfWord].one);
    }
    if (row && row.dataset.tfWord === 'space' && ev.target.matches('[data-tf-part="many"]')) {
      const d = homeDefault({ many: ev.target.value.trim() || DEFAULTS.space.many });
      for (const input of root.querySelectorAll('[data-tf-word="home"] input')) input.placeholder = d[input.dataset.tfPart];
    }
    if (ev.target.matches('[data-tf="home"]')) {
      const preview = root.querySelector('[data-tf-preview]');
      if (preview) preview.className = `fa-solid fa-${ev.target.value.trim().replace(/^fa-/, '') || DEFAULT_HOME_ICON} fa-fw`;
    }
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tf-icon]');
    if (!b) return;
    root.querySelector('[data-tf="home"]').value = b.dataset.tfIcon;
    showChosenIcon(root);
  });
}
// Marks the chosen picture in the grid (after drawing, and after a click).
export function showChosenIcon(root) {
  const input = root.querySelector('input[type="hidden"][data-tf="home"]');
  if (!input) return;
  for (const b of root.querySelectorAll('[data-tf-icon]')) {
    const on = b.dataset.tfIcon === input.value;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', String(on));
  }
}
