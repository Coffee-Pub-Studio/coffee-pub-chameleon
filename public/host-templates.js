// The host console's Templates section (plan-environment-templates.md, addendum 3, GitHub #91; plan-host-console.md): a
// table of every template (bundled, the host's own), with its kind, version, the environments that use it by name, the
// Hidden switch and a More menu (Edit, Export, Duplicate, Reset to shipped, Delete). A bundled template can be edited in
// place (an Edited badge, Reset to shipped, and a notice when a newer image changed the file). Duplicate makes a host
// template. Import file from a file (a clashing id asks for another). The editor is its own view (#templates/<id>, or
// /new), its parts as tabs, one at a time, each with its own address (#templates/<id>/<part>; decision 52).
import { api, escapeHtml, word } from '/brand.js';
import { basicsHtml, labelsHtml, readBasics, readLabels, wireFields } from '/template-fields.js';
import { setFoldHtml, setReactionChips, setIconChips, problemPlaces } from '/template-pages.js';
import { mountTemplateLayout, templateLayoutModules, usesNote } from '/template-layout.js';
import { partsFor } from '/layout-picker.js';
import { fileText } from '/file-text.js';
import { confirmDialog } from '/confirm.js';
import { openHostMenu } from '/host-menu.js';

const $ = (id) => document.getElementById(id);
const say = (el, text, error = false) => { el.textContent = text; el.classList.toggle('error', error); el.hidden = !text; };
let product = ''; // the product's name (PRODUCT_NAME), from the host console's settings; see initTemplates
// "That isn't a <product> template file.", or "a template file" before the name is known.
const fileOfKind = (kind) => (product ? `${product} ${kind} file` : `${kind} file`);
const BUILT_IN = ['conference', 'chat'];
const SOURCE = { bundled: 'Bundled', host: 'Own' };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const DEFAULT_ID = 'default'; // the Default template: nobody changes, hides or deletes it, the host included

let list = []; // GET /api/host/templates: [{ id, name, description, source, version, hidden, edited, update, usedBy, usedBySpaces }]
let onChange = () => {};
let nameOf = (slug) => slug; // an environment's name, from host.js's list
let ready = false; // the list has come from host.js
let pendingView = null; // an editor asked for (#templates/<id>/<part>) before the list came: [id, part]
let editing = null; // the template being edited in full, or null for a new one
let layoutPart = null; // the Default Workspace's layout (template-layout.js): the picker, or a line and Pick a shape
let editingCantOpen = {}; // who can't open each of the template's modules by default (the editor route's `cantOpen`)
let comparing = null; // the bundled id whose update is open in the compare panel
let moduleIds = [...BUILT_IN]; // the modules a template can list: the ones the image ships, then any other a template names
let builtInLists = null; // GET /api/host/settings `builtIn`: { reactions, icons }, what an environment's set starts as
let shipped = null; // GET /api/host/settings `modules`: [{ id, name, icon, canvas }], loaded once
const moduleName = (id) => (shipped || []).find((m) => m.id === id)?.name || id;
const moduleIcon = (id) => (shipped || []).find((m) => m.id === id)?.icon || 'puzzle-piece';
// Whether a module has a place on the canvas (`canvas`, from its manifest's surfaces.canvas; the server's rule for an
// area). A module this image does not ship is offered, and the server's check has the last word.
const onCanvas = (id) => { const m = (shipped || []).find((x) => x.id === id); return m ? m.canvas === true : true; };

// host.js hands over the list it loaded, and is told when it changes (the create form uses it too).
export function initTemplates(templates, changed, name, environmentName) {
  if (typeof name === 'string' && name.trim()) product = name.trim();
  if (typeof environmentName === 'function') nameOf = environmentName;
  const by = $('template-shipped-by');
  if (by && product) by.textContent = `${product} ships`; // "the one shipped" until the name is known
  onChange = changed || onChange;
  list = templates || [];
  renderList();
  ready = true;
  if (pendingView !== null) { const [id, part] = pendingView; pendingView = null; showTemplatesView(id, part); }
}

// Which view: the table (''), or the editor of one template ('new' for a new one). host.js calls it from the address.
const TEMPLATE_ID = /^[a-z][a-z0-9-]{0,31}$/;
let shownId = '';
let shownPartAsked = ''; // the part the address asks for now: an editor still loading opens this one, not the first asked
export async function showTemplatesView(id, part = '') {
  shownPartAsked = part;
  if (!ready) { pendingView = [id, part]; return; }
  $('templates-list-view').hidden = Boolean(id);
  $('template-editor-view').hidden = !id;
  if (!id) { editing = null; shownId = ''; return; }
  if (id === shownId) { selectPart(part); return; } // the same template: only its tab changes, what was typed stays
  shownId = id;
  // The last template's layout goes at once, so nothing reads it as this one's while this one loads.
  if (layoutPart) { layoutPart.destroy(); layoutPart = null; }
  if (id === 'new') { await openEditor(null, {}); if (shownId === id) selectPart(shownPartAsked); return; }
  // Only a template id reaches the route (the server's pattern, server/templates.js): "." or ".." in the address would
  // otherwise walk the request to another route.
  if (!TEMPLATE_ID.test(id)) {
    shownId = '';
    location.hash = 'templates';
    say($('templates-status'), `There is no template called ${id}.`, true);
    return;
  }
  try {
    const answer = await api('GET', `/api/host/templates/${encodeURIComponent(id)}`);
    if (shownId !== id) return; // another template was asked for meanwhile
    await openEditor(answer.template, answer.cantOpen);
    // Another tab of this template may have been asked for while it loaded (#templates/<id>/modules after .../workspace):
    // the address now wins, so a part chosen meanwhile is not taken back.
    if (shownId === id) selectPart(shownPartAsked);
  } catch (err) {
    location.hash = 'templates';
    say($('templates-status'), err.message, true);
  }
}
async function reload() {
  list = (await api('GET', '/api/host/templates')).templates || [];
  renderList();
  onChange(list);
}

