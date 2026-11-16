// The rest of a template's pages (plan-templates-redesign.md, step 11b), beside Environment Basics and Experience Labels
// (/template-fields.js): the Default Workspace, Phases, Additional Reactions and Icons, and Modules. Like those, each part is
// drawn into a box as markup, read back as template fields, and wired once; a template that is not editable draws plain
// lines instead of fields. Nothing here talks to the server: the page decides where the fields go.
import { escapeHtml } from '/brand.js';
import { listControl, readList, listClick, listWords } from '/list-rows.js';
import { upgradeColourInputs } from '/colour-pick.js';

const e = escapeHtml;
const cap = (s) => (s ? s[0].toLocaleUpperCase('en') + s.slice(1) : s);
const iconTag = (name) => `<i class="fa-solid fa-${e(name)} fa-fw" aria-hidden="true"></i>`;
const line = (label, value) => `<div class="tf-line"><dt>${e(label)}</dt><dd>${value}</dd></div>`;
const slug = (text) => String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The Fixed Workspaces a template may show for a new space (every layout but the Workspace itself).
export const FIXED_WORKSPACES = [['calendar', 'Calendar'], ['map', 'Map'], ['conference', 'Conference'], ['whiteboard', 'Whiteboards'], ['documents', 'Documents']];
// The planners sit together under "Plans" (decision 46): they are alternatives.
export const PLANNER_IDS = ['travel', 'schedule', 'goals'];
const MEASURES = [['dates', 'Dates', 'Each phase has dates, set in Set up.'], ['goals', 'Goals', 'A phase is done when every planner entry that names it is done. One no entry names has a Done switch in Set up.'], ['progress', 'Progress', 'Each phase has a Done switch in Set up.']];
export const measureName = (m) => (MEASURES.find(([v]) => v === m) || MEASURES[0])[1];

// The modules a template can offer, { id, name, icon }: what `catalog` holds (the installed and the built-in ones), in order.
// Whether the template offers one: "*" is every module; else it is listed.
export const offers = (t, id) => !t || t.modules === '*' || (isObject(t.modules) && Object.hasOwn(t.modules, id));
const entryOf = (t, id) => (t && isObject(t.modules) && isObject(t.modules[id]) ? t.modules[id] : {});

