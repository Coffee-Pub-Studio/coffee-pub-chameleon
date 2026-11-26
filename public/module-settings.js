// The forms for the settings modules declare (module.json `settings`): one card per module that has settings of
// a scope, one control per setting, a Save on each card. Used on the Modules tab (the server's), a space's page (the
// space's), the page a space's moderators use (module-settings.html) and the profile page (a person's own); and,
// without the cards' Saves (`draft: true`), in the Set up panel's modules tab, whose own Save sends them. The
// server decides who may change what; this only draws what it is given.
import { api, escapeHtml, word, accessKeyHeaders } from '/brand.js';
import { confirmDialog } from '/confirm.js';
import { colourFields } from '/colour-field.js';
import { listControl, readList, wireList, listWords } from '/list-rows.js';

// A secret setting (a key): a write-only box. It is always empty when drawn; the server never sends the value, only whether one
// is set. "Replace" opens the box, "Clear" takes the key away now. Only an owner is ever given this form (the settings route is
// the owner's), so nobody else sees the control.
function secretControl(def, id) {
  const set = Boolean(def.value && def.value.set);
  const state = set ? 'Set' : def.value && def.value.unreadable ? 'Not set: the saved key cannot be read, enter it again' : 'Not set';
  return `<div class="secret-setting" data-key="${escapeHtml(def.key)}" data-secret-setting>
    <div class="hint" id="${id}-label">${escapeHtml(def.label)} <span class="sdk-status" data-secret-state role="status">${escapeHtml(state)}</span></div>
    <div class="row"><input id="${id}" type="password" data-secret-input autocomplete="new-password" autocapitalize="off" spellcheck="false" value="" maxlength="${Number(def.maxLength) || 200}" aria-labelledby="${id}-label" ${set ? 'hidden' : ''}>
    <button type="button" class="btn btn-small" data-secret-replace ${set ? '' : 'hidden'}>Replace</button>
    <button type="button" class="btn btn-small btn-danger" data-secret-clear ${set ? '' : 'hidden'}>Clear</button></div>
  </div>`;
}
function showSecretState(box, value) {
  const set = Boolean(value && value.set);
  const input = box.querySelector('[data-secret-input]');
  input.value = '';
  input.hidden = set;
  box.querySelector('[data-secret-replace]').hidden = !set;
  box.querySelector('[data-secret-clear]').hidden = !set;
  box.querySelector('[data-secret-state]').textContent = set ? 'Set' : value && value.unreadable ? 'Not set: the saved key cannot be read, enter it again' : 'Not set';
}