const chipOf = (word, tone = 'neutral') => `<span class="sdk-status" data-tone="${tone}">${escapeHtml(word)}</span>`;
function renderList() {
  const box = $('template-list');
  const notices = $('template-notices');
  const updates = list.filter((t) => t.update);
  notices.innerHTML = updates.map((t) => `<li class="sdk-banner" data-kind="info" data-id="${escapeHtml(t.id)}"><span class="sdk-banner-icon" aria-hidden="true"><i class="fa-solid fa-gift"></i></span><span class="sdk-banner-text">The ${escapeHtml(t.name || t.id)} template has a new version.</span><button class="btn btn-small sdk-banner-action" type="button" data-action="review">Review</button></li>`).join('');
  if (!list.length) { box.innerHTML = '<tr class="sdk-table-empty"><td colspan="6">No templates yet.</td></tr>'; return; }
  box.innerHTML = list.map((t) => {
    const editable = t.source === 'host' || t.source === 'bundled';
    const fixed = t.id === DEFAULT_ID;
    const id = escapeHtml(t.id);
    const name = escapeHtml(t.name || t.id);
    const used = t.usedBy || [];
    // Used by: the environments by name, each a link to its page; past four, "and N more".
    const names = used.slice(0, 4).map((slug) => `<a class="hc-link" href="#environments/${encodeURIComponent(slug)}">${escapeHtml(nameOf(slug))}</a>`).join('<span class="hc-sep">, </span>');
    // And the spaces that chose it themselves (usedBySpaces, a count): "3 spaces".
    const spaceCount = Number(t.usedBySpaces) || 0;
    const spaces = spaceCount ? `<span class="hc-spaces">${spaceCount} ${escapeHtml(word('space', { many: spaceCount !== 1 }))}</span>` : '';
    const usedBy = used.length ? `${names}${used.length > 4 ? `<span class="hc-more-names"> and ${used.length - 4} more</span>` : ''}${spaces ? '<span class="hc-sep">, </span>' : ''}${spaces}` : spaces || '<span class="sdk-table-dim">None</span>';
    return `<tr data-id="${id}">`
      + `<th scope="row" class="hc-name-cell"><a class="hc-link" href="#templates/${encodeURIComponent(t.id)}">${name}</a><span class="sdk-table-sub">${id}</span></th>`
      + `<td class="hc-chips-cell">${chipOf(fixed ? 'Default' : SOURCE[t.source] || t.source)}${t.edited ? chipOf('Edited', 'info') : ''}</td>`
      + `<td class="sdk-table-dim">v${escapeHtml(String(t.version || 1))}</td>`
      + `<td class="hc-used">${usedBy}</td>`
      + `<td>${editable && !fixed ? `<input class="sdk-switch" type="checkbox" role="switch" data-action="hide"${t.hidden ? ' checked' : ''} aria-label="Hide ${name} from new ${escapeHtml(word('environment', { many: true }))}">` : ''}</td>`
      + `<td class="hc-more-cell"><button class="sdk-icon-btn btn-quiet btn-small" type="button" data-action="template-menu" aria-haspopup="menu" aria-label="More for ${name}"><i class="fa-solid fa-ellipsis-vertical fa-fw" aria-hidden="true"></i></button></td></tr>`;
  }).join('');
}