// --- Default Workspace ----------------------------------------------------------------------------------------------------
// What the Workspace opens with (the template's modules, in order) and which Fixed Workspaces a new space shows. A workspace
// shown here is shown for everyone: nobody can hide it (decision 9).
export function workspaceHtml(t, { editable, catalog, word }) {
  const w = (t && t.workspace) || {};
  const opens = Array.isArray(w.opensWith) ? w.opensWith : [];
  const show = Array.isArray(w.show) ? w.show : [];
  const first = w.opensFirst || 'workspace';
  const offered = catalog.filter((m) => offers(t, m.id));
  const ordered = [...opens.map((id) => offered.find((m) => m.id === id)).filter(Boolean), ...offered.filter((m) => !opens.includes(m.id))];
  // The template's own name and icon for a module, as the Modules page shows it, else the catalog's.
  const shownOf = (id) => { const m = catalog.find((x) => x.id === id) || { name: id }; const en = entryOf(t, id); return { name: en.name || m.name, icon: en.icon || m.icon || 'puzzle-piece' }; };
  const nameOf = (id) => shownOf(id).name;
  const opensAbout = `What a new ${e(word('space'))}'s Workspace opens with. With none ticked it opens the chat and every ${e(word('module'))} that is on.`;
  const pinNote = `A Fixed Workspace shown here is shown for everyone in a new ${e(word('space'))}; nobody can hide it. People still add layouts of their own.`;
  if (!editable) {
    const openList = opens.length ? opens.map((id) => `${iconTag(shownOf(id).icon)} ${e(nameOf(id))}`).join('<br>') : `<span class="hint">The chat and every ${e(word('module'))} that is on, the usual</span>`;
    const shownList = show.length ? show.map((id) => e((FIXED_WORKSPACES.find(([x]) => x === id) || [id, id])[1])).join(', ') : '<span class="hint">None</span>';
    const firstName = first === 'workspace' ? 'The Workspace' : (FIXED_WORKSPACES.find(([x]) => x === first) || [first, first])[1];
    return `<dl class="tf-read">${line('Opens with', openList)}${line('Fixed Workspaces shown', shownList)}${line('Opens first', e(firstName))}</dl><p class="hint">${pinNote}</p>`;
  }
  const rows = ordered.map((m) => `<label class="sdk-choice-row"><input type="checkbox" data-tw-open="${e(m.id)}"${opens.includes(m.id) ? ' checked' : ''}><span class="sdk-choice-text"><span>${iconTag(shownOf(m.id).icon)} ${e(nameOf(m.id))}</span></span></label>`).join('');
  const fixed = FIXED_WORKSPACES.map(([id, label]) => `<label class="sdk-choice-row"><input type="checkbox" data-tw-show="${id}"${show.includes(id) ? ' checked' : ''}><span class="sdk-choice-text">${e(label)}</span></label>`).join('');
  const firstOptions = [['workspace', 'The Workspace'], ...FIXED_WORKSPACES].map(([v, l]) => `<option value="${e(v)}"${v === first ? ' selected' : ''}>${e(l)}</option>`).join('');
  return `<div class="tf-labels"><h3>Opens with</h3><p class="hint">${opensAbout}</p><div class="tp-checks">${rows}</div>`
    + `<h3>Fixed Workspaces shown</h3><p class="hint">${pinNote}</p><div class="tp-checks">${fixed}</div>`
    + `<h3>Opens first</h3><label class="tf-field"><span class="field-label">What a new ${e(word('space'))} shows first</span><select data-tw-first>${firstOptions}</select></label></div>`;
}
export function readWorkspace(root, { editing = true } = {}) {
  const opensWith = [...root.querySelectorAll('[data-tw-open]:checked')].map((b) => b.dataset.twOpen);
  const show = [...root.querySelectorAll('[data-tw-show]:checked')].map((b) => b.dataset.twShow);
  const first = root.querySelector('[data-tw-first]')?.value || 'workspace';
  const workspace = { ...(opensWith.length ? { opensWith } : {}), ...(show.length ? { show } : {}), ...(first !== 'workspace' ? { opensFirst: first } : {}) };
  return { workspace: Object.keys(workspace).length ? workspace : (editing ? null : {}) };
}

// --- Phases -----------------------------------------------------------------------------------------------------------------
const phaseRow = (p) => `<div class="tp-phase" data-tp-phase="${e(p.id || '')}">`
  + `<label class="tf-field"><span class="field-label">Name</span><input type="text" data-tp-label maxlength="40" autocomplete="off" value="${e(p.label || '')}"></label>`
  + `<label class="tf-field"><span class="field-label">Icon</span><input type="text" data-tp-icon maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(p.icon || '')}" placeholder="Font Awesome name"></label>`
  + `<label class="sdk-choice-row tp-main"><input type="checkbox" data-tp-main${p.main ? ' checked' : ''}><span class="sdk-choice-text">Main</span></label>`
  + `<span class="tp-actions"><button class="btn btn-small" type="button" data-tp-up aria-label="Move earlier" data-tip="Move earlier">&uarr;</button><button class="btn btn-small" type="button" data-tp-down aria-label="Move later" data-tip="Move later">&darr;</button><button class="btn btn-small btn-danger" type="button" data-tp-remove>Remove</button></span></div>`;