function control(def, draft = false) {
  if (def.type === 'list') return listControl(def);
  if (def.type === 'secret') return secretControl(def, `ms-${def.key}`);
  const id = `ms-${def.key}`;
  if (def.type === 'boolean') return `<label class="sdk-choice-row"><input type="checkbox" data-key="${escapeHtml(def.key)}" ${def.value ? 'checked' : ''}><span class="sdk-choice-text">${escapeHtml(def.label)}</span></label>`;
  // A note has no control and no value: a label (its help under it), for a module to say where something is set up.
  if (def.type === 'note') return `<span class="field-label">${escapeHtml(def.label)}</span>`; // its help follows, as every setting's does
  const head = `<label>${escapeHtml(def.label)}`;
  if (def.type === 'choice') return `${head}<select data-key="${escapeHtml(def.key)}">${def.options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === def.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>${def.options.some((o) => o.help) ? '<div class="option-help" data-option-help></div>' : ''}`;
  // A setting the host keeps for every environment (a shared folder, or the address regions are cut from): shown, never set here.
  if (def.shared === true) { // true only when the host really keeps it: the listing also carries the manifest's own "host" flag on a single install
    const files = def.type === 'files' ? (def.available || []) : [];
    const list = files.length ? `<ul class="shared-files">${files.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : def.type === 'files' ? '<p class="hint">The host has no files here yet.</p>' : '';
    return `<div data-shared><div class="hint">${escapeHtml(def.label)} <span class="sdk-status">Provided by the host</span></div>${list}${def.type !== 'files' && def.value ? `<p class="hint">${escapeHtml(String(def.value))}</p>` : ''}</div>`;
  }
  if (def.type === 'files') {
    const chosen = new Set(Array.isArray(def.value) ? def.value : def.value ? [def.value] : []);
    const size = (n) => { const b = (def.sizes || {})[n]; return b === undefined ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`; };
    // How detailed a map file is (street-level or not), read from its own PMTiles header -- blank for anything else.
    const zoom = (n) => { const z = (def.zooms || {})[n]; return z ? (z.minZoom === z.maxZoom ? `${z.maxZoom}` : `${z.minZoom}–${z.maxZoom}`) : ''; };
    const hasZooms = Object.keys(def.zooms || {}).length > 0;
    // What a PMTiles file holds, read from its own header: "Picture" (picture tiles) or "Map data"; blank when it says nothing.
    const kind = (n) => KIND_WORDS[(def.kinds || {})[n]] || '';
    const hasKinds = Object.keys(def.kinds || {}).length > 0;
    const rows = (def.available || []).map((n) => `<tr><td class="sdk-table-check"><input type="checkbox" value="${escapeHtml(n)}" ${chosen.has(n) ? 'checked' : ''} aria-label="Use ${escapeHtml(n)}"></td><th scope="row">${escapeHtml(n)}</th>${hasKinds ? `<td class="sdk-table-dim">${kind(n)}</td>` : ''}${hasZooms ? `<td class="sdk-table-dim">${zoom(n)}</td>` : ''}<td class="num sdk-table-dim">${size(n)}</td><td><button type="button" class="btn btn-small btn-danger" data-delete-file="${escapeHtml(n)}" data-tip="Delete ${escapeHtml(n)}" aria-label="Delete ${escapeHtml(n)}"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td></tr>`).join('');
    return `<div data-key="${escapeHtml(def.key)}" data-files data-folder="${escapeHtml(folderName(def))}"><div class="hint">${escapeHtml(def.label)}</div>${rows ? `<div class="sdk-table-wrap"><table class="sdk-table" aria-label="${escapeHtml(def.label)}"><thead><tr><th scope="col" class="sdk-table-check">Use</th><th scope="col">File</th>${hasKinds ? '<th scope="col">Type</th>' : ''}${hasZooms ? '<th scope="col">Zoom</th>' : ''}<th scope="col" class="num">Size</th><th scope="col"><span class="visually-hidden">Delete</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}</div>`;
  }
  if (def.type === 'file') return `${head}<select data-key="${escapeHtml(def.key)}"><option value="">None</option>${(def.available || []).map((n) => `<option value="${escapeHtml(n)}" ${n === def.value ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>${(def.available || []).length && !(def.skipped || []).length ? '' : `<p class="hint">${escapeHtml(fileHint(def))}</p>`}${def.upload && !draft ? uploadRow(def) : ''}`;
  if (def.type === 'url') return `${head}<input id="${id}" type="url" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="500" placeholder="https://"></label>`;
  if (def.type === 'number') return `${head}<input id="${id}" type="number" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} step="any"></label>`;
  if (def.type === 'color') return `${head}<input id="${id}" type="text" data-colour-field data-key="${escapeHtml(def.key)}" value="${escapeHtml(/^#[0-9a-f]{6}$/i.test(def.value) ? def.value : '#000000')}"></label>`;
  // A repository the space follows (`follows: "issues"`): the box (no data-key: it is never part of Save, the pull's own record on the
  // server is the truth and the box shows it), one button that follows or stops following at once, and one line saying how it stands,
  // all filled in by wireFollows once the card is drawn. With no space yet the block is left out.
  if (def.follows === 'issues') {
    return `${head}<input id="${id}" type="text" data-follows-input maxlength="${def.maxLength || 100}" autocapitalize="off" spellcheck="false" placeholder="owner/name or the repository's address"></label><div class="follows-pull" data-follows="${escapeHtml(def.key)}"><div class="row"><button type="button" class="btn btn-primary btn-small" data-follows-toggle hidden></button></div><p class="hint" data-follows-line role="status" aria-live="polite">Looking...</p><div data-follows-write hidden><label class="sdk-choice-row"><input type="checkbox" role="switch" data-follows-write-input aria-describedby="follows-write-${escapeHtml(def.key)}"><span class="sdk-choice-text" data-follows-write-label>Changes here go to GitHub</span></label><p class="hint" id="follows-write-${escapeHtml(def.key)}" data-follows-write-line role="status" aria-live="polite"></p></div></div>`;
  }
  return `${head}<input id="${id}" type="text" data-key="${escapeHtml(def.key)}" value="${escapeHtml(def.value)}" maxlength="${def.maxLength || 100}"></label>`;
}

// The "Follows GitHub" block under a repository box (see control). It reads the space's pull (GET /api/spaces/:id/issues-pull) and has
// one button: "Follow this repository" stores the repository typed in the box and turns the pull on in one step (PUT), "Stop following"
// turns it off. Neither waits for Save: the box is no part of Save, the server's record is the truth and the box shows its owner/name.
// One line says how it stands; a refusal is the server's own sentence (terms not accepted, a plan that is not empty, not the owner).
function wireFollows(box, space) {
  const toggle = box.querySelector('[data-follows-toggle]');
  const line = box.querySelector('[data-follows-line]');
  const input = box.closest('.module-setting').querySelector('input[data-follows-input]');
  const writeBox = box.querySelector('[data-follows-write]');
  const writeInput = box.querySelector('[data-follows-write-input]');
  const writeLine = box.querySelector('[data-follows-write-line]');
  const route = `/api/spaces/${encodeURIComponent(space)}/issues-pull`;
  const at = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
  let on = false;
  const say = (text, error = false) => { line.textContent = text; line.classList.toggle('error', error); };
  const draw = (v) => {
    on = Boolean(v && v.on);
    const name = (v && v.name) || 'GitHub';
    toggle.textContent = on ? 'Stop following' : 'Follow this repository';
    toggle.classList.toggle('btn-primary', !on);
    toggle.classList.toggle('btn-danger', on);
    toggle.hidden = false;
    if (input) {
      input.readOnly = on;
      if (v && v.repo && (on || !input.value)) input.value = v.repo; // the server's clean owner/name, never what was pasted
    }
    // The switch for changes going back: only while following, and on only when the server is set up for this repository.
    writeBox.hidden = !on;
    box.querySelector('[data-follows-write-label]').textContent = `Changes here go to ${name}`;
    writeInput.checked = Boolean(on && v.write);
    writeInput.disabled = !(on && v.canWrite);
    writeLine.classList.remove('error');
    writeLine.textContent = !on ? '' : v.canWrite ? `Moves, closes, titles and tags made here change the issues on ${name}, as the account that owns this server's token.` : `This server is not set up to change ${name} for this repository.`;
    if (!on) say('Not following. Enter a repository and press Follow this repository.');
    else if (v.error) say(v.error, true);
    else if (v.last) say(`Following ${v.repo}, last pulled ${at(v.last)}.`);
    else say(`Waiting for the first pull from ${name}.`);
  };
  writeInput.addEventListener('change', async () => {
    const want = writeInput.checked;
    writeInput.disabled = true;
    try {
      draw(await api('PUT', route, { write: want }));
    } catch (err) {
      writeInput.checked = !want;
      writeLine.textContent = err.message;
      writeLine.classList.add('error');
      writeInput.disabled = false;
    }
  });
  api('GET', route).then(draw).catch((err) => { toggle.hidden = true; say(err.message, true); });
  toggle.addEventListener('click', async () => {
    const repo = (input ? input.value : '').trim();
    if (!on && !repo) { say('Enter the repository as owner/name, or paste its address, first.', true); return; }
    if (on && !await confirmDialog({ title: 'Stop following?', message: 'The work already pulled stays in the plan as your own, and can be changed here again.', action: 'Stop following', kind: 'destructive' })) return;
    toggle.disabled = true;
    try {
      draw(await api('PUT', route, on ? { on: false } : { on: true, repo }));
    } catch (err) {
      say(err.message, true);
    }
    toggle.disabled = false;
  });
}

// A `file` setting that takes an upload (module.json `upload`): choose a file to put it here, or Clear to take it away. Both
// act at once and do not wait for Save; the line under the buttons says how it went.
const KIND_WORDS = { picture: 'Picture', vector: 'Map data' };
// The settings listing's `folder` is the folder's path on the server (the scan's answer replaces the manifest's name); the
// routes want the folder's own name, its last part.
const folderName = (def) => String(def.folder || '').split(/[\\/]/).filter(Boolean).pop() || '';
function uploadRow(def) {
  const key = escapeHtml(def.key);
  return `<div class="upload-row" data-upload="${key}" data-folder="${escapeHtml(folderName(def))}">
    <label class="upload-pick">Upload a .pmtiles file <input type="file" accept=".pmtiles" data-upload-input aria-describedby="up-${key}-hint"></label>
    <button type="button" class="btn btn-small btn-danger" data-clear-file="${key}" ${def.value ? '' : 'disabled'}>Clear</button> <span class="status" data-upload-status role="status" aria-live="polite"></span>
    <p class="hint" id="up-${key}-hint">Choosing a file uploads it now, and Clear removes it now. Neither waits for Save.</p>
  </div>`;
}
// Send a file to PUT /api/modules/<id>/files/<folder>?name=<name>. XHR, because fetch cannot report progress. `onLine(text,
// error)` gets the progress line and the end. Resolves with the server's answer; rejects with an Error holding its sentence.
function sendFile(moduleId, folder, file, onLine) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/modules/${encodeURIComponent(moduleId)}/files/${encodeURIComponent(folder)}?name=${encodeURIComponent(file.name)}`);
    for (const [k, v] of Object.entries(accessKeyHeaders())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onLine(`Uploading... ${Math.min(100, Math.floor((e.loaded / e.total) * 100))}%`); };
    xhr.upload.onload = () => onLine('Checking the file...');
    xhr.onerror = () => reject(new Error('The upload was cut off. Check the connection and try again.'));
    xhr.onabort = xhr.onerror;
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(typeof data.error === 'string' && data.error ? data.error : `The server answered ${xhr.status}.`));
    };
    xhr.send(file);
  });
}

// Why the list of files is empty, from what the server found in the folder.
function fileHint(def) {
  const where = def.path ? `Looking in ${def.path}` : `Looking in the ${word('module')}'s folder in the data folder`;
  if (def.exists === false) return `${where}, which does not exist yet. Create it and copy the file in.`;
  const skipped = def.skipped || [];
  if ((def.available || []).length) return `The server ignored ${skipped.length} other file${skipped.length === 1 ? '' : 's'} in ${def.path || 'the folder'}: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  if (skipped.length) return `${where}, which has ${skipped.length} file${skipped.length === 1 ? '' : 's'} The server ignored: ${skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}.`;
  return `${where}, which is empty. Copy the file in.`;
}

// What a card's controls say now, by key, as the server takes them (a list's rows, the files ticked, a switch, a number).
// How a template's value reads in a sentence (a choice by its label, a switch as On or Off).
function valueWords(def, v) {
  if (def.type === 'boolean') return v ? 'On' : 'Off';
  if (def.type === 'choice') return ((def.options || []).find((o) => o.value === v) || {}).label || String(v);
  if (def.type === 'list') return listWords(v);
  return String(v);
}
// What a template does to a setting, under its control (plan-templates-redesign.md, decision 14): driven (and given) is set by
// the template and read only; default is the template's until someone's own value is kept, which "Use the template's" drops.
// A setting the template does not give, or the module's own, says nothing. `templateName` is there only for those who may
// change the place (an owner, a moderator, the admin).
function markLine(def, draft) {
  if (!def.template || def.templateValue === undefined) return '';
  const from = def.templateName ? `the ${escapeHtml(def.templateName)} template` : 'the template';
  const given = escapeHtml(valueWords(def, def.templateValue));
  if (def.locked) return `<p class="setting-mark" data-mark="driven"><span class="sdk-status" data-tone="warn">Driven</span> <span class="hint">Set by ${from}: ${given}. It can't be changed here.</span></p>`;
  if (def.template !== 'default') return '';
  if (!def.stored) return `<p class="setting-mark" data-mark="default"><span class="sdk-status" data-tone="neutral">Default</span> <span class="hint">From ${from}. Change it to keep your own.</span></p>`;
  const reset = def.type === 'list' && draft ? '' : `<button class="btn btn-small" type="button" data-use-template="${escapeHtml(def.key)}">Use the template's</button>`;
  return `<p class="setting-mark" data-mark="default"><span class="sdk-status" data-tone="neutral">Default</span> <span class="hint">Yours. ${from} has ${given}.</span>${reset}</p>`;
}
function readCard(card, module) {
  const values = {};
  for (const el of card.querySelectorAll('[data-key]')) {
    const def = module.settings.find((d) => d.key === el.dataset.key);
    if (!def) continue;
    if (def.locked) continue; // the template drives it: nothing here writes it
    if (def.type === 'secret') { // sent only when something was typed: an empty box leaves the saved key as it is
      const typed = el.querySelector('[data-secret-input]').value;
      if (typed) values[def.key] = typed;
      continue;
    }
    const v = def.type === 'list' ? readList(el) : def.type === 'files' ? [...el.querySelectorAll('input:checked')].map((i) => i.value) : def.type === 'boolean' ? el.checked : def.type === 'number' ? Number(el.value) : el.value;
    // A default the template seeds, left as it was shown, stays the template's: saving the form does not keep it as the person's own.
    if (def.template === 'default' && !def.stored && JSON.stringify(v) === JSON.stringify(def.value)) continue;
    values[def.key] = v;
  }
  return values;
}