$('template-list').addEventListener('change', async (e) => {
  if (e.target.dataset.action !== 'hide') return;
  const id = e.target.closest('[data-id]').dataset.id;
  try {
    await api('PATCH', `/api/host/templates/${encodeURIComponent(id)}`, { hidden: e.target.checked });
    await reload();
    say($('templates-status'), e.target.checked ? `${id} is hidden from new ${word('environment', { many: true })}.` : `${id} is offered again.`);
    $('template-list').querySelector(`[data-id="${CSS.escape(id)}"] [data-action="hide"]`)?.focus();
  } catch (err) {
    e.target.checked = !e.target.checked;
    say($('templates-status'), err.message, true);
  }
});
$('template-list').addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-id]');
  if (!row) return;
  const t = list.find((x) => x.id === row.dataset.id);
  const more = e.target.closest('[data-action="template-menu"]');
  if (more && t) templateMenu(more, t);
});
function templateMenu(trigger, t) {
  const editable = (t.source === 'host' || t.source === 'bundled') && t.id !== DEFAULT_ID;
  const unused = !(t.usedBy || []).length && !t.usedBySpaces;
  openHostMenu(trigger, [
    { label: editable ? 'Edit' : 'Open', icon: editable ? 'pen' : 'eye', onPick: () => { location.hash = `templates/${t.id}`; } },
    { label: 'Export', icon: 'file-export', onPick: () => exportTemplate(t) },
    { label: 'Copy', icon: 'copy', onPick: () => duplicateTemplate(t) },
    ...(t.source === 'bundled' && t.edited ? [{ label: 'Reset to shipped', icon: 'rotate-left', onPick: () => resetTemplate(t) }] : []),
    ...(t.source === 'host' ? [{ divider: true }, { label: 'Delete', icon: 'trash', danger: true, disabled: !unused, tip: unused ? '' : 'In use: hide it instead', onPick: () => deleteTemplate(t) }] : []),
  ]);
}
// Export: the file download, as the old link did.
function exportTemplate(t) {
  const a = document.createElement('a');
  a.href = `/api/host/templates/${encodeURIComponent(t.id)}/export`;
  a.download = '';
  a.click();
}
async function resetTemplate(t) {
  const name = t.name || t.id;
  if (!await confirmDialog({ title: `Reset ${name} to the shipped version?`, message: 'Your edits are removed.', action: 'Reset', kind: 'destructive' })) return;
  try {
    await api('DELETE', `/api/host/templates/${encodeURIComponent(t.id)}/edits`);
    closeCompare();
    await reload();
    say($('templates-status'), `${name} is back to the shipped version.`);
  } catch (err) { say($('templates-status'), err.message, true); }
}
async function deleteTemplate(t) {
  const name = t.name || t.id;
  const inSpaces = Number(t.usedBySpaces) || 0;
  if ((t.usedBy || []).length || inSpaces) {
    const who = [...(t.usedBy || []).map(nameOf), ...(inSpaces ? [`${inSpaces} ${word('space', { many: inSpaces !== 1 })}`] : [])];
    return say($('templates-status'), `In use by ${who.join(', ')}. Hide it instead.`, true);
  }
  if (!await confirmDialog({ title: `Delete the ${name} template?`, message: `No ${word('environment')} or ${word('space')} uses it.`, action: 'Delete', kind: 'destructive' })) return;
  try {
    await api('DELETE', `/api/host/templates/${encodeURIComponent(t.id)}`);
    await reload();
    say($('templates-status'), `Deleted ${name}.`);
    $('template-new').focus();
  } catch (err) { say($('templates-status'), err.message, true); }
}

$('template-notices').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-action="review"]');
  if (!b) return;
  const id = b.closest('[data-id]').dataset.id;
  try {
    const { template } = await api('GET', `/api/host/templates/${encodeURIComponent(id)}`);
    openCompare(template);
  } catch (err) { say($('templates-status'), err.message, true); }
});

async function duplicateTemplate(t) {
  const id = window.prompt('Id for the copy (lowercase letters, digits and dashes):', '');
  if (!id || !id.trim()) return;
  const name = window.prompt('Name for the copy:', t.name || '');
  if (!name || !name.trim()) return;
  try {
    const made = await api('POST', `/api/host/templates/${encodeURIComponent(t.id)}/duplicate`, { id: id.trim().toLowerCase(), name: name.trim() });
    await reload();
    say($('templates-status'), `Copied ${t.name || t.id} as ${made.template.name}.`);
    location.hash = `templates/${made.template.id}`;
  } catch (err) { say($('templates-status'), err.message, true); }
}

// Labels read at compare time, so they follow the words once the page has them.
const COMPARE_FIELDS = () => [
  ['name', 'Template Name'],
  ['description', 'Template Description'],
  ['words', 'Words'],
  ['home', 'Home page'],
  ['icons', 'Home Icon'],
  ['lobby', 'Lobby'],
  ['modules', word('module', { many: true, cap: true })],
  ['call', 'Call'],
  ['workspace', 'Default Workspace'],
  ['phases', 'Phases'],
  ['phaseMeasure', 'A phase is done by'],
  ['reactions', 'Reactions'],
  ['iconSet', 'Icons'],
  ['spaceDefaults', 'Default Profile Image'],
  ['starterSpaces', `Starter ${word('space', { many: true })}`],
  ['settings', 'Settings'],
];
const shown = (value) => JSON.stringify(value ?? null, null, 2);
function openCompare(template) {
  comparing = template.id;
  const shipped = template.shipped || {};
  $('template-compare-title').textContent = `${template.name} was updated in this image: review`;
  const rows = COMPARE_FIELDS().filter(([key]) => shown(template[key]) !== shown(shipped[key]));
  $('template-compare-fields').innerHTML = rows.length
    ? rows.map(([key, label]) => `<div class="template-compare-row"><strong>${escapeHtml(label)}</strong><pre>${escapeHtml(shown(shipped[key]))}</pre><pre>${escapeHtml(shown(template[key]))}</pre></div>`).join('')
    : '<p class="hint">Nothing in the template differs. The shipped file\'s version changed.</p>';
  $('template-compare').hidden = false;
  $('template-compare').scrollIntoView({ block: 'start' });
  $('template-keep-mine').focus();
}
function closeCompare() {
  $('template-compare').hidden = true;
  comparing = null;
}
$('template-compare-close').addEventListener('click', closeCompare);
$('template-keep-mine').addEventListener('click', () => answerUpdate('mine'));
$('template-take-shipped').addEventListener('click', () => answerUpdate('shipped'));
async function answerUpdate(keep) {
  const id = comparing;
  const t = list.find((x) => x.id === id);
  if (!id || !t) return;
  if (keep === 'shipped' && !await confirmDialog({ title: `Drop your edits to ${t.name || id}?`, action: 'Drop my edits', kind: 'destructive' })) return;
  try {
    await api('POST', `/api/host/templates/${encodeURIComponent(id)}/update`, { keep });
    closeCompare();
    await reload();
    say($('templates-status'), keep === 'mine' ? `Kept your edits to ${t.name || id}.` : `${t.name || id} is back to the shipped version.`);
  } catch (err) { say($('templates-status'), err.message, true); }
}