export function phasesHtml(t, { editable, word }) {
  const phases = Array.isArray(t && t.phases) ? t.phases : [];
  const measure = (t && t.phaseMeasure) || 'dates';
  const about = (MEASURES.find(([v]) => v === measure) || MEASURES[0])[2];
  if (!editable) {
    const list = phases.length ? `<ol class="tp-phase-list">${phases.map((p) => `<li>${p.icon ? `${iconTag(p.icon)} ` : ''}${e(p.label)}${p.main ? ' <span class="sdk-status" data-tone="neutral">Main</span>' : ''}</li>`).join('')}</ol>` : '<p class="hint">No phases.</p>';
    return `<dl class="tf-read">${line('Measured by', `${e(measureName(measure))}. <span class="hint">${e(about)}</span>`)}</dl><h3>Phases</h3>${list}`;
  }
  const options = MEASURES.map(([v, l]) => `<option value="${v}"${v === measure ? ' selected' : ''}>${e(l)}</option>`).join('');
  return `<div class="tf-labels"><h3>Measured by</h3><label class="tf-field"><span class="field-label">What tells a phase is done</span><select data-tp-measure>${options}</select></label>`
    + `<p class="hint" data-tp-measure-about>${e(about)}</p>`
    + `<h3>Phases</h3><p class="hint">In order. The main one is the one the ${e(word('space'))} is about (up to 12 phases).</p><div class="tp-phases" data-tp-list>${phases.map(phaseRow).join('')}</div>`
    + `<div class="row"><button class="btn btn-small" type="button" data-tp-add>Add a phase</button></div></div>`;
}
export function readPhases(root, { editing = true } = {}) {
  const seen = new Set();
  const phases = [...root.querySelectorAll('[data-tp-phase]')].map((row) => {
    const label = row.querySelector('[data-tp-label]').value.trim();
    const icon = row.querySelector('[data-tp-icon]').value.trim().replace(/^fa-/, '');
    let id = row.dataset.tpPhase || slug(label).replace(/^[^a-z]+/, '') || 'phase';
    while (seen.has(id)) id = `${id.slice(0, 28)}-${Math.random().toString(36).slice(2, 5)}`;
    seen.add(id);
    return { id, label, ...(row.querySelector('[data-tp-main]').checked ? { main: true } : {}), ...(icon ? { icon } : {}) };
  }).filter((p) => p.label);
  const measure = root.querySelector('[data-tp-measure]')?.value || 'dates';
  return { phases: phases.length ? phases : (editing ? null : []), phaseMeasure: measure };
}