// Fill `container` with the settings of one scope ('environment', 'space' with { space }, or 'person'). The container is
// left hidden when there is nothing to set. Two modes:
//   - each card with its own Save (the default: Manage's Modules tab, Profile, the old space pages), which sends its
//     values as it is pressed;
//   - `draft: true` (the Set up panel, plan-setup-panel.md, step 5): no Save on the cards; nothing is sent from here
//     but deleting a file (an action, at once). The answer reports the values and what changed, so the surface's own
//     Save sends them: { modules, changes(), saved(id), sectionOf(id) }. `changes()` is [{ id, name, values }] for each
//     module whose values differ from what was drawn; `saved(id)` makes the values now shown the ones to compare with;
//     `sectionOf(id)` is the module's section (its element). `onChange()` is told after any edit (and after a file is deleted).
// The answer is null when there is nothing to set (or the person may not set it).
export async function renderModuleSettings(container, { scope, space = null, only = '', heading = true, draft = false, onChange = null }) {
  container.hidden = true;
  let modules;
  try {
    const q = space ? `?space=${encodeURIComponent(space)}` : '';
    modules = (await api('GET', `/api/module-settings/${scope}${q}`)).modules;
  } catch {
    return null; // not something this person may set here
  }
  if (only) modules = modules.filter((m) => m.id === only);
  if (!modules.length) return null;
  container.hidden = false;
  const headingHtml = (m) => (draft
    ? `<h4 class="module-settings-name" id="module-settings-name-${escapeHtml(m.id)}"><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}</h4>`
    : `<h3><i class="fa-solid fa-${escapeHtml(m.icon)} fa-fw" aria-hidden="true"></i> ${escapeHtml(m.name)}</h3>`);
  container.innerHTML = modules.map((m) => `
    <div class="module-settings-card${draft ? ' module-settings-draft' : ''}" data-module="${escapeHtml(m.id)}"${draft ? ` role="group" aria-labelledby="module-settings-name-${escapeHtml(m.id)}"` : ''}>
      ${heading ? headingHtml(m) : ''}
      <div class="module-settings-fields">${m.settings.map((d) => `<div class="module-setting"${d.locked ? ' data-locked' : ''}${d.showWhen ? ` data-when-key="${escapeHtml(d.showWhen.key)}" ${d.showWhen.not !== undefined ? `data-when-not="${escapeHtml(d.showWhen.not)}"` : `data-when-value="${escapeHtml(d.showWhen.value)}"`}` : ''}>${control(d, draft)}${d.help ? `<p class="hint">${escapeHtml(d.help)}</p>` : ''}${markLine(d, draft)}</div>`).join('')}</div>
      ${draft ? '' : '<div class="row"><button class="btn btn-primary btn-small" data-save type="button">Save</button><span class="status" data-status></span></div>'}
    </div>`).join('');
  // What the chosen option says (its own help, more than a line can hold), and the settings that only apply to a choice.
  const linkify = (text) => escapeHtml(text).replace(/https:\/\/[^\s<)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const refresh = (card) => {
    const module = modules.find((m) => m.id === card.dataset.module);
    const value = (key) => { const el = card.querySelector(`[data-key="${key}"]`); return el ? (el.type === 'checkbox' ? String(el.checked) : el.value) : ''; };
    for (const sel of card.querySelectorAll('select[data-key]')) {
      const def = module.settings.find((d) => d.key === sel.dataset.key);
      const box = sel.closest('.module-setting').querySelector('[data-option-help]');
      const option = def && def.options && def.options.find((o) => o.value === sel.value);
      if (box) box.innerHTML = option && option.help ? option.help.split(/\n+/).map((p) => `<p class="hint">${linkify(p)}</p>`).join('') : '';
    }
    for (const row of card.querySelectorAll('[data-when-key]')) row.hidden = row.dataset.whenNot !== undefined ? value(row.dataset.whenKey) === row.dataset.whenNot : value(row.dataset.whenKey) !== row.dataset.whenValue;
  };
  // What a template drives is read only: its controls stay, drawn off.
  for (const row of container.querySelectorAll('.module-setting[data-locked]')) {
    for (const el of row.querySelectorAll('input, select, textarea, button:not([data-use-template])')) el.disabled = true;
    for (const list of row.querySelectorAll('[data-list-setting]')) list.inert = true; // the icon picker is not a field: nothing in a driven list opens
  }
  colourFields(container); // the colour settings and the list rows' colours: the SDK's colour picker on each
  for (const box of container.querySelectorAll('[data-list-setting]')) wireList(box);
  for (const box of container.querySelectorAll('[data-follows]')) { if (space) wireFollows(box, space); else box.closest('.module-setting').remove(); }
  for (const card of container.querySelectorAll('.module-settings-card')) {
    refresh(card);
    card.addEventListener('change', () => refresh(card));
  }
  const cardOf = (id) => [...container.querySelectorAll('.module-settings-card')].find((c) => c.dataset.module === id) || null;
  // The draft mode's baseline: what each card said when it was drawn (or last saved).
  const baseline = new Map();
  const remember = (id) => { const card = cardOf(id); const module = modules.find((m) => m.id === id); if (card && module) baseline.set(id, JSON.stringify(readCard(card, module))); };
  if (draft) for (const m of modules) remember(m.id);
  const told = () => { if (typeof onChange === 'function') onChange(); };
  container.onclick = async (event) => {
    const useBtn = event.target.closest('[data-use-template]');
    if (useBtn) {
      // Drops the kept value so the template's reads again; at once, as deleting a file is, and the form shows it.
      const card = useBtn.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const def = module.settings.find((d) => d.key === useBtn.dataset.useTemplate);
      useBtn.disabled = true;
      try {
        const answer = await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values: { [def.key]: null }, ...(space ? { space } : {}) });
        if (!draft) { await renderModuleSettings(container, { scope, space, only, heading }); return; }
        const fresh = (answer.settings || []).find((d) => d.key === def.key);
        if (fresh) Object.assign(def, fresh);
        const el = card.querySelector(`[data-key="${CSS.escape(def.key)}"]`);
        if (el && def.type === 'boolean') el.checked = Boolean(def.value);
        else if (el) el.value = def.value;
        useBtn.closest('.setting-mark').outerHTML = markLine(def, draft);
        const was = JSON.parse(baseline.get(module.id) || '{}');
        delete was[def.key];
        baseline.set(module.id, JSON.stringify(was));
        refresh(card);
        told();
      } catch (err) {
        useBtn.disabled = false;
        window.alert(err.message);
      }
      return;
    }
    const delBtn = event.target.closest('[data-delete-file]');
    if (delBtn) {
      const card = delBtn.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const name = delBtn.dataset.deleteFile;
      const folder = delBtn.closest('[data-files]')?.dataset.folder || '';
      if (!await confirmDialog({ title: `Delete ${name}?`, message: "This can't be undone.", action: 'Delete', kind: 'final' })) return;
      delBtn.disabled = true;
      try {
        await api('DELETE', `/api/modules/${encodeURIComponent(module.id)}/files/${encodeURIComponent(name)}${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`);
        if (!draft) {
          await renderModuleSettings(container, { scope, space, only, heading });
          return;
        }
        // In the draft mode the other edits stay: the file's row goes, and the baseline forgets it too, so a file that
        // was ticked does not read as a change.
        const row = delBtn.closest('tr');
        const box = delBtn.closest('[data-files]');
        if (row) row.remove();
        if (box && !box.querySelector('tbody tr')) box.querySelector('.sdk-table-wrap')?.remove();
        const was = JSON.parse(baseline.get(module.id) || '{}');
        if (box && Array.isArray(was[box.dataset.key])) was[box.dataset.key] = was[box.dataset.key].filter((n) => n !== name);
        baseline.set(module.id, JSON.stringify(was));
        told();
      } catch (err) {
        delBtn.disabled = false;
        window.alert(err.message);
      }
      return;
    }
    const clearBtn = event.target.closest('[data-clear-file]');
    if (clearBtn) {
      const row = clearBtn.closest('[data-upload]');
      const module = modules.find((m) => m.id === clearBtn.closest('.module-settings-card').dataset.module);
      const def = module.settings.find((d) => d.key === row.dataset.upload);
      const name = def && def.value;
      if (!name || !await confirmDialog({ title: `Clear ${name}?`, message: "The file is deleted now. This can't be undone.", action: 'Clear', kind: 'final' })) return;
      clearBtn.disabled = true;
      const line = row.querySelector('[data-upload-status]');
      try {
        await api('DELETE', `/api/modules/${encodeURIComponent(module.id)}/files/${encodeURIComponent(name)}?folder=${encodeURIComponent(row.dataset.folder)}`);
        await renderModuleSettings(container, { scope, space, only, heading });
        sayUpload(container, row.dataset.upload, `${name} cleared.`);
      } catch (err) {
        clearBtn.disabled = false;
        line.textContent = err.message;
        line.classList.add('error');
      }
      return;
    }
    const replaceBtn = event.target.closest('[data-secret-replace]');
    if (replaceBtn) {
      const box = replaceBtn.closest('[data-secret-setting]');
      const input = box.querySelector('[data-secret-input]');
      input.hidden = false;
      replaceBtn.hidden = true;
      input.focus();
      return;
    }
    const clearSecret = event.target.closest('[data-secret-clear]');
    if (clearSecret) {
      const box = clearSecret.closest('[data-secret-setting]');
      const card = box.closest('.module-settings-card');
      const module = modules.find((m) => m.id === card.dataset.module);
      const def = module.settings.find((d) => d.key === box.dataset.key);
      if (!await confirmDialog({ title: `Clear ${def.label}?`, message: 'The saved key is deleted now. This can\'t be undone.', action: 'Clear', kind: 'final' })) return;
      clearSecret.disabled = true;
      try {
        const answer = await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values: { [def.key]: '' }, ...(space ? { space } : {}) });
        showSecretState(box, (answer.settings.find((d) => d.key === def.key) || {}).value);
      } catch (err) {
        window.alert(err.message);
      }
      clearSecret.disabled = false;
      return;
    }
    if (draft) { if (event.target.closest('[data-list], [data-icon-choice]')) told(); return; }
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const card = button.closest('.module-settings-card');
    const status = card.querySelector('[data-status]');
    const module = modules.find((m) => m.id === card.dataset.module);
    const values = readCard(card, module);
    status.classList.remove('error');
    status.textContent = 'saving...';
    try {
      const answer = await api('PUT', `/api/modules/${encodeURIComponent(module.id)}/settings/${scope}`, { values, ...(space ? { space } : {}) });
      for (const box of card.querySelectorAll('[data-secret-setting]')) showSecretState(box, ((answer.settings || []).find((d) => d.key === box.dataset.key) || {}).value); // the box empties; only Set or Not set shows
      status.textContent = 'saved';
      // How each setting stands with the template now (a value kept, or back to the template's): its line is drawn again.
      for (const fresh of answer.settings || []) {
        const def = module.settings.find((d) => d.key === fresh.key);
        const row = def && card.querySelector(`[data-key="${CSS.escape(def.key)}"]`)?.closest('.module-setting');
        if (!row) continue;
        Object.assign(def, { template: fresh.template, templateValue: fresh.templateValue, templateName: fresh.templateName, locked: fresh.locked, stored: fresh.stored });
        if (def.type !== 'secret' && def.type !== 'files') def.value = fresh.value;
        row.querySelector('.setting-mark')?.remove();
        row.insertAdjacentHTML('beforeend', markLine(def, draft));
      }
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    }
  };
  // A file chosen in an upload row goes up at once (see uploadRow).
  if (container._uploadChange) container.removeEventListener('change', container._uploadChange); // drawn again: one listener only
  container._uploadChange = async (event) => {
    const input = event.target.closest('[data-upload-input]');
    if (!input || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const row = input.closest('[data-upload]');
    const module = modules.find((m) => m.id === row.closest('.module-settings-card').dataset.module);
    const line = row.querySelector('[data-upload-status]');
    const clear = row.querySelector('[data-clear-file]');
    const was = clear.disabled;
    line.classList.remove('error');
    line.textContent = 'Uploading... 0%';
    input.disabled = true;
    clear.disabled = true;
    try {
      await sendFile(module.id, row.dataset.folder, file, (text) => { line.textContent = text; });
      await renderModuleSettings(container, { scope, space, only, heading });
      sayUpload(container, row.dataset.upload, `${file.name} uploaded.`);
    } catch (err) {
      input.disabled = false;
      input.value = '';
      clear.disabled = was;
      line.textContent = err.message;
      line.classList.add('error');
    }
  };
  container.addEventListener('change', container._uploadChange);
  if (draft) {
    container.oninput = () => told();
    container.onchange = () => told();
  }
  return {
    modules,
    sectionOf: cardOf,
    changes: () => modules.filter((m) => cardOf(m.id) && JSON.stringify(readCard(cardOf(m.id), m)) !== baseline.get(m.id)).map((m) => ({ id: m.id, name: m.name, values: readCard(cardOf(m.id), m) })),
    saved: (id) => remember(id),
  };
}

// The line under an upload row after the card was drawn again (the new file is in the list and chosen).
function sayUpload(container, key, text) {
  const line = container.querySelector(`[data-upload="${key}"] [data-upload-status]`);
  if (line) line.textContent = text;
}