// Import…: the file's text; a clashing id asks for another and sends it again with ?id=.
$('template-import').addEventListener('click', () => $('template-import-file').click());
$('template-import-file').addEventListener('change', async () => {
  const input = $('template-import-file');
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const status = $('templates-status');
  if (file.size > 1024 * 1024) return say(status, `That isn't a ${fileOfKind('template')}.`, true);
  const text = await fileText(file);
  let id = '';
  for (;;) {
    try {
      const { template, dropped } = await api('POST', `/api/host/templates/import${id ? `?id=${encodeURIComponent(id)}` : ''}`, new Blob([text], { type: 'text/plain' }));
      await reload();
      const left = Array.isArray(dropped) && dropped.length ? ` Left out: ${dropped.join(', ')}.` : '';
      return say(status, `Imported ${template.name}.${left}`);
    } catch (err) {
      if (/^There is already a template called /.test(err.message)) {
        const next = window.prompt(`${err.message} Give this one another id (lowercase letters, digits and dashes):`, id);
        if (next && next.trim()) { id = next.trim().toLowerCase(); continue; }
        return say(status, 'Not imported.');
      }
      return say(status, err.problems && err.problems.length > 1 ? `${err.message} (${err.problems.length} problems)` : err.message, true);
    }
  }
});

// --- the editor -----------------------------------------------------------------------------------------------------
$('template-new').addEventListener('click', () => { location.hash = 'templates/new'; });
$('te-cancel').addEventListener('click', () => { location.hash = 'templates'; $('templates-title').focus({ preventScroll: true }); });
// The parts are tabs (decision 52): one part on the screen, its address #templates/<id>/<part> (no part: Environment Basics).
const PARTS = ['basics', 'words', 'modules', 'workspace', 'call', 'phases', 'reactions', 'icons', 'starter'];
const partTabs = () => [...$('te-jump').querySelectorAll('[data-part]')];
const partSlug = (b) => b.dataset.part.replace(/^te-part-/, '');
let shownPart = 'basics';
function selectPart(part) {
  shownPart = PARTS.includes(part) ? part : 'basics';
  for (const b of partTabs()) {
    const on = partSlug(b) === shownPart;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(b.dataset.part).hidden = !on;
  }
  // On a phone the strip is wider than the page: bring the shown tab into it, the page left as it is.
  const strip = $('te-jump');
  const cur = strip.querySelector('[aria-selected="true"]');
  if (cur && strip.scrollWidth > strip.clientWidth) {
    const t = cur.getBoundingClientRect();
    const sb = strip.getBoundingClientRect();
    if (t.left < sb.left) strip.scrollLeft += t.left - sb.left;
    else if (t.right > sb.right) strip.scrollLeft += t.right - sb.right;
  }
}
// A tab is an address (so back and forward move between tabs); the typed values are one form and stay.
function goPart(slug, focus = true) {
  const hash = `templates/${encodeURIComponent(shownId)}${slug === 'basics' ? '' : `/${slug}`}`;
  if (location.hash !== `#${hash}`) location.hash = hash;
  selectPart(slug);
  if (focus) $(`te-tab-${slug}`).focus();
}
$('te-jump').addEventListener('click', (e) => {
  const b = e.target.closest('[data-part]');
  if (b) goPart(partSlug(b));
});
$('te-jump').addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const i = PARTS.indexOf(shownPart);
  goPart(e.key === 'Home' ? PARTS[0] : e.key === 'End' ? PARTS[PARTS.length - 1] : PARTS[(i + (e.key === 'ArrowRight' ? 1 : PARTS.length - 1)) % PARTS.length]);
});

// The modules a template can name: the ones this image ships (by name), then any other module a template lists.
const moduleKeys = (t) => (t && t.modules && typeof t.modules === 'object' ? Object.keys(t.modules) : []);
async function loadModuleIds() {
  if (!shipped) {
    const got = await api('GET', '/api/host/settings').catch(() => ({}));
    shipped = got.modules || null;
    builtInLists = got.builtIn || null;
  }
  const own = (shipped || []).map((m) => m.id);
  const ids = new Set([...BUILT_IN, ...own]);
  const full = await Promise.all(list.map((t) => api('GET', `/api/host/templates/${encodeURIComponent(t.id)}`).then((a) => a.template).catch(() => null)));
  for (const t of full) if (t) for (const id of moduleKeys(t)) ids.add(id);
  const first = [...new Set([...BUILT_IN, ...own])];
  moduleIds = [...first, ...[...ids].filter((id) => !first.includes(id)).sort()];
}