// --- Additional Reactions and Icons -----------------------------------------------------------------------------------------
// `set`: { reactions: [{ glyph, label }], icons: [{ id, classes, label }] }, the environment's set, shown read only and folded
// (on the host console, the built-in lists an environment's set starts as). `whose`: who the set is, said by the page in its own
// words ("the Trip group"; on the console, which has no environment, "an environment").
const reactionRow = (r) => `<div class="reaction-row tp-reaction" data-tr-id="${e(r.id || '')}"><input class="reaction-glyph" type="text" maxlength="8" value="${e(r.glyph || '')}" placeholder="🙂" aria-label="Emoji"><input class="reaction-label" type="text" maxlength="40" value="${e(r.label && r.label !== r.glyph ? r.label : '')}" placeholder="Label" aria-label="Label"><button class="btn btn-small btn-danger" type="button" data-tr-remove>Remove</button></div>`;
const iconRow = (name) => `<div class="reaction-row tp-icon" data-ti-row><span class="icon-preview" aria-hidden="true">${name ? iconTag(name) : ''}</span><input class="reaction-label" type="text" data-ti-name maxlength="40" value="${e(name || '')}" placeholder="Font Awesome name, such as dice" aria-label="Icon, a Font Awesome name" autocapitalize="off" spellcheck="false"><button class="btn btn-small btn-danger" type="button" data-ti-remove>Remove</button></div>`;
const chipsOf = (list, draw) => `<div class="tp-chips">${list.length ? list.map(draw).join('') : '<span class="hint">None</span>'}</div>`;
export const setReactionChips = (list) => chipsOf(list, (r) => `<span class="tp-chip" title="${e(r.label || '')}">${e(r.glyph)}</span>`);
export const setIconChips = (list) => chipsOf(list, (i) => `<span class="tp-chip" title="${e(i.label || i.id)}"><i class="${e(i.classes)} fa-fw" aria-hidden="true"></i></span>`);
// What the sentence under each list says, and the fold's heading.
export const addedOnTop = (whose) => `Added on top of ${whose}'s set.`;
// `starts`: the built-in lists an environment's set starts as (the console), not a set that is read now.
export const setFoldHtml = (whose, n, chips, { starts = false } = {}) => `<details class="tp-builtin"><summary>${e(starts ? `${cap(whose)}'s set starts as these (${n})` : `${cap(whose)}'s set (${n})`)}</summary>${chips}</details>`;
export function additionsHtml(t, { editable, set, whose }) {
  const reactions = Array.isArray(t && t.reactions) ? t.reactions : [];
  const icons = Array.isArray(t && t.iconSet) ? t.iconSet : [];
  const setReactions = (set && set.reactions) || [];
  const setIcons = (set && set.icons) || [];
  const fold = (list, chips) => (set ? setFoldHtml(whose, list.length, chips) : '');
  const said = `<p class="hint">${e(addedOnTop(whose))}${editable ? ' Up to 40 reactions and 60 icons.' : ''}</p>`;
  const reactionSet = fold(setReactions, setReactionChips(setReactions));
  const iconSet = fold(setIcons, setIconChips(setIcons));
  if (!editable) {
    return `<div class="tf-labels"><h3>This template adds</h3>`
      + `<h4>Reactions</h4>${said}${chipsOf(reactions, (r) => `<span class="tp-chip" title="${e(r.label || '')}">${e(r.glyph)}</span>`)}${reactionSet}`
      + `<h4>Icons</h4><p class="hint">${e(addedOnTop(whose))}</p>${chipsOf(icons, (n) => `<span class="tp-chip" title="${e(n)}">${iconTag(n)}</span>`)}${iconSet}</div>`;
  }
  return `<div class="tf-labels"><h3>This template adds</h3>`
    + `<h4>Reactions</h4>${said}<div class="reactions-list" data-tr-list>${reactions.map(reactionRow).join('')}</div><div class="row"><button class="btn btn-small" type="button" data-tr-add>Add a reaction</button></div>${reactionSet}`
    + `<h4>Icons</h4><p class="hint">${e(addedOnTop(whose))}</p><div class="reactions-list" data-ti-list>${icons.map(iconRow).join('')}</div><div class="row"><button class="btn btn-small" type="button" data-ti-add>Add an icon</button></div>${iconSet}</div>`;
}
export function readAdditions(root, { editing = true } = {}) {
  const used = new Set();
  const reactions = [...root.querySelectorAll('.tp-reaction')].map((row) => {
    const glyph = row.querySelector('.reaction-glyph').value.trim();
    const label = row.querySelector('.reaction-label').value.trim();
    let id = row.dataset.trId || slug(label) || slug(glyph);
    if (!id || used.has(id)) id = `r${Math.random().toString(36).slice(2, 8)}`;
    used.add(id);
    return { id, glyph, ...(label ? { label } : {}) };
  }).filter((r) => r.glyph);
  const icons = [...new Set([...root.querySelectorAll('[data-ti-name]')].map((i) => i.value.trim().replace(/^fa-/, '')).filter(Boolean))];
  return { reactions: reactions.length ? reactions : (editing ? null : []), iconSet: icons.length ? icons : (editing ? null : []) };
}