const iconField = (value, label, placeholder) => `<span class="icon-field"><i class="fa-solid fa-${escapeHtml(value || placeholder)} fa-fw" aria-hidden="true"></i><input type="text" data-icon maxlength="40" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}" autocapitalize="off" spellcheck="false"></span>`;
const FIXED_WORKSPACES = [['calendar', 'Calendar'], ['map', 'Map'], ['conference', 'Conference'], ['whiteboard', 'Whiteboards'], ['documents', 'Documents']];
const CALL_POSITIONS = [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['float', 'Floating'], ['workspace', 'In the workspace'], ['window', 'In its own window']];
const CALL_LAYOUTS = [['grid', 'Grid'], ['strip', 'Strip'], ['focus', 'Focus'], ['spotlight', 'Spotlight']];
const MEASURES = [['dates', 'Its dates'], ['goals', 'Its goals'], ['progress', 'Progress']];
const options = (list, value) => list.map(([v, l]) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');

async function openEditor(t, cantOpen = {}) {
  editing = t;
  editingCantOpen = cantOpen && typeof cantOpen === 'object' ? cantOpen : {};
  clearProblems();
  say($('te-status'), '');
  await loadModuleIds();
  // The Default template can't be changed (the server answers 403): its pages show its values and nothing saves.
  const fixed = Boolean(t && t.id === DEFAULT_ID);
  $('template-editor').classList.toggle('is-fixed', fixed);
  $('te-save').hidden = fixed;
  for (const part of document.querySelectorAll('#template-editor .hc-part')) part.disabled = fixed;
  $('template-editor-title').textContent = t ? `${fixed ? 'The' : 'Edit'} ${t.name}${fixed ? ' template' : ''}` : 'New template';
  $('te-bundled-hint').hidden = !(t && t.source === 'bundled' && !fixed);
  $('te-id-label').hidden = Boolean(t);
  $('te-id').value = t ? t.id : '';
  // Environment Basics and Experience Labels are the owner's pages (/template-fields.js): a Home Icon field by name here.
  $('te-basics').innerHTML = basicsHtml(t, { editable: !fixed, icons: null });
  $('te-labels').innerHTML = labelsHtml(t, { editable: !fixed, environmentParts: true });
  const listed = t && t.modules && typeof t.modules === 'object' ? moduleKeys(t) : (t ? moduleIds : ['chat', 'conference']);
  const on = new Set(listed);
  const ids = [...new Set([...listed, ...moduleIds])];
  $('te-modules').innerHTML = ids.map((id) => `<label class="sdk-choice-row"><input type="checkbox" data-module="${escapeHtml(id)}"${on.has(id) ? ' checked' : ''}${id === 'chat' ? ' disabled title="Chat can\'t be switched off yet"' : ''}><span class="sdk-choice-text">${escapeHtml(moduleName(id))}</span></label>`).join('');
  const entries = (t && t.modules && typeof t.modules === 'object' ? t.modules : {});
  $('te-module-display').innerHTML = ids.map((id) => `<div class="module-display-row" data-display="${escapeHtml(id)}"><strong>${escapeHtml(moduleName(id))}</strong>`
    + `<input type="text" data-name maxlength="40" value="${escapeHtml((entries[id] && entries[id].name) || '')}" placeholder="${escapeHtml(moduleName(id))}" aria-label="${escapeHtml(moduleName(id))}: name">`
    + `${iconField(entries[id] && entries[id].icon, `${moduleName(id)}: icon, a Font Awesome name`, moduleIcon(id))}</div>`).join('');
  const w = (t && t.workspace) || {};
  // The template's layout (plan-layout-picker.md, step 5): the layout picker, its areas offering the modules ticked under
  // Modules (those with a place on the canvas), the notice "by default" from the route's cantOpen. The form's Save sends it.
  if (layoutPart) layoutPart.destroy();
  const layoutNow = layoutModules();
  layoutPart = mountTemplateLayout($('te-layout'), {
    record: w.layout || null,
    ...layoutNow,
    cantOpen: editingCantOpen,
    byDefault: true,
    readOnly: fixed,
    word,
    nameOf: shownName,
    onChange: () => markLayoutUses(),
  });
  markLayoutUses();
  $('te-show').innerHTML = FIXED_WORKSPACES.map(([id, label]) => `<label class="sdk-choice-row"><input type="checkbox" data-show="${id}"${(w.show || []).includes(id) ? ' checked' : ''}><span class="sdk-choice-text">${escapeHtml(label)}</span></label>`).join('');
  $('te-opens-first').innerHTML = options([['workspace', 'The workspace'], ...FIXED_WORKSPACES], w.opensFirst || 'workspace');
  const c = (t && t.call) || {};
  $('te-join').checked = c.joinOnEntry === true;
  $('te-call-position').innerHTML = options(CALL_POSITIONS, c.position || 'top');
  $('te-call-layout').innerHTML = options(CALL_LAYOUTS, c.layout || 'grid');
  renderPhases((t && t.phases) || []);
  $('te-measure').innerHTML = options(MEASURES, (t && t.phaseMeasure) || 'dates');
  $('te-reactions').replaceChildren(...((t && t.reactions) || []).map(reactionRow));
  $('te-icon-set').value = ((t && t.iconSet) || []).join(' ');
  previewIconSet();
  drawSets();
  $('te-starter').replaceChildren(...((t && t.starterSpaces) || []).map(starterRow));
  $('te-starter-add').disabled = $('te-starter').childElementCount >= MAX_STARTER;
  window.scrollTo(0, 0);
  $('template-editor-title').focus({ preventScroll: true });
}
wireFields($('te-basics'));
wireFields($('te-labels'));

const MAX_PHASES = 12;
function phaseRow(phase = {}) {
  const row = document.createElement('div');
  row.className = 'phase-row';
  row.innerHTML = `<input type="text" data-phase-id maxlength="32" value="${escapeHtml(phase.id || '')}" placeholder="planning" aria-label="Phase id" autocapitalize="off" spellcheck="false">`
    + `<input type="text" data-phase-label maxlength="40" value="${escapeHtml(phase.label || '')}" placeholder="Planning" aria-label="Phase label">`
    + `<label class="sdk-choice-row"><input type="checkbox" data-phase-main${phase.main ? ' checked' : ''}><span class="sdk-choice-text">Main</span></label>`
    + `<span class="list-tools"><button type="button" class="btn btn-small" data-phase="up" aria-label="Move up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button>`
    + `<button type="button" class="btn btn-small" data-phase="down" aria-label="Move down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>`
    + `<button type="button" class="btn btn-small danger" data-phase="remove">Remove</button></span>`;
  return row;
}
function renderPhases(phases) {
  $('te-phases').replaceChildren(...(phases || []).slice(0, MAX_PHASES).map(phaseRow));
  $('te-phase-add').disabled = $('te-phases').childElementCount >= MAX_PHASES;
}
function readPhases() {
  return [...$('te-phases').children].flatMap((row) => {
    const id = row.querySelector('[data-phase-id]').value.trim().toLowerCase();
    const label = row.querySelector('[data-phase-label]').value.trim();
    if (!id && !label) return [];
    const main = row.querySelector('[data-phase-main]').checked;
    return [{ id, label, ...(main ? { main: true } : {}) }];
  });
}
function moveRow(row, dir) {
  const sib = dir === 'up' ? row.previousElementSibling : row.nextElementSibling;
  if (!sib) return;
  if (dir === 'up') row.parentElement.insertBefore(row, sib);
  else row.parentElement.insertBefore(sib, row);
}
$('te-phase-add').addEventListener('click', () => {
  if ($('te-phases').childElementCount >= MAX_PHASES) return;
  const row = phaseRow();
  $('te-phases').append(row);
  $('te-phase-add').disabled = $('te-phases').childElementCount >= MAX_PHASES;
  row.querySelector('[data-phase-id]').focus();
});
$('te-phases').addEventListener('change', (e) => {
  if (!e.target.matches('[data-phase-main]') || !e.target.checked) return;
  for (const box of $('te-phases').querySelectorAll('[data-phase-main]')) if (box !== e.target) box.checked = false;
});
$('te-phases').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-phase]');
  if (!btn) return;
  const row = btn.closest('.phase-row');
  if (btn.dataset.phase === 'remove') {
    row.remove();
    $('te-phase-add').disabled = false;
    $('te-phase-add').focus();
    return;
  }
  moveRow(row, btn.dataset.phase);
  btn.focus();
});

function selectedModules() {
  return [...$('te-modules').querySelectorAll('[data-module]:checked')].map((box) => box.dataset.module);
}

// What the layout picker works from, as the Modules part is now: the ticked modules with a place on the canvas (the
// Default template's "*": every one this image ships), by the names and icons typed under "Module names and icons";
// a module the layout uses that is no longer ticked, drawn by name and never offered; the Calendar rule from the ticked
// modules (the server's `on`); and the ticked ids, for the line about what is no longer ticked.
const shownName = (id) => $('te-module-display').querySelector(`[data-display="${CSS.escape(id)}"] [data-name]`)?.value.trim() || moduleName(id);
const shownIcon = (id) => ($('te-module-display').querySelector(`[data-display="${CSS.escape(id)}"] [data-icon]`)?.value.trim() || moduleIcon(id)).replace(/^fa-/, '');
function layoutModules() {
  const all = editing && editing.modules === '*';
  const ticked = all ? moduleIds : selectedModules();
  const list = templateLayoutModules(ticked, { isCanvas: onCanvas, nameOf: shownName, iconOf: shownIcon });
  const used = layoutPart ? layoutPart.arrangement() : (editing && editing.workspace && editing.workspace.layout) || null;
  const gone = (used && Array.isArray(used.areas) ? used.areas : []).filter((id) => id && !list.some((m) => m.id === id));
  return { modules: list, others: templateLayoutModules(gone, { nameOf: shownName, iconOf: shownIcon }), parts: partsFor(list.map((m) => m.id)), ticked: all ? null : ticked };
}
// Under the Modules list: the modules the layout uses that are no longer ticked, said before saving (the same line is
// beside the picker), so the server's refusal is never the first word of it.
function markLayoutUses() {
  const note = $('te-modules-layout');
  const text = layoutPart ? usesNote(layoutPart.missingIds().map(shownName)) : '';
  note.textContent = text;
}
$('te-modules').addEventListener('change', () => {
  if (!layoutPart) return;
  layoutPart.update(layoutModules());
  markLayoutUses();
});
$('te-module-display').addEventListener('change', () => { if (layoutPart) layoutPart.update(layoutModules()); });