// --- Modules ----------------------------------------------------------------------------------------------------------------
// One row per catalog module: whether the template offers it, its name and icon, the settings it
// marks (driven: set here and nobody changes them; default: seeded here, the owner may change them) and its starter content.
// `catalog`: [{ id, name, icon, settings: [{ key, label, type, scope, template, options?, min?, max? }], labels: { key: { one, many } },
// starter }]. `word(key, opts)` is the page's words.
const markName = (m) => (m === 'driven' ? 'Driven' : 'Default');
const markAbout = (m, word) => (m === 'driven' ? `Set here. Nobody changes it in a ${word('space')}.` : `Starts like this. The ${word('owner')} may change it.`);
const scopeName = (scope, word) => (scope === 'space' ? `In each ${word('space')}` : scope === 'person' ? 'For each person' : `For the whole ${word('environment')}`);
const settingsOf = (m) => (Array.isArray(m.settings) ? m.settings.filter((d) => d && (d.template === 'driven' || d.template === 'default')) : []);
const optionLabel = (def, v) => ((def.options || []).find((o) => o.value === v) || {}).label || String(v);
function valueText(def, v) {
  if (v === undefined) return '<span class="hint">Its own</span>';
  if (def.type === 'boolean') return v ? 'On' : 'Off';
  if (def.type === 'choice') return e(optionLabel(def, v));
  if (def.type === 'list') return e(listWords(v));
  return e(String(v));
}
function settingControl(def, v, set) {
  const key = e(def.key);
  const off = set ? '' : ' disabled';
  if (def.type === 'boolean') return `<label class="tp-switch"><input type="checkbox" class="sdk-switch" role="switch" data-ts-value="${key}" aria-label="${e(def.label)}"${v === true || (v === undefined && def.default === true) ? ' checked' : ''}${off}></label>`;
  if (def.type === 'choice') return `<select data-ts-value="${key}" aria-label="${e(def.label)}"${off}>${(def.options || []).map((o) => `<option value="${e(o.value)}"${(v === undefined ? def.default : v) === o.value ? ' selected' : ''}>${e(o.label)}</option>`).join('')}</select>`;
  if (def.type === 'number') return `<input type="number" data-ts-value="${key}" aria-label="${e(def.label)}" value="${e(v === undefined ? (def.default ?? '') : v)}"${def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== undefined ? ` max="${def.max}"` : ''} step="any"${off}>`;
  if (def.type === 'color') return `<input type="color" data-ts-value="${key}" aria-label="${e(def.label)}" value="${e(/^#[0-9a-f]{6}$/i.test(v === undefined ? def.default : v) ? (v === undefined ? def.default : v) : '#000000')}"${off}>`;
  if (def.type === 'list') return `<div class="tp-list"${set ? '' : ' inert'}>${listControl({ ...def, value: Array.isArray(v) ? v : (Array.isArray(def.default) ? def.default : []) })}</div>`;
  return `<input type="text" data-ts-value="${key}" aria-label="${e(def.label)}" maxlength="${def.maxLength || 100}" value="${e(v === undefined ? (def.default ?? '') : v)}"${off}>`;
}
function moduleRow(t, m, { editable, word }) {
  const entry = entryOf(t, m.id);
  const on = offers(t, m.id);
  const settings = settingsOf(m);
  const starterCount = isObject(entry.starter) ? Object.keys(entry.starter).length : 0;
  const shown = entry.name || m.name;
  const pieces = [];
  if (settings.length) pieces.push(`${settings.length} setting${settings.length === 1 ? '' : 's'}`);
  if (starterCount) pieces.push('starter content');
  const head = editable
    ? `<label class="tp-offer sdk-choice-row"><input type="checkbox" data-tm-offer${on ? ' checked' : ''}${m.id === 'chat' ? ' disabled' : ''} aria-label="${e(`Offer ${m.name}`)}"><span class="sdk-choice-text"><strong>${iconTag(entry.icon || m.icon || 'puzzle-piece')} ${e(shown)}</strong></span></label>`
    : `<span class="tp-offer"><strong>${iconTag(entry.icon || m.icon || 'puzzle-piece')} ${e(shown)}</strong> <span class="sdk-status" data-tone="${on ? 'ok' : 'neutral'}">${on ? 'Offered' : 'Not offered'}</span></span>`;
  const nameFields = editable
    ? `<div class="tf-form"><label class="tf-field"><span class="field-label">Shown as</span><input type="text" data-tm-name maxlength="40" autocomplete="off" value="${e(entry.name || '')}" placeholder="${e(m.name)}"></label>`
      + `<label class="tf-field"><span class="field-label">Icon</span><span class="icon-field"><i class="fa-solid fa-${e(entry.icon || m.icon || 'puzzle-piece')} fa-fw" data-tm-preview aria-hidden="true"></i><input type="text" data-tm-icon maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(entry.icon || '')}" placeholder="${e(m.icon || 'puzzle-piece')}" aria-label="${e(`${m.name}: icon, a Font Awesome name`)}"></span></label></div>`
    : `<dl class="tf-read">${line('Shown as', e(shown))}${line('Icon', `${iconTag(entry.icon || m.icon || 'puzzle-piece')} ${entry.icon ? e(entry.icon) : '<span class="hint">Its own</span>'}`)}</dl>`;
  const settingBlock = settings.length ? `<h4>Settings</h4><div class="tp-settings">${settings.map((def) => {
    const given = entry.settings && Object.hasOwn(entry.settings, def.key);
    const v = given ? entry.settings[def.key] : undefined;
    const tail = `<span class="sdk-status" data-tone="${def.template === 'driven' ? 'warn' : 'neutral'}">${markName(def.template)}</span>`;
    const about = `${markAbout(def.template, word)} ${scopeName(def.scope, word)}.`;
    if (!editable) return `<div class="tp-setting" data-mark="${def.template}"><span class="tp-setting-name">${e(def.label)} ${tail}</span><span class="tp-setting-value">${valueText(def, v)}</span><span class="hint tp-setting-about">${e(about)}</span></div>`;
    return `<div class="tp-setting${def.type === 'list' ? ' tp-setting-list' : ''}" data-mark="${def.template}" data-ts="${e(def.key)}"><label class="sdk-choice-row tp-setting-set"><input type="checkbox" data-ts-set aria-label="${e(`This template sets ${def.label}`)}"${given ? ' checked' : ''}><span class="sdk-choice-text">${e(def.label)} ${tail}</span></label><span class="tp-setting-value">${settingControl(def, v, given)}</span><span class="hint tp-setting-about">${e(about)}</span></div>`;
  }).join('')}</div>` : '';
  const starterBlock = starterCount ? `<h4>Starter content</h4>${editable
    ? `<label class="sdk-choice-row"><input type="checkbox" data-tm-starter checked><span class="sdk-choice-text">Keep the starter content (${starterCount} ${starterCount === 1 ? 'object' : 'objects'}, made once when a ${e(word('space'))} is made)</span></label>`
    : `<p class="hint">${starterCount} ${starterCount === 1 ? 'object' : 'objects'}, made once when a ${e(word('space'))} is made.</p>`}` : '';
  const more = nameFields + settingBlock + starterBlock;
  return `<details class="tp-module" data-tm="${e(m.id)}"><summary class="tp-module-head">${head}<span class="hint tp-module-sum">${e(pieces.join(', '))}</span></summary><div class="tp-module-body">${more}</div></details>`;
}
export function modulesHtml(t, { editable, catalog, word }) {
  const all = t && t.modules === '*';
  const plain = catalog.filter((m) => !PLANNER_IDS.includes(m.id));
  const plans = catalog.filter((m) => PLANNER_IDS.includes(m.id));
  const group = (title, hint, list) => (list.length ? `<h3>${e(title)}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}<div class="tp-modules">${list.map((m) => moduleRow(t, m, { editable, word })).join('')}</div>` : '');
  return (all ? `<p class="hint">The Default template offers every ${e(word('module'))} there is.</p>` : '')
    + group(word('module', { many: true, cap: true }), editable ? `Tick the ${e(word('module', { many: true }))} this template offers. A ${e(word('space'))} cannot turn one off on its own; for different ${e(word('module', { many: true }))}, it picks another template.` : '', plain)
    + group('Plans', `Alternatives: a template offers the planner that fits.`, plans);
}
export function readModules(root, t, { editing = true } = {}) {
  const modules = {};
  for (const row of root.querySelectorAll('[data-tm]')) {
    const id = row.dataset.tm;
    if (!row.querySelector('[data-tm-offer]').checked) continue;
    const old = entryOf(t, id);
    const out = {};
    const name = row.querySelector('[data-tm-name]').value.trim();
    const icon = row.querySelector('[data-tm-icon]').value.trim().replace(/^fa-/, '');
    if (name) out.name = name;
    if (icon) out.icon = icon;
    const settings = {};
    for (const s of row.querySelectorAll('[data-ts]')) {
      if (!s.querySelector('[data-ts-set]').checked) continue;
      const listBox = s.querySelector('[data-list-setting]');
      if (listBox) { settings[s.dataset.ts] = readList(listBox); continue; }
      const input = s.querySelector('[data-ts-value]');
      if (!input) continue;
      settings[s.dataset.ts] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    }
    if (Object.keys(settings).length) out.settings = settings;
    if (isObject(old.labels) && Object.keys(old.labels).length) out.labels = old.labels; // the words are on Experience Labels
    const keep = row.querySelector('[data-tm-starter]');
    if (keep && keep.checked && isObject(old.starter)) out.starter = old.starter;
    modules[id] = out;
  }
  if (!Object.hasOwn(modules, 'chat')) modules.chat = {};
  return { modules };
}