$('te-module-display').addEventListener('input', (e) => {
  if (!e.target.matches('[data-icon]')) return;
  e.target.previousElementSibling.className = `fa-solid fa-${e.target.value.trim() || e.target.placeholder} fa-fw`;
});
// The built-in lists, read only and folded under each list: what an environment's set starts as. The console has no environment.
function drawSets() {
  $('te-reactions-set').innerHTML = builtInLists ? setFoldHtml(word('environment', { a: true }), builtInLists.reactions.length, setReactionChips(builtInLists.reactions), { starts: true }) : '';
  $('te-icons-set').innerHTML = builtInLists ? setFoldHtml(word('environment', { a: true }), builtInLists.icons.length, setIconChips(builtInLists.icons), { starts: true }) : '';
}
const iconSetNames = () => $('te-icon-set').value.split(/[\s,]+/).map((s) => s.trim().replace(/^fa-/, '')).filter(Boolean);
function previewIconSet() { $('te-icon-preview').innerHTML = iconSetNames().slice(0, 60).map((n) => `<i class="fa-solid fa-${escapeHtml(n)} fa-fw" title="${escapeHtml(n)}"></i>`).join(''); }
$('te-icon-set').addEventListener('input', previewIconSet);

function reactionRow(r = {}) {
  const row = $('tpl-te-reaction').content.firstElementChild.cloneNode(true);
  row.querySelector('.reaction-glyph').value = r.glyph || '';
  row.querySelector('.reaction-label').value = r.label || '';
  if (r.id) row.dataset.id = r.id;
  return row;
}
$('te-reaction-add').addEventListener('click', () => { const row = reactionRow(); $('te-reactions').append(row); row.querySelector('input').focus(); });
$('te-reactions').addEventListener('click', (e) => { if (e.target.closest('[data-action="te-reaction-remove"]')) { e.target.closest('.reaction-row').remove(); $('te-reaction-add').focus(); } });

// Starter spaces: at most 5, each a name and a description.
const MAX_STARTER = 5;
function starterRow(sp = {}) {
  const row = document.createElement('div');
  row.className = 'phase-row';
  row.innerHTML = `<input type="text" data-starter-name maxlength="40" value="${escapeHtml(sp.name || '')}" placeholder="Your first trip" aria-label="${escapeHtml(cap(word('space')))} name">`
    + `<input type="text" data-starter-description maxlength="300" value="${escapeHtml(sp.description || '')}" placeholder="What it is for" aria-label="${escapeHtml(cap(word('space')))} description">`
    + `<button type="button" class="btn btn-small danger" data-starter="remove">Remove</button>`;
  return row;
}
$('te-starter-add').addEventListener('click', () => {
  if ($('te-starter').childElementCount >= MAX_STARTER) return;
  const row = starterRow();
  $('te-starter').append(row);
  $('te-starter-add').disabled = $('te-starter').childElementCount >= MAX_STARTER;
  row.querySelector('input').focus();
});
$('te-starter').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-starter="remove"]');
  if (!btn) return;
  btn.closest('.phase-row').remove();
  $('te-starter-add').disabled = false;
  $('te-starter-add').focus();
});