// --- Experience Labels: the words each module lets a template rename ---------------------------------------------------------
// Under each offered module's name, one row per word the module declares (its manifest `labels`). A word left blank reads the
// module's own. Saved with the template's `modules` (the module's other parts are kept as they are), by `readModuleLabels`.
function labelRows(m, entry, editable) {
  return Object.entries(m.labels).map(([key, own]) => {
    const w = (entry.labels && entry.labels[key]) || null;
    const name = cap(key);
    if (!editable) return line(name, w ? `${e(w.one)} / ${e(w.many)}` : `<span class="hint">${e(own.one)} / ${e(own.many)}, the usual</span>`);
    return `<div class="tf-word" data-tm-label="${e(key)}" role="group" aria-label="${e(`${m.name}: ${name}`)}"><strong class="tf-word-name">${e(name)}</strong>`
      + `<label><span class="field-label">Singular</span><input type="text" data-tm-part="one" maxlength="30" autocomplete="off" spellcheck="false" value="${e(w ? w.one : '')}" placeholder="${e(own.one)}" aria-label="${e(`${m.name}: ${name}, singular`)}"></label>`
      + `<label><span class="field-label">Plural</span><input type="text" data-tm-part="many" maxlength="30" autocomplete="off" spellcheck="false" value="${e(w ? w.many : '')}" placeholder="${e(own.many)}" aria-label="${e(`${m.name}: ${name}, plural`)}"></label><span></span></div>`;
  }).join('');
}
export function moduleLabelsHtml(t, { editable, catalog, word }) {
  const mods = catalog.filter((m) => isObject(m.labels) && Object.keys(m.labels).length && offers(t, m.id));
  if (!mods.length) return '';
  const groups = mods.map((m) => {
    const entry = entryOf(t, m.id);
    const rows = labelRows(m, entry, editable);
    return `<section class="tp-label-group" data-tml="${e(m.id)}" aria-label="${e(entry.name || m.name)}"><h4>${iconTag(entry.icon || m.icon || 'puzzle-piece')} ${e(entry.name || m.name)}</h4>${editable ? `<div class="tf-words">${rows}</div>` : `<dl class="tf-read">${rows}</dl>`}</section>`;
  }).join('');
  return `<div class="tf-labels tp-module-labels"><h3>${e(word('module', { cap: true }))} words</h3><p class="hint">The words each ${e(word('module'))} uses for the things it holds, such as an event or a task. ${editable ? 'Leave a word blank for the usual one. Give both the singular and the plural.' : ''}</p>${groups}</div>`;
}
// The template's `modules` with each module's words as the fields say: `{ modules }`, or {} when the page drew none of them (the
// template offers every module, or none has words). A module the page did not draw is kept as it is.
export function readModuleLabels(root, t) {
  const groups = [...root.querySelectorAll('[data-tml]')];
  if (!groups.length || !isObject(t && t.modules)) return {};
  const modules = {};
  for (const [id, entry] of Object.entries(t.modules)) modules[id] = isObject(entry) ? { ...entry } : {};
  for (const g of groups) {
    const id = g.dataset.tml;
    if (!Object.hasOwn(modules, id)) continue;
    const labels = {};
    for (const l of g.querySelectorAll('[data-tm-label]')) {
      const one = l.querySelector('[data-tm-part="one"]').value.trim();
      const many = l.querySelector('[data-tm-part="many"]').value.trim();
      if (one || many) labels[l.dataset.tmLabel] = { one, many };
    }
    if (Object.keys(labels).length) modules[id].labels = labels; else delete modules[id].labels;
  }
  return { modules };
}
// After a page that holds list settings is drawn: the colour pickers over the rows' colour fields.
export const upgradeLists = (root) => upgradeColourInputs(root);