// What the form holds, as template fields. Editing, an emptied optional part is null (the server removes it). A module's
// settings, labels and starter content are not on this page: they are kept as the template has them.
function fields() {
  const gone = editing ? null : undefined;
  const entries = (editing && editing.modules && typeof editing.modules === 'object' ? editing.modules : {});
  const modules = {};
  const names = {};
  for (const row of $('te-module-display').children) names[row.dataset.display] = { name: row.querySelector('[data-name]').value.trim(), icon: row.querySelector('[data-icon]').value.trim().replace(/^fa-/, '') };
  for (const id of selectedModules()) {
    const { name, icon } = names[id] || {};
    const { name: _n, icon: _i, ...kept } = entries[id] || {};
    modules[id] = { ...(name ? { name } : {}), ...(icon ? { icon } : {}), ...kept };
  }
  // A saved row keeps its id; a new one gets one from its label (else its emoji, else a random one): 1 to 24 lowercase letters,
  // digits and dashes, not one this list already has.
  const rows = [...$('te-reactions').children].map((row) => ({ id: row.dataset.id || '', glyph: row.querySelector('.reaction-glyph').value.trim(), label: row.querySelector('.reaction-label').value.trim() })).filter((r) => r.glyph || r.label);
  const taken = new Set(rows.map((r) => r.id).filter(Boolean));
  const slug = (text) => String(text || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  const reactions = rows.map((r) => {
    if (r.id) return r;
    let id = slug(r.label) || slug(r.glyph);
    if (!id || taken.has(id)) id = `r${Math.random().toString(36).slice(2, 8)}`;
    taken.add(id);
    return { ...r, id };
  });
  const iconSet = iconSetNames();
  const show = [...$('te-show').querySelectorAll('[data-show]:checked')].map((b) => b.dataset.show);
  const opensFirst = $('te-opens-first').value;
  const layout = layoutPart ? layoutPart.value() : null;
  const workspace = { ...(layout ? { layout } : {}), ...(show.length ? { show } : {}), ...(opensFirst && opensFirst !== 'workspace' ? { opensFirst } : {}) };
  const call = { joinOnEntry: $('te-join').checked, position: $('te-call-position').value, layout: $('te-call-layout').value };
  const starterSpaces = [...$('te-starter').children].map((row) => ({ name: row.querySelector('[data-starter-name]').value.trim(), description: row.querySelector('[data-starter-description]').value.trim() })).filter((sp) => sp.name || sp.description);
  const out = {
    ...readBasics($('te-basics'), { editing: Boolean(editing) }),
    ...readLabels($('te-labels'), { editing: Boolean(editing) }),
    modules,
    workspace: Object.keys(workspace).length ? workspace : (editing ? null : {}),
    call,
    phases: readPhases(),
    phaseMeasure: $('te-measure').value,
    reactions: reactions.length ? reactions : gone,
    iconSet: iconSet.length ? iconSet : gone,
    starterSpaces: starterSpaces.length ? starterSpaces : gone,
  };
  if (!editing) out.id = $('te-id').value.trim().toLowerCase();
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// The server's problems beside the part they name ("words: ...", "modules.travel: ...", '"id" must ...'); any other at the top.
// A part with a problem has a count on its tab, so one on a tab not shown is still seen.
function markTabs() {
  let parts = 0;
  for (const b of partTabs()) {
    const n = $(b.dataset.part).querySelectorAll('.problems li').length;
    const badge = b.querySelector('[data-problems]');
    badge.hidden = !n;
    badge.replaceChildren();
    if (n) {
      const hidden = document.createElement('span');
      hidden.className = 'visually-hidden';
      hidden.textContent = n === 1 ? 'Problem: ' : 'Problems: ';
      badge.append(hidden, String(n));
      parts += 1;
    }
  }
  return parts;
}
function clearProblems(only) {
  for (const ul of document.querySelectorAll('#template-editor .problems')) if (!only || (ul.dataset.problems || '').split(' ').includes(only)) ul.replaceChildren();
  markTabs();
}
// Each problem in its part's list (template-pages.js, problemPlaces: the field the server marks it with in `parts`, else
// the field a sentence starts with), else in the list at the top; each sentence once. Answers how many tabs are marked.
function showProblems(problems, marks) {
  const lists = [...document.querySelectorAll('#template-editor ul.problems[data-problems]')];
  const fields = lists.flatMap((ul) => ul.dataset.problems.split(' '));
  for (const { text, part } of problemPlaces(problems, fields, marks)) {
    const ul = (part && lists.find((x) => x.dataset.problems.split(' ').includes(part))) || $('tp-problems');
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
    ul.closest('details')?.setAttribute('open', '');
  }
  return markTabs();
}

$('template-editor').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (editing && editing.id === DEFAULT_ID) return;
  clearProblems();
  const body = fields();
  const save = $('te-save');
  const was = document.activeElement; // a disabled button drops the focus: it goes back where it was
  save.disabled = true;
  say($('te-status'), 'Saving…');
  try {
    const { template } = editing
      ? await api('PATCH', `/api/host/templates/${encodeURIComponent(editing.id)}`, body)
      : await api('POST', '/api/host/templates', body);
    editing = null;
    await reload();
    location.hash = 'templates';
    say($('templates-status'), `Saved ${template.name}, version ${template.version}.`);
    // The editor goes away with the hash change, a moment later: focus goes to the saved template's link in the list, once it shows.
    for (let n = 0; n < 40 && !$('template-editor-view').hidden; n += 1) await new Promise((r) => setTimeout(r, 25));
    $('template-list').querySelector(`[data-id="${CSS.escape(template.id)}"] a`)?.focus();
  } catch (err) {
    const parts = showProblems(err.problems || [err.message], err.parts);
    // The sentences are in the lists; the status line says where, never the same sentence again.
    const top = $('tp-problems').childElementCount;
    say($('te-status'), parts ? `${parts} ${parts === 1 ? 'part has' : 'parts have'} problems, marked on ${parts === 1 ? 'its tab' : 'their tabs'}.` : `Not saved. ${top > 1 ? 'The problems are' : 'The problem is'} below.`, true);
  } finally {
    save.disabled = false;
    if (document.activeElement === document.body && was && was.isConnected && !$('template-editor-view').hidden) was.focus({ preventScroll: true });
  }
});