// Behaviour of the pages' fields in `root` (call once; the fields can be drawn again inside it).
export function wirePages(root) {
  root.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('[data-list-setting]')) { listClick(ev); return; }
    const phase = t.closest('[data-tp-phase]');
    if (phase && t.closest('[data-tp-remove]')) phase.remove();
    else if (phase && t.closest('[data-tp-up]') && phase.previousElementSibling) phase.parentElement.insertBefore(phase, phase.previousElementSibling);
    else if (phase && t.closest('[data-tp-down]') && phase.nextElementSibling) phase.parentElement.insertBefore(phase.nextElementSibling, phase);
    else if (t.closest('[data-tp-add]')) {
      const list = root.querySelector('[data-tp-list]');
      if (list.children.length >= 12) return;
      list.insertAdjacentHTML('beforeend', phaseRow({}));
      list.lastElementChild.querySelector('[data-tp-label]').focus();
    } else if (t.closest('[data-tr-remove]')) t.closest('.tp-reaction').remove();
    else if (t.closest('[data-tr-add]')) { root.querySelector('[data-tr-list]').insertAdjacentHTML('beforeend', reactionRow({})); root.querySelector('[data-tr-list]').lastElementChild.querySelector('.reaction-glyph').focus(); }
    else if (t.closest('[data-ti-remove]')) t.closest('[data-ti-row]').remove();
    else if (t.closest('[data-ti-add]')) { root.querySelector('[data-ti-list]').insertAdjacentHTML('beforeend', iconRow('')); root.querySelector('[data-ti-list]').lastElementChild.querySelector('[data-ti-name]').focus(); }
  });
  root.addEventListener('change', (ev) => {
    const set = ev.target.closest('[data-ts-set]');
    if (set) {
      for (const input of set.closest('[data-ts]').querySelectorAll('[data-ts-value]')) input.disabled = !set.checked;
      for (const list of set.closest('[data-ts]').querySelectorAll('.tp-list')) list.inert = !set.checked; // a list is not one field: all of it goes off
    }
    if (ev.target.matches('[data-tp-main]') && ev.target.checked) for (const other of root.querySelectorAll('[data-tp-main]')) if (other !== ev.target) other.checked = false; // one main phase
    if (ev.target.matches('[data-tp-measure]')) {
      const about = root.querySelector('[data-tp-measure-about]');
      if (about) about.textContent = (MEASURES.find(([v]) => v === ev.target.value) || MEASURES[0])[2];
    }
  });
  root.addEventListener('input', (ev) => {
    if (ev.target.matches('[data-ti-name]')) {
      const preview = ev.target.closest('[data-ti-row]').querySelector('.icon-preview');
      const n = ev.target.value.trim().replace(/^fa-/, '');
      preview.innerHTML = /^[a-z0-9-]+$/.test(n) ? iconTag(n) : '';
    }
    if (ev.target.matches('[data-tm-icon]')) {
      const p = ev.target.closest('.icon-field').querySelector('[data-tm-preview]');
      const n = ev.target.value.trim().replace(/^fa-/, '') || ev.target.placeholder;
      if (/^[a-z0-9-]+$/.test(n)) p.className = `fa-solid fa-${n} fa-fw`;
    }
  });
}
