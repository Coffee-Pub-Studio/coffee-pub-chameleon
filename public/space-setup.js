// Set up (documentation/plans/plan-setup-panel.md; plan-workspaces.md, decision 38): every setting of a space in one side
// panel on the space's own screen, titled "<Space> Configuration", with tabs and Save and Cancel in an action bar locked to
// its bottom (public/action-bar.js). The bar's Set up tool puts `body.setting-up` on (and shows pressed), the space's name
// becomes an input in the bar, and this panel opens (a full-screen sheet on a phone). `/?setup=<id>#<tab>` opens it from an
// address (space.js; setupAddress below reads it).
//
// Six tabs, one job each, in this order; each code id is also its address fragment and is the tab's own word:
//   details   "Details": the picture, name, description, template, launch link, link icon, the published calendar switch,
//             the budget when the template has no phases, and last a danger section with Delete (its own confirmation
//             here; it does not wait for Save)
//   members   the member word: the members, Who can enter (with People can ask to come in), Waiting to come in, Guests can
//             see costs, then the invite link and the guest link (actions, at once)
//   phases    "Phases": each phase's start and end, inline, through the rule in public/phases.js (a draft; the phase chip's
//             sheet is its own surface and still saves as it is set there), then the budget (budgetTabOf)
//   call      "Call": Join on entry, Position and Layout (the space's own, else the template's), then Faces in the call
//   layout    "Layout": Tabs in the bar (the fixed layouts: show, hide, order, Opens first), First visit, and for a moderator
//             the open and close switch (an owner's is in Who can enter, on Members)
//   modules   the module word: Turn AI off and What AI may see (an owner's), Tags, then a section per module with its
//             settings for this space (module-settings.js, its draft mode) and the switches a Fixed Workspace offers for
//             it (the server's list, server/fixed-workspaces.js, answered with GET /api/spaces/:id/layouts)
// What is personal (Open for you, Arrange, the layout picker) is not here: it is the menu on a workspace's tab (canvas.js,
// space.js tabMenuItems), because it changes only this person's own canvas.
// An owner and the admin see all six; a moderator sees Phases, Call, Layout and Modules (the server lets a moderator PATCH
// exactly `phases`, `defaultLayout`, `tabs`, `closed`, `budget` and the call's settings, and set a space's module settings);
// a member has no Set up. Phases is left out when the template has none; no other tab comes and goes.
// Each tab says once, at its top, what Save does there and what happens at once (saveCue).
//
// Every field is a draft until Save. Save sends, in order, and stops at the first refusal: PATCH /api/spaces/:id with
// what changed (one body; a moderator's holds only their fields), the call's own PATCH, the picture (PUT or DELETE
// /api/spaces/:id/image), each changed module's settings (PUT /api/modules/:id/settings/space), then each changed Fixed
// Workspace switch (PUT /api/modules/:id/settings/<its scope>). A refusal keeps the panel open on that field's tab with the
// server's sentence and the keyboard on the field, and says what did save. After a full save the panel closes. A tab with
// unsaved changes shows a dot. Cancel drops every draft; Escape cancels at once when nothing changed and asks "Discard your
// changes?" when something did; a click outside does nothing.
//
// The pure parts (setupTabs, pickTab, setupAddress, setupPatch, dirtyTabs, takeSaved, problemField, setupSaidWords,
// budgetEntryProblem, budgetWanted, fixedRows, saveCue) touch no document, so tools/check-nav.mjs runs them in node; the
// page hands the panel what it needs (createSpaceSetup's `deps`).
import { actionBar } from './action-bar.js';
import { groupOf } from './composites.js';
import { confirmDialog } from './confirm.js';
import { mountSees, fullSees, sameSees } from './ai-sees.js';
import { loadTemplateChoices, spaceTemplatesOn, fillSelect, optionList, changeQuestion, moduleShift, SAME } from './template-choice.js';
import { rowsOf, dayWords, plainDays, sameDates, rowIconHtml } from './phase-sheet.js';

// The name of the Set up button and of the panel's title: "<space word> Configuration" (Trip Configuration), in the
// template's word; in an aside, the aside's word. `word` is the page's word helper. One helper, so the two say the same.
export const configurationLabel = (word, aside = false) => `${word(aside ? 'aside' : 'space', { cap: true })} Configuration`;

// The tabs, in the order shown, by rights.
export const SETUP_TABS = Object.freeze(['details', 'members', 'phases', 'call', 'layout', 'modules']);
export const OWNER_TABS = SETUP_TABS;
export const MODERATOR_TABS = Object.freeze(['phases', 'call', 'layout', 'modules']);
// The fields a moderator's PATCH may hold (server/index.js, MODERATOR_SPACE_FIELDS; the call goes in its own PATCH).
export const MODERATOR_FIELDS = Object.freeze(['phases', 'defaultLayout', 'tabs', 'budget', 'closed']);
// `phases`: the template has phases. Phases is the only tab that comes and goes: every other tab always has something for
// the roles that see it (Layout its tabs in the bar, Modules its tags and the module settings, Call the call's three).
export function setupTabs({ owner = false, moderator = false, phases = true } = {}) {
  const tabs = owner ? OWNER_TABS : moderator ? MODERATOR_TABS : [];
  return tabs.filter((t) => t !== 'phases' || phases);
}
// The tab an address fragment asks for, else the first the person may see (an unknown fragment is never an error).
export function pickTab(tabs, hash = '') {
  const id = String(hash || '').replace(/^#/, '');
  return tabs.includes(id) ? id : tabs[0] || null;
}
// `/?setup=<id>#<tab>`: the space to set up and the tab the fragment asks for ('' for none), or null when the address
// does not ask. The tab is checked later, against what the person may see (pickTab).
export function setupAddress(search = '', hash = '') {
  const id = new URLSearchParams(search).get('setup');
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return { id, tab: String(hash || '').replace(/^#/, '') };
}
// A tab's name. `word` is the page's word helper: Members and Modules follow the template's words.
export const tabLabelOf = (id, word = (w, o = {}) => (o.many ? `${w}s` : w)) => ({
  details: 'Details', members: word('member', { many: true, cap: true }), phases: 'Phases', call: 'Call', layout: 'Layout', modules: word('module', { many: true, cap: true }),
})[id] || id;
// What each tab says once at its top: whether its changes wait for Save, and what happens at once instead. `done`: the
// phases show a Done switch (measured by goals or progress). Text for textContent.
export function saveCue(id, { done = false } = {}) {
  return ({
    details: 'Saved with Save. Delete happens at once.',
    members: 'Saved with Save. Waiting to come in and Links happen at once.',
    phases: done ? 'Saved with Save. A phase\'s Done switch happens at once.' : 'Saved with Save.',
    call: 'Saved with Save.',
    layout: 'Saved with Save.',
    modules: 'Saved with Save. Tags and deleting a file happen at once.',
  })[id] || 'Saved with Save.';
}

// Which tab each saved field lives on (the dirty dots, and the tab a refusal opens).
export const FIELD_TAB = Object.freeze({
  name: 'details', description: 'details', template: 'details', link: 'details', linkIcon: 'details', publishCalendar: 'details', image: 'details', imageRemoved: 'details', budget: 'phases',
  members: 'members', allowGuests: 'members', entry: 'members', requestAccess: 'members', closed: 'members', guestsSeeHidden: 'members',
  phases: 'phases',
  call: 'call', profile: 'call',
  defaultLayout: 'layout', tabs: 'layout',
  aiOff: 'modules', aiSees: 'modules',
});
// A module's settings, in the save's lists and its words, are `module:<id>`, and a Fixed Workspace switch `fixed:<module>:<key>`;
// both live on the Modules tab.
// The tab the budget is on: the phases tab (every role with a Set up has it when the template has phases), else Details (an
// owner's), else Modules (a moderator's, beside the module settings that read it). `tabs` is the tabs the person has.
export const budgetTabOf = (tabs) => (tabs.includes('phases') ? 'phases' : tabs.includes('details') ? 'details' : 'modules');
// Closing a space is an owner's in Who can enter on Members, and a moderator's on Layout (a moderator has no Members tab).
export const closedTabOf = (tabs) => (tabs.includes('members') ? 'members' : 'layout');

// The Fixed Workspaces' switches (plan-workspaces.md, decisions 35 and 38): from the layouts the server lists for this space
// (`system`, each Fixed Workspace with its `settings`), one row per module setting, each once even when two workspaces offer
// it, grouped under its module. A row is { id, module, moduleName, key, scope, label, note, on, disabled, where }: `where` the
// workspaces that show it ("the Calendar"), `note` the setting's help, then who it applies to or why it cannot be changed.
// `word` is the page's word helper. All of it is text for textContent.
// Why a switch is dimmed, by the scope of the setting it writes.
export const fixedSwitchReason = (scope, word = (w) => w) => (scope === 'space' ? `Only the ${word('owner')} or the ${word('moderator')} can change this.` : `Only the ${word('owner')} can change this.`);
export function fixedRows(system = [], word = (w) => w) {
  const rows = new Map();
  for (const entry of Array.isArray(system) ? system : []) {
    if (!entry || entry.id === 'workspace' || !Array.isArray(entry.settings)) continue;
    const place = String(entry.name || entry.defaultName || entry.id || '');
    for (const d of entry.settings) {
      if (!d || d.type !== 'boolean' || typeof d.module !== 'string' || typeof d.key !== 'string') continue;
      const id = `${d.module}:${d.key}`;
      const had = rows.get(id);
      if (had) { if (place && !had.where.includes(place)) had.where.push(place); continue; }
      const scope = d.scope === 'space' || d.scope === 'person' ? d.scope : 'environment';
      const reach = scope === 'environment' ? `It applies to every ${word('space')} in the ${word('environment')}.` : '';
      rows.set(id, {
        id, module: d.module, moduleName: String(d.moduleName || d.module), key: d.key, scope,
        label: String(d.label || d.key),
        note: [d.help ? String(d.help) : '', d.canChange ? reach : fixedSwitchReason(scope, word)].filter(Boolean).join(' '),
        on: Boolean(d.value),
        disabled: !d.canChange,
        where: place ? [place] : [],
      });
    }
  }
  return [...rows.values()];
}

// What Set up offers for each, in the words a person reads (the call's own menu and layout buttons say the same). `null` is the
// template's. The values are the server's (server/call-settings.js).
export const CALL_POSITION_CHOICES = Object.freeze([
  ['top', 'Top of the column'], ['bottom', 'Bottom of the column'], ['left', 'Left of the chat'], ['right', 'Right of the chat'],
  ['float', 'Floating window'], ['workspace', 'In the workspace'], ['window', 'Its own window'],
]);
export const CALL_LAYOUT_CHOICES = Object.freeze([['grid', 'Grid'], ['strip', 'Strip'], ['focus', 'Focus'], ['spotlight', 'Spotlight']]);
export const CALL_SAME = 'Same as the template';
const callOf = (c) => {
  const o = c && typeof c === 'object' ? c : {};
  return {
    joinOnEntry: typeof o.joinOnEntry === 'boolean' ? o.joinOnEntry : null,
    position: CALL_POSITION_CHOICES.some(([v]) => v === o.position) ? o.position : null,
    layout: CALL_LAYOUT_CHOICES.some(([v]) => v === o.layout) ? o.layout : null,
  };
};
// The call's own PATCH body, `{ call: { <key>: value | null } }` with only the keys that changed (null follows the template
// again), or {} when none did. Sent alone, never mixed with the rest (a moderator's body may hold the call only).
export function callPatch(before = {}, after = {}) {
  const was = callOf(before.call);
  const now = callOf(after.call);
  const call = {};
  for (const k of Object.keys(was)) if (was[k] !== now[k]) call[k] = now[k];
  return Object.keys(call).length ? { call } : {};
}
export const tabOfField = (f, tabs = null) => (f === 'budget' && tabs ? budgetTabOf(tabs) : f === 'closed' && tabs ? closedTabOf(tabs) : FIELD_TAB[f] || (/^(module|fixed):/.test(String(f)) ? 'modules' : null));

// The four switches of Who can enter, from the stored fields: `open` (Members of the space; off = closed for set up),
// `accounts` (all the environment's members), `invited` (Invited guests: the guest link) and `visiting` (Visiting guests, from
// the sign-in page). The nesting is the radios' own: Visiting guests needs All members.
export function entrySwitches(draft = {}) {
  const entry = draft.entry === 'accounts' || draft.entry === 'guests' ? draft.entry : 'invited';
  return { open: draft.closed !== true, accounts: entry !== 'invited', invited: draft.allowGuests !== false, visiting: entry === 'guests' };
}
// The draft after one switch is turned on or off. Visiting guests on turns All members on; All members off turns Visiting
// guests off; closing changes only `closed`, so reopening restores exactly what was set.
export function withEntrySwitch(draft = {}, which, on) {
  const next = { ...draft };
  const now = entrySwitches(draft);
  if (which === 'open') next.closed = !on;
  else if (which === 'invited') next.allowGuests = Boolean(on);
  else if (which === 'accounts') next.entry = on ? (now.visiting ? 'guests' : 'accounts') : 'invited';
  else if (which === 'visiting') next.entry = on ? 'guests' : (now.accounts ? 'accounts' : 'invited');
  return next;
}

const sameSet = (a = [], b = []) => a.length === b.length && a.every((k) => b.includes(k));
const text = (v) => (typeof v === 'string' ? v.trim() : '');
// A space's phase dates as stored ({ <phase id>: { start?, end? } }), copied; anything else is none.
const datesCopy = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : {});
// The budget target as the panel holds it (#216): { amount, currency } as the fields' text ('' for none, '' for the
// reporting module's own currency), and in the draft `bad: true` while the number field holds something it cannot read
// (`12-3`, `1e`: the browser then reports the value as '' and validity.badInput). budgetSent() is what the PATCH sends:
// null for none (only when both the amount and the currency are empty), { currency } for a currency with no amount, else
// { amount, currency? }. The draft always holds the stored amount, so a changed currency goes with it (the server
// replaces the whole target, so a currency sent alone would lose an amount). An amount that is not a number (or a bad
// entry) goes as { amount: null }, which the server refuses with its sentence, so a bad entry never clears a stored budget.
const budgetText = (v) => ({
  amount: v && v.amount !== undefined && v.amount !== null && v.amount !== '' ? String(v.amount).trim() : '',
  currency: v && typeof v.currency === 'string' ? v.currency.trim().toUpperCase() : '',
});
// The sentence refusing what the budget field holds before anything is sent, or null when it may go: a bad entry, or an
// amount that is not a finite number. Empty is fine (no budget); the server's own rules (above zero, 12 digits) stay its.
export const BUDGET_NOT_A_NUMBER = 'The budget must be a number, such as 4000 or 4000.50.';
export function budgetEntryProblem(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.bad === true) return BUDGET_NOT_A_NUMBER;
  const { amount } = budgetText(v);
  if (amount && !Number.isFinite(Number(amount))) return BUDGET_NOT_A_NUMBER;
  return null;
}
// Whether Set up shows the Budget section, and the module it names: a module that reads the target is on here (its
// manifest says `"budget": true`; `installed` is the module list the person may read: GET /api/modules for an owner,
// GET /api/modules/for-space for a moderator, every enabled module being on in every space but the Lobby keeping its
// own), a module reported a fact marked `budget` (`reported`, { name }), or a target is set already, an amount or a
// currency alone. { show, name }.
export function budgetWanted({ lobby = false, installed = [], reported = null, stored = null } = {}) {
  if (lobby) return { show: false, name: '' };
  const reads = (Array.isArray(installed) ? installed : []).find((m) => m && m.enabled !== false && m.budget === true && Array.isArray(m.scope) && m.scope.includes('space'));
  const name = (reported && reported.name) || (reads ? reads.displayName || reads.name || '' : '');
  return { show: Boolean(reads || reported || budgetText(stored).amount || budgetText(stored).currency), name };
}
function budgetSent(v) {
  const b = budgetText(v);
  if (v && v.bad === true) return { amount: null, ...(b.currency ? { currency: b.currency } : {}) };
  if (!b.amount) return b.currency ? { currency: b.currency } : null;
  const amount = Number(b.amount);
  return { amount: Number.isFinite(amount) ? amount : null, ...(b.currency ? { currency: b.currency } : {}) };
}
const sameBudget = (a, b) => JSON.stringify(budgetSent(a)) === JSON.stringify(budgetSent(b));

// The owner's tabs (plan-workspaces.md, "Owner controls"; server/layouts.js cleanTabs and tabsOf): the fixed layouts' ids in
// their default order, and `tabs` whole as { order: [every id], hide: [ids] }. The Layouts section works on a draft that holds
// `tabs` and `defaultLayout`; each helper answers a new draft and never changes the one it was given. Pure, for check-nav.
export const LAYOUT_IDS = Object.freeze(['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents', 'schedule']);
// Whole tabs from what is stored or sent: unknown ids and repeats are dropped, any id left out is added at the end in the
// default order, and the Workspace is never in hide.
export function tabsWhole(raw) {
  const have = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const list = (v) => (Array.isArray(v) ? v.filter((id, i) => LAYOUT_IDS.includes(id) && v.indexOf(id) === i) : []);
  const order = list(have.order);
  return { order: [...order, ...LAYOUT_IDS.filter((id) => !order.includes(id))], hide: LAYOUT_IDS.filter((id) => id !== 'workspace' && list(have.hide).includes(id)) };
}
const sameTabs = (a, b) => {
  const x = tabsWhole(a);
  const y = tabsWhole(b);
  return x.order.join() === y.order.join() && x.hide.join() === y.hide.join();
};
// The rows of the Layouts section: the layouts this space can show (`system`, the server's list for this person), in the
// owner's order, each { id, name, icon, shown, locked }. The Workspace is locked on (it can never be hidden). A name is the
// layout's own (its default), not one person's rename.
export function layoutRows(tabs, system = []) {
  const here = new Map((Array.isArray(system) ? system : []).filter((l) => l && LAYOUT_IDS.includes(l.id)).map((l) => [l.id, l]));
  const whole = tabsWhole(tabs);
  return whole.order.filter((id) => here.has(id)).map((id) => {
    const l = here.get(id);
    return { id, name: String(l.defaultName || l.name || id), icon: l.defaultIcon || l.icon || '', shown: id === 'workspace' || !whole.hide.includes(id), locked: id === 'workspace' };
  });
}
// Show or hide one layout in the bar. The Workspace and an unknown id are no change. Hiding the layout that opens first puts
// the Workspace back as what opens first (the default must be a layout that is shown).
export function withLayoutShown(draft = {}, id, on) {
  if (id === 'workspace' || !LAYOUT_IDS.includes(id)) return draft;
  const whole = tabsWhole(draft.tabs);
  const hide = on ? whole.hide.filter((h) => h !== id) : [...whole.hide.filter((h) => h !== id), id];
  const next = { ...draft, tabs: tabsWhole({ order: whole.order, hide }) };
  if (!on && draft.defaultLayout === id) next.defaultLayout = null;
  return next;
}
// Move one layout up (`by` -1) or down (+1) past its neighbour among the layouts this space can show (`available`, ids);
// ids it cannot show keep their places. At the end of the list, or an unknown id, no change.
export function withLayoutMoved(draft = {}, id, by, available = LAYOUT_IDS) {
  const whole = tabsWhole(draft.tabs);
  const here = whole.order.filter((x) => available.includes(x));
  const at = here.indexOf(id);
  const to = at + (by < 0 ? -1 : 1);
  if (at < 0 || to < 0 || to >= here.length) return draft;
  const order = [...whole.order];
  const a = order.indexOf(here[at]);
  const b = order.indexOf(here[to]);
  [order[a], order[b]] = [order[b], order[a]];
  return { ...draft, tabs: { order, hide: whole.hide } };
}
// "<name> moved to position N." for the live region: N counts the layouts this space can show, from 1.
export function movedWords(draft = {}, id, name, available = LAYOUT_IDS) {
  const at = tabsWhole(draft.tabs).order.filter((x) => available.includes(x)).indexOf(id);
  return at < 0 ? '' : `${name} moved to position ${at + 1}.`;
}
// Pick what opens first: the Workspace is no default (null), a fixed layout the owner hid cannot be picked, anything else
// (a fixed layout shown, or a shared layout's id) is.
export function withOpensFirst(draft = {}, id) {
  if (id === 'workspace' || !id) return { ...draft, defaultLayout: null };
  if (LAYOUT_IDS.includes(id) && tabsWhole(draft.tabs).hide.includes(id)) return draft;
  return { ...draft, defaultLayout: id };
}

// The PATCH body for what changed between `before` (the space as it was) and `after` (the panel's draft), each
// { name, description, profile, link, linkIcon, publishCalendar, members, allowGuests, phases, defaultLayout,
// aiOff, budget }; a field left out of `after` is unchanged. The budget goes as null (none) or { amount, currency? }. The phase dates go whole, when any phase's start or end changed
// (the order of the keys is no change). A name is trimmed, and an empty one is no change. The first visit's layout and
// Opens with are independent (plan-layout-views.md, step 5): each goes only when it changed, never one for the other.
// `defaultLayout` is 'calendar', 'map' or a shared layout's id; the Workspace (null, or 'workspace') goes as null. The
// members are a set (their order is no change). {} when nothing changed.
const sameAiSees = (a, b) => (a ? (b ? sameSees(a, b) : false) : !b);
const layoutOrNull = (v) => (typeof v === 'string' && v && v !== 'workspace' ? v : null);
// `phaseIds`, when given, are the phases the panel shows (the space's template's): the dates go only for those. A date the
// space holds for a phase its template no longer has (the template was changed) is neither sent nor a change, so a save
// never carries it and the server keeps it (plan-space-templates.md, "Phase dates after a change").
const datesFor = (dates, ids) => {
  const all = datesCopy(dates);
  return Array.isArray(ids) ? Object.fromEntries(Object.entries(all).filter(([id]) => ids.includes(id))) : all;
};
export function setupPatch(before = {}, after = {}, { phaseIds = null } = {}) {
  const patch = {};
  const name = typeof after.name === 'string' ? after.name.trim() : '';
  if (name && name !== (before.name || '')) patch.name = name;
  if (typeof after.description === 'string' && text(after.description) !== text(before.description)) patch.description = text(after.description);
  if (typeof after.template === 'string' && after.template !== (before.template || SAME)) patch.template = after.template || null; // '' is the environment's: null clears
  if (after.profile !== undefined && after.profile !== (before.profile || 'participants')) patch.profile = after.profile;
  if (typeof after.link === 'string' && text(after.link) !== text(before.link)) patch.link = text(after.link);
  if (typeof after.linkIcon === 'string' && after.linkIcon && after.linkIcon !== before.linkIcon) patch.linkIcon = after.linkIcon;
  if (typeof after.publishCalendar === 'boolean' && after.publishCalendar !== (before.publishCalendar !== false)) patch.publishCalendar = after.publishCalendar;
  if (Array.isArray(after.members) && !sameSet(after.members, Array.isArray(before.members) ? before.members : [])) patch.members = [...after.members];
  if (typeof after.entry === 'string' && after.entry !== (before.entry || 'invited')) patch.entry = after.entry;
  if (typeof after.closed === 'boolean' && after.closed !== (before.closed === true)) patch.closed = after.closed;
  if (typeof after.requestAccess === 'boolean' && after.requestAccess !== (before.requestAccess === true)) patch.requestAccess = after.requestAccess;
  if (typeof after.allowGuests === 'boolean' && after.allowGuests !== (before.allowGuests !== false)) patch.allowGuests = after.allowGuests;
  if (typeof after.guestsSeeHidden === 'boolean' && after.guestsSeeHidden !== (before.guestsSeeHidden === true)) patch.guestsSeeHidden = after.guestsSeeHidden;
  if (after.phases && typeof after.phases === 'object' && !sameDates(datesFor(after.phases, phaseIds), datesFor(before.phases, phaseIds))) patch.phases = datesFor(after.phases, phaseIds);
  if (typeof after.aiOff === 'boolean' && after.aiOff !== (before.aiOff === true)) patch.aiOff = after.aiOff;
  // What AI may see: null follows the environment's choice; else the space's own, whole.
  if (after.aiSees !== undefined && !sameAiSees(after.aiSees, before.aiSees)) patch.aiSees = after.aiSees ? fullSees(after.aiSees) : null;
  if (after.budget !== undefined && !sameBudget(after.budget, before.budget)) patch.budget = budgetSent(after.budget);
  // The owner's tabs go whole ({ order, hide }) and only when the order or the hidden set changed.
  if (after.tabs !== undefined && !sameTabs(after.tabs, before.tabs)) patch.tabs = tabsWhole(after.tabs);
  const wasLayout = layoutOrNull(before.defaultLayout);
  const nowLayout = after.defaultLayout === undefined ? wasLayout : layoutOrNull(after.defaultLayout);
  if (nowLayout !== wasLayout) patch.defaultLayout = nowLayout;
  return patch;
}

// The tabs with unsaved changes: the PATCH's fields, the picture when one was chosen or removed, and a module's
// settings (or a Fixed Workspace switch) when any changed.
export function dirtyTabs(patch = {}, { image = false, modules = false, tabs: have = null } = {}) {
  const tabs = new Set(Object.keys(patch).map((f) => (FIELD_TAB[f] ? tabOfField(f, have) : null)).filter(Boolean));
  if (image) tabs.add('details');
  if (modules) tabs.add('modules');
  return tabs;
}

// Which field of a refused PATCH the server's sentence is about (store.updateSpace's sentences), else its first.
const PROBLEM_FIELDS = [
  [/template/i, 'template'],
  [/budget|currenc/i, 'budget'], [/may see/i, 'aiSees'], [/\bAI\b/, 'aiOff'], [/icon/i, 'linkIcon'], [/publish/i, 'publishCalendar'], [/link/i, 'link'], [/member/i, 'members'], [/guest/i, 'allowGuests'],
  [/tabs|order|hide|always shown|listed twice|each layout once/i, 'tabs'], [/layout|first visit/i, 'defaultLayout'], [/profile/i, 'profile'], [/phase|date|\b(starts?|ends?)\b/i, 'phases'],
];
export function problemField(patch = {}, problem = '') {
  const keys = Object.keys(patch);
  for (const [re, field] of PROBLEM_FIELDS) if (keys.includes(field) && re.test(problem)) return field;
  return keys[0] || null;
}

// The line a person reads after Save: what was saved, in words, and what to do next. `saved` is the fields that went
// through (the PATCH's keys, 'image' or 'imageRemoved', and `module:<id>` for a module's settings); `failed` a field
// that did not with the server's sentence. `words` names a field in this environment's words: the panel always gives
// the members ("the players") and the guest link switch, which are role words, and each module's settings by its name.
const FIELD_WORDS = {
  name: 'the name', description: 'the description', template: 'the template', profile: 'the faces in the call', link: 'the launch link', linkIcon: 'the link icon',
  publishCalendar: 'the published calendar', phases: 'the phase dates', aiOff: 'Turn AI off', aiSees: 'What AI may see',
  defaultLayout: 'the first visit', tabs: 'the tabs in the bar', call: 'the call settings', image: 'the picture', imageRemoved: 'the picture', budget: 'the budget',
};
export function setupSaidWords({ saved = [], failed = null, problem = '' } = {}, { setUp = 'Set up', words = {} } = {}) {
  const wordOf = (f) => words[f] || FIELD_WORDS[f] || f;
  const names = [...new Set(saved.map(wordOf))];
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '';
  if (failed) {
    const what = wordOf(failed);
    const why = problem ? ` ${problem[0].toUpperCase()}${problem.slice(1).replace(/\.?$/, '.')}` : '';
    const many = ['members', 'phases', 'call'].includes(failed) || String(failed).startsWith('module:'); // "the players", "the Maps settings"
    return `${what[0].toUpperCase()}${what.slice(1)} ${many ? 'were' : 'was'} not saved.${why}${names.length ? ` ${list[0].toUpperCase()}${list.slice(1)} ${names.length > 1 ? 'were' : 'was'} saved.` : ''} Change it and press Save again, or Cancel.`;
  }
  if (!names.length) return `Nothing changed. Press ${setUp} to change something.`;
  return `Saved ${list}. Everyone sees it now; press ${setUp} to change more.`;
}

// The space as the panel's `before`: each field as the server means it (no link is '', the calendar and guests are
// on unless false).
function beforeOf(space = {}) {
  return {
    name: space.name || '',
    description: typeof space.description === 'string' ? space.description : '',
    template: typeof space.template === 'string' ? space.template : SAME, // the space's own template; '' follows the environment's
    // 'roleplaying' is the older name of the participants' pictures (server/store.js), so it reads as that here.
    profile: space.profile === 'characters' ? 'characters' : 'participants',
    link: typeof space.link === 'string' ? space.link : '',
    linkIcon: typeof space.linkIcon === 'string' ? space.linkIcon : '',
    publishCalendar: space.publishCalendar !== false,
    members: Array.isArray(space.members) ? [...space.members] : [],
    allowGuests: space.allowGuests !== false,
    entry: space.entry === 'accounts' || space.entry === 'guests' ? space.entry : 'invited',
    requestAccess: space.requestAccess === true,
    closed: space.closed === true,
    guestsSeeHidden: space.guestsSeeHidden === true,
    defaultLayout: space.defaultLayout || null,
    tabs: tabsWhole(space.tabs),
    phases: datesCopy(space.phases),
    aiOff: space.aiOff === true,
    aiSees: space.aiSees && typeof space.aiSees === 'object' ? fullSees(space.aiSees) : null,
    budget: budgetText(space.budget),
    call: callOf(space.call), // the space's own; null for a key means the template's
  };
}
const copyOf = (b) => ({ ...b, tabs: tabsWhole(b.tabs), members: [...b.members], phases: datesCopy(b.phases), budget: { ...b.budget }, call: { ...b.call }, aiSees: b.aiSees ? { ...b.aiSees, modules: Array.isArray(b.aiSees.modules) ? [...b.aiSees.modules] : b.aiSees.modules } : null });
// After a step of the save went through: each field it sent is now what the server answered, in both `before` and the
// draft, so a value the server normalized (a link stored as https://example.com/ for https://example.com) is no
// change and leaves no dot. The fields it did not send stay as they were. Answers { before, draft }, new objects.
export function takeSaved(before = {}, draft = {}, fields = [], answer = {}) {
  const fresh = beforeOf(answer);
  const nextBefore = { ...before };
  const nextDraft = { ...draft };
  for (const k of fields) {
    if (!(k in fresh)) continue;
    const v = fresh[k];
    nextBefore[k] = v;
    nextDraft[k] = Array.isArray(v) ? [...v] : k === 'tabs' ? tabsWhole(v) : k === 'phases' ? datesCopy(v) : k === 'budget' || k === 'call' ? { ...v } : v;
  }
  return { before: nextBefore, draft: nextDraft };
}
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- the panel ----------------------------------------------------------------------------------------------------

// `deps`: { tabOverflow, openMenu, api, word, verb, icons, switchListHtml, wireSwitchList, layoutLine, escapeHtml, doc,
// renderModuleSettings }. Returns { open(opts), close(), done(), cancel(), isOpen(), select(tab), el }. `open({ space,
// owner, moderator, phases, rule, today, tab, onDone, onSaved, onDeleted, onLinks, onTab, onLeave, nameInput })`:
// `space` the space's record, `phases` the template's phases (a list) and `rule` the Phases object (public/phases.js),
// `today` a day (YYYY-MM-DD), `tab` the address fragment asking for a tab, `nameInput` the bar's input (kept in step
// with the Name), `onDone(space, said, saved)` is told once the whole save went through, `onSaved(space, saved)` after
// a part of it did and a later request was refused, `onDeleted(space)` after Delete, `onLinks(space)` after an invite
// or guest link action, `onTab(id)` as the tab changes, `onLeave()` when the mode ends either way.
export function createSpaceSetup(deps) {
  const { api, word, switchListHtml, wireSwitchList, layoutLine, escapeHtml, tabOverflow, openMenu: openHostMenu } = deps; // tabOverflow (primary-nav.js) and openMenu (host-menu.js) come from the page
  const doc = deps.doc || document;
  const el = doc.createElement('aside');
  el.id = 'space-setup';
  el.className = 'space-setup action-surface';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-labelledby', 'space-setup-title');
  el.hidden = true;
  let state = null; // while open: { space, tabs, tab, draft, before, options, layouts, opts, image, links, users, saving, bar }

  const esc = (s) => escapeHtml(String(s ?? ''));
  const spaceWord = () => word('space');
  const membersWord = (cap = false) => word('member', { many: true, cap });
  const modulesWord = (cap = false) => word('module', { many: true, cap });
  const switchRow = (id, label) => `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">${label}</span></span><input type="checkbox" class="sdk-switch" role="switch" id="${id}"></label>`;
  const configLabel = () => configurationLabel(word, Boolean(state && state.space && state.space.isAside)); // the button's name too (space.js setupLabel)
  const tabLabel = (id) => tabLabelOf(id, word);
  const sectionHtml = (id, title, inner, { hidden = false, cls = '' } = {}) => `<section class="setup-section${cls ? ` ${cls}` : ''}" data-section="${id}"${hidden ? ' hidden' : ''}><h3 class="setup-heading">${title}</h3>${inner}</section>`;

  function detailsTabHtml() {
    const { space } = state;
    const parts = [];
    parts.push(sectionHtml('picture', 'Picture', `
        <div class="setup-picture">
          <img id="setup-picture-img" alt="" hidden>
          <span class="setup-picture-none" id="setup-picture-none">No picture</span>
          <span class="setup-picture-buttons">
            <label class="btn btn-small setup-picture-pick"><input type="file" id="setup-picture-file" accept="image/png,image/jpeg,image/gif,image/webp" class="visually-hidden"><i class="fa-solid fa-image fa-fw" aria-hidden="true"></i> Choose a picture</label>
            <button type="button" class="btn btn-small" id="setup-picture-remove" hidden><i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i> Remove</button>
          </span>
        </div>
        <p class="hint">Shown with its name on Home.</p>`));
    parts.push(sectionHtml('name', 'Name', '<label class="setup-field"><span class="visually-hidden">Name</span><input type="text" id="setup-name" maxlength="40" autocomplete="off"></label><p class="hint">Shown in the bar and on Home.</p>'));
    parts.push(sectionHtml('description', 'Description <span class="sdk-optional">(optional)</span>', `<label class="setup-field"><span class="visually-hidden">Description</span><textarea id="setup-description" rows="3" maxlength="300"></textarea></label><p class="hint">A line or two about this ${esc(spaceWord())}.</p>`));
    if (!space.isLobby) parts.push(sectionHtml('template', 'Template', `<label class="setup-field"><span class="visually-hidden">Template</span><select id="setup-template"></select></label><p class="hint" id="setup-template-about"></p><p class="hint">Its words, phases and ${esc(word('module'))} names in this ${esc(spaceWord())}.</p>`, { hidden: true }));
    const enter = typeof deps.verb === 'function' ? deps.verb('enter') : 'Enter';
    parts.push(sectionHtml('link', 'Launch link <span class="sdk-optional">(optional)</span>', `<label class="setup-field"><span class="visually-hidden">Launch link</span><input type="url" id="setup-link" maxlength="500" placeholder="https://your-game-or-site.example" autocomplete="off" inputmode="url"></label><p class="hint">A button next to ${esc(enter)} and in the call's toolbar opens it.</p>`));
    if ((typeof deps.icons === 'function' ? deps.icons() : []).length) {
      parts.push(sectionHtml('link-icon', '<span id="setup-link-icon-heading">Link icon</span>', '<div class="icon-grid setup-icon-grid" id="setup-link-icon" role="radiogroup" aria-labelledby="setup-link-icon-heading"></div><p class="hint">The icon on the launch link\'s button.</p>'));
    }
    if (!space.isLobby) {
      parts.push(sectionHtml('calendar', '<span id="setup-calendar-heading">Calendar</span>', `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">In the published calendar</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-publish-calendar"></label><p class="hint">${esc(word('owner', { many: true, cap: true }))} can publish one calendar with every ${esc(spaceWord())}'s events. Turn this off to leave this ${esc(spaceWord())} out.</p>`, { hidden: true }));
    }
    return parts.join('');
  }

  // The Delete section: the last thing on the Details tab, after the budget and everything else (draw adds it). Not for the Lobby.
  function dangerSectionHtml() {
    return sectionHtml('danger', `Delete this ${esc(spaceWord())}`, `
        <button type="button" class="btn btn-small btn-danger" id="setup-delete" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-trash fa-fw" aria-hidden="true"></i> Delete ${esc(spaceWord())}</button>
        <p class="hint">Happens at once; it does not wait for Save.</p>
        <div class="setup-confirm" id="setup-delete-confirm" role="alertdialog" aria-labelledby="setup-delete-words" hidden>
          <p class="setup-confirm-words" id="setup-delete-words"></p>
          <div class="setup-confirm-buttons">
            <button type="button" class="btn btn-small btn-danger" id="setup-delete-yes">Delete</button>
            <button type="button" class="btn btn-small" id="setup-delete-keep">Keep</button>
          </div>
          <p class="setup-confirm-problem" id="setup-delete-problem" role="status" aria-live="polite"></p>
        </div>`, { cls: 'setup-danger' });
  }

  // The budget (#216): an amount and its currency, a draft saved with Save. Drawn for every space but the Lobby, on the
  // tab budgetTabOf names, and shown while a module here reads it or one is set (budgetWanted; paintBudgetSection), which
  // is known only once the person's own record, the module list and the facts have come: hidden until then, so nothing
  // typed is lost. An owner, the admin and a moderator of the space have it; a member has no Set up.
  function budgetSectionHtml() {
    return sectionHtml('budget', '<span id="setup-budget-heading">Budget</span>', `
        <div class="setup-budget" role="group" aria-labelledby="setup-budget-heading">
          <label class="setup-field setup-budget-amount"><span class="visually-hidden">Amount</span><input type="number" id="setup-budget-amount" min="0" step="any" inputmode="decimal" placeholder="No budget" autocomplete="off"></label>
          <label class="setup-field setup-budget-currency"><span class="visually-hidden">Currency</span><select id="setup-budget-currency"></select></label>
        </div>
        <p class="hint" id="setup-budget-hint"></p>`, { hidden: true });
  }

  // The Call tab (plan-templates-redesign.md, step 4; plan-workspaces.md, decision 38): Join on entry, Position and Layout,
  // each the template's until set, for every space but the Lobby and an aside, shown once the stored values are in (hidden
  // until then, so nothing typed is lost) and saved with Save as its own request (a person's own Position and Layout,
  // picked in the call, win over these); then, an owner's, Faces in the call.
  function callSectionHtml() {
    const options = (list) => `<option value="">${esc(CALL_SAME)}</option>${list.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join('')}`;
    const field = (id, label, list, hint) => `<div class="setup-call-field"><label class="setup-call-label" for="${id}">${esc(label)}</label><select id="${id}" class="setup-call-select">${list}</select><p class="hint" id="${id}-now"></p></div>`;
    return sectionHtml('call', '<span id="setup-call-heading">How the call opens</span>', `
        <div class="setup-call" role="group" aria-labelledby="setup-call-heading">
          ${field('setup-call-join', 'Join on entry', `<option value="">${esc(CALL_SAME)}</option><option value="true">Join the call on entry</option><option value="false">Do not join on entry</option>`)}
          ${field('setup-call-position', 'Position', options(CALL_POSITION_CHOICES))}
          ${field('setup-call-layout', 'Layout', options(CALL_LAYOUT_CHOICES))}
        </div>
        <p class="hint">Joining on entry starts with the microphone and camera off. A person's own position and layout win once they pick them.</p>`, { hidden: true });
  }
  function callTabHtml() {
    const parts = [callAsked() ? callSectionHtml() : ''];
    if (state.owner) parts.push(sectionHtml('faces', 'Faces in the call', `
        <label class="setup-field"><span class="visually-hidden">Faces in the call</span><select id="setup-profile">
          <option value="participants">People's own pictures</option>
          <option value="characters">Their character pictures</option>
        </select></label>
        <p class="hint">What each person's tile shows while their camera is off.</p>`));
    return parts.join('');
  }
  const callAsked = () => !state.space.isLobby && !state.space.isAside;
  const callWord = (list, v) => (list.find(([x]) => x === v) || [, ''])[1];
  function paintCall() {
    const section = q('[data-section="call"]');
    if (!section) return;
    if (state.callIn) section.hidden = false;
    const draft = state.draft.call;
    q('#setup-call-join').value = draft.joinOnEntry === null ? '' : String(draft.joinOnEntry);
    q('#setup-call-position').value = draft.position || '';
    q('#setup-call-layout').value = draft.layout || '';
    // What the call does now, from the server's own reading (the template's value where this space holds none).
    const now = state.lookCall || {};
    const say = (id, own, text) => { const n = q(`#${id}-now`); if (n) { n.textContent = own === null && text ? `Now: ${text}.` : ''; n.hidden = !n.textContent; } };
    say('setup-call-join', draft.joinOnEntry, typeof now.joinOnEntry === 'boolean' ? (now.joinOnEntry ? 'joins on entry' : 'does not join on entry') : '');
    say('setup-call-position', draft.position, callWord(CALL_POSITION_CHOICES, now.position));
    say('setup-call-layout', draft.layout, callWord(CALL_LAYOUT_CHOICES, now.layout));
  }
  function wireCall() {
    const set = (id, key, parse) => q(`#${id}`)?.addEventListener('change', (event) => { state.draft.call[key] = parse(event.target.value); refresh(); });
    set('setup-call-join', 'joinOnEntry', (v) => (v === 'true' ? true : v === 'false' ? false : null));
    set('setup-call-position', 'position', (v) => v || null);
    set('setup-call-layout', 'layout', (v) => v || null);
  }
  // The call's own body now, or {} (nothing changed, or the section is not here for this space).
  const callPatchNow = () => (state && callAsked() && state.callIn ? callPatch(state.before, state.draft) : {});

  function membersTabHtml() {
    const { space } = state;
    const guest = word('guest');
    const guests = word('guest', { many: true, cap: true });
    const guestsMany = word('guest', { many: true });
    const parts = [];
    parts.push(sectionHtml('members', `<span id="setup-members-heading">${esc(membersWord(true))}</span>`, space.isLobby
      ? `<p class="hint">Everyone belongs to the ${esc(space.name || 'Lobby')}.</p>`
      : `<div class="setup-members" id="setup-members" role="group" aria-labelledby="setup-members-heading"></div><p class="hint">Who is in this ${esc(spaceWord())}.</p>`));
    if (state.owner && !space.isLobby) {
      parts.push(sectionHtml('entry', '<span id="setup-entry-heading">Who can enter</span>', `<div class="setup-switches" id="setup-entry" role="group" aria-labelledby="setup-entry-heading">
          ${switchRow('setup-open', '<span id="setup-open-label"></span>')}
          ${switchRow('setup-entry-accounts', `All <span id="setup-environment-name"></span> ${esc(membersWord())}`)}
          ${switchRow('setup-allow-guests', esc(`Invited ${guestsMany}`))}
          ${switchRow('setup-entry-guests', esc(`Visiting ${guestsMany}`))}
        </div><p class="hint" id="setup-closed-note" hidden>This ${esc(spaceWord())} is closed for set up. Only ${esc(word('owner', { many: true }))}, its ${esc(word('moderator', { many: true }))} and the ${esc(word('admin'))} can enter it. The other switches keep what they were.</p>
        <p class="hint" id="setup-door-note" hidden>The host has not turned ${esc(word('guest'))} sign-in on, so this does nothing yet.</p>
        <p class="hint" id="setup-entry-hint">${esc(membersWord(true))} of the ${esc(spaceWord())} come in. All ${esc(membersWord())} see it on Home and can join it. Invited ${esc(guestsMany)} come in with a ${esc(word('guest'))} link. Visiting ${esc(guestsMany)} come in from the sign-in page with just a name.</p>
        <label class="sdk-choice-row setup-ask-row"><span class="sdk-choice-text"><span class="sdk-choice-label">People can ask to come in</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-request-access"></label><p class="hint">Someone who cannot enter sees this ${esc(spaceWord())}'s name, picture and description, and can ask.</p>`));
      parts.push(sectionHtml('waiting', 'Waiting to come in', `<div id="setup-waiting"></div><p class="setup-links-status" id="setup-waiting-status" role="status" aria-live="polite"></p>`));
    }
    parts.push(sectionHtml('guests', esc(guests), `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(guests)} can see costs and booking codes</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-guests-see-hidden"></label><p class="hint">Off keeps amounts and booking codes from ${esc(guests.toLowerCase())}. Only ${esc(word('owner', { many: true }))} can change this.</p>`));
    parts.push(sectionHtml('links', 'Links', `
        <h4 class="setup-subheading">Invite to sign up</h4>
        <div class="setup-link-row">
          <button type="button" class="btn btn-small" id="setup-make-invite"><i class="fa-solid fa-envelope fa-fw" aria-hidden="true"></i> Generate invite link</button>
        </div>
        <div class="setup-link-row" id="setup-invite-row" hidden>
          <code class="key link" id="setup-invite-link"></code>
          <button type="button" class="btn btn-small" id="setup-invite-copy">Copy</button>
        </div>
        <p class="hint">Signs someone up and puts them in this ${esc(spaceWord())}. One use, for 7 days.</p>
        <h4 class="setup-subheading">${esc(word('guest', { cap: true }))} link</h4>
        <div class="setup-link-row">
          <code class="key link" id="setup-guest-link-value">off</code>
          <button type="button" class="btn btn-small" id="setup-guest-link-on">Turn on</button>
          <button type="button" class="btn btn-small" id="setup-guest-link-copy" hidden>Copy</button>
          <button type="button" class="btn btn-small" id="setup-guest-link-new" hidden>New link</button>
          <button type="button" class="btn btn-small btn-danger" id="setup-guest-link-off" hidden>Turn off</button>
        </div>
        <p class="hint" id="setup-guest-link-note" hidden></p>
        <p class="hint">Anyone with it can come in with just a name.</p>
        <p class="setup-links-status" id="setup-links-status" role="status" aria-live="polite"></p>`));
    return parts.join('');
  }

  // Phases (plan-setup-panel.md, step 4): the phase sheet's rows, inline, one per phase in the template's order: its
  // name, a start and an end (native date inputs) and its length; an undated row reads "Not scheduled" with Add dates.
  // Every edit goes through the rule (public/phases.js: setPhaseDate, addDatesFor, skipPhase, as the sheet does), so the
  // timeline stays contiguous; a refusal is one sentence by the row and the input snaps back. Nothing dated yet: the
  // first step, "Start the first phase on". The dates are a draft: they go in Save's PATCH.
  function phasesTabHtml() {
    const rows = state.phaseList.map((p) => `
          <li class="phase-row" data-id="${esc(p.id)}" style="--tint: ${esc(p.color)}">
            <div class="phase-row-name">
              <span class="phase-swatch" aria-hidden="true"></span>
              ${rowIconHtml(p)}<span class="phase-row-label">${esc(p.label)}</span>
              <span class="sdk-chip-tag" data-phase-tag="now" data-tone="info" hidden>now</span>
              <span class="sdk-chip-tag" data-phase-tag="main" hidden>main</span>
            </div>
            <label class="phase-row-field phase-row-start"><span class="phase-row-word">Start</span><input type="date" class="phase-date" data-edge="start" data-id="${esc(p.id)}" aria-label="${esc(p.label)} starts"></label>
            <label class="phase-row-field phase-row-end"><span class="phase-row-word">End</span><input type="date" class="phase-date" data-edge="end" data-id="${esc(p.id)}" aria-label="${esc(p.label)} ends"></label>
            <span class="phase-row-days"></span>
            <div class="phase-row-tools"><button type="button" class="btn btn-small phase-skip" aria-label="Skip ${esc(p.label)}: clear its dates">Skip</button></div>
            <div class="phase-row-off" hidden><span class="phase-row-off-word">Not scheduled</span><button type="button" class="btn btn-small phase-add" aria-label="Add dates for ${esc(p.label)}"><i class="fa-solid fa-plus fa-fw" aria-hidden="true"></i> Add dates</button></div>
            <div class="phase-row-done" data-done-for="${esc(p.id)}" hidden></div>
            <p class="phase-row-problem" hidden></p>
          </li>`).join('');
    return `<section class="setup-section" data-section="phases"><h3 class="setup-heading" id="setup-phases-heading">Phases</h3>
        <p class="setup-phases-now" id="setup-phases-now"></p>
        <p class="hint setup-phases-measure" id="setup-phases-measure" hidden></p>
        <div class="phase-first setup-phase-first" id="setup-phase-first" hidden>
          <label class="phase-first-label" for="setup-phase-first-day">Start the first phase on</label>
          <input type="date" class="phase-date" id="setup-phase-first-day">
          <button type="button" class="btn btn-small" id="setup-phase-first-go">Start</button>
        </div>
        <ol class="phase-list setup-phase-list" id="setup-phase-list" aria-labelledby="setup-phases-heading">${rows}</ol>
        <p class="hint">Each phase starts the day after the one before ends. A phase with no dates is skipped.</p>
        <p class="setup-phases-status" id="setup-phases-status" role="status" aria-live="polite"></p></section>`;
  }

  // Tabs in the bar, the first section of the Layout tab (plan-workspaces.md, step 3, decisions 4, 13, 22 and 38): one row per fixed layout this
  // space can show, in the owner's order, each with Show in the bar (the Workspace's is on and cannot be turned off), Move up
  // and Move down (buttons, so no dragging), and Opens first: the radios of one name, `setup-first-visit`, that First visit's
  // shared layouts share. One choice, the space's defaultLayout. Painted by paintLayoutRows(); a draft, saved with Save.
  function layoutsSectionHtml() {
    return `<section class="setup-section" data-section="layouts"><h3 class="setup-heading" id="setup-layouts-heading">Tabs in the bar</h3>
        <p class="hint" id="setup-layouts-hint">Which tabs show in the bar at the top of this ${esc(spaceWord())}, in what order, and which opens first. Everyone in this ${esc(spaceWord())} sees them. One you show is pinned: it stays in the bar for everyone, and nobody can hide it for themselves.</p>
        <ul class="setup-layout-rows" id="setup-layout-rows" aria-labelledby="setup-layouts-heading" aria-describedby="setup-layouts-hint"></ul>
        <p class="visually-hidden" id="setup-layouts-live" role="status" aria-live="polite"></p></section>`;
  }
  // First visit, a section of the Layout tab (plan-layout-views.md, step 5; plan-workspaces.md, step 3): what a new person sees
  // in the Workspace (the template's layout, one read-only line; plan-layout-picker.md, step 3), and the shared layouts by name, which share Opens first's radios with the
  // fixed layouts above (paintLayouts). Each person's own arrangement is remembered once they have a module open.
  function firstVisitHtml() {
    return `<section class="setup-section" data-section="first-visit"><h3 class="setup-heading" id="setup-first-visit-heading">First visit</h3>
        <p class="hint setup-first-visit-hint" id="setup-first-visit-hint">What someone sees the first time they enter this ${esc(spaceWord())}. Once they open something, their own arrangement is remembered. Opens first, above, picks the layout; a shared layout can be picked here.</p>
        <div class="setup-opens-with-layout" id="setup-opens-with-layout" hidden>
          <span class="setup-opens-with-layout-text" id="setup-opens-with-layout-text"></span>
          <button type="button" class="btn btn-small" id="setup-opens-with-layout-stop">Stop using it</button>
        </div>
        <fieldset class="setup-first-visit" id="setup-first-visit" aria-labelledby="setup-first-visit-heading" aria-describedby="setup-first-visit-hint">
          <div class="setup-workspace-content">
            <p class="setup-subheading" id="setup-opens-with-label">In the Workspace, a new person sees these open</p>
            <p class="setup-opens-with-read" id="setup-opens-with"></p>
            <p class="hint" id="setup-opens-with-hint">This comes from the ${esc(spaceWord())}'s template.</p>
          </div>
          <div class="setup-first-layouts" id="setup-first-visit-layouts"></div>
        </fieldset>
        <p class="hint" id="setup-layout-note" hidden></p></section>`;
  }

  // The Layout tab (plan-workspaces.md, decision 38): Tabs in the bar, then First visit; for a moderator, who has no Members
  // tab, the one switch of Who can enter that is theirs, closing the space while it is set up. It sits here because it
  // decides who can come in to see what this tab sets out (the owner's own is in Who can enter, on Members).
  function layoutTabHtml() {
    const parts = [layoutsSectionHtml(), firstVisitHtml()];
    if (!state.owner && !state.space.isLobby) {
      parts.push(sectionHtml('open', '<span id="setup-open-heading">Who can enter</span>', `${switchRow('setup-open', '<span id="setup-open-label"></span>')}<p class="hint" id="setup-closed-note" hidden>This ${esc(spaceWord())} is closed for set up. Only ${esc(word('owner', { many: true }))}, its ${esc(word('moderator', { many: true }))} and the ${esc(word('admin'))} can enter it.</p><p class="hint">Turn this off to close the ${esc(spaceWord())} while you set it up. Turn it on to open it again.</p>`));
    }
    return parts.join('');
  }

  // The Modules tab (id `modules`; plan-setup-panel.md, step 5; plan-workspaces.md, decision 38): for a moderator first the
  // template this space reads (an owner chooses it on Details); for an owner and the admin where modules are turned on,
  // then Turn AI off while AI Assistant is on, and What AI may see; then Tags; then a section per module with its settings
  // for this space (module-settings.js in its draft mode, no Save on each) and, in it, the switches a Fixed Workspace offers
  // for that module (paintFixed).
  function modulesTabHtml() {
    const parts = [];
    if (!state.owner && !state.space.isLobby) parts.push(sectionHtml('template-seen', 'Template', `<p id="setup-template-seen"></p><p class="hint">Only the ${esc(word('owner'))} can change it.</p>`, { hidden: true }));
    if (state.owner) {
      parts.push(sectionHtml('ai', '<i class="fa-solid fa-wand-magic-sparkles fa-fw" aria-hidden="true"></i> AI', `<label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">Turn AI off in this ${esc(spaceWord())}</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-ai-off"></label><p class="hint">${esc(modulesWord(true))} here can use AI Assistant to summarise and answer questions. Turned off, nobody here can, whatever the roles allow.</p>`, { hidden: true }));
      parts.push(sectionHtml('ai-sees', 'What AI may see', `<p class="hint">What goes to the AI with a question in this ${esc(spaceWord())}. This only narrows it: the AI never sees what the person asking could not open.</p><label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label" id="setup-ai-sees-follow-label">Same as the ${esc(word('environment'))}'s choice</span></span><input type="checkbox" class="sdk-switch" role="switch" id="setup-ai-sees-follow"></label><div id="setup-ai-sees-box"></div>`, { hidden: true }));
    }
    if (!state.space.isLobby) parts.push(tagsSectionHtml());
    parts.push(sectionHtml('module-settings', `${esc(word('module', { cap: true }))} settings`, `<p class="hint">What each ${esc(word('module'))} does in this ${esc(spaceWord())}.${state.owner ? ` <span id="setup-modules-note">${esc(modulesWord(true))} are turned on for the whole ${esc(word('environment'))} in Manage.</span>` : ''}</p><div class="setup-module-settings" id="setup-module-settings"><p class="hint">Loading…</p></div><div class="setup-fixed-modules" id="setup-fixed-modules"></div>`));
    return parts.join('');
  }

  // Tags (plan-tags.md, decisions 4 and 8): the space's shared tag list, renamed, recoloured and deleted here by the people the
  // Roles grid lets (the "Rename, recolour and delete tags" right: moderators and owners by default, the admin always). Not a
  // draft: each change goes to the server at once (PATCH or DELETE /api/spaces/:id/tags/:tag) and the server decides and
  // answers in a sentence; a tag is made from a module's tag picker, not here. A name is set with textContent or .value.
  // A tag's colour (plan-colour-picker.md, decision 30) is set with the SDK's colour picker (window.hostColour.field, no opacity),
  // '#rrggbb', with "No colour" beside it for the plain chip; the chip is drawn by the SDK's paintTag. Without the SDK on the page
  // the colour stays a text field holding the hex.
  const TAG_NO_COLOUR = 'No colour';
  const paintTagChip = (chip, color) => {
    if (window.hostColour && typeof window.hostColour.paintTag === 'function') window.hostColour.paintTag(chip, color);
    else chip.dataset.tone = 'neutral';
  };
  function tagsSectionHtml() {
    return sectionHtml('tags', 'Tags', `<p class="hint">The shared tags of this ${esc(spaceWord())}, used by every ${esc(word('module'))} that has them. A new name or colour shows on everything tagged; deleting a tag takes it off everything.</p><div class="setup-tags" id="setup-tags" role="list"><p class="hint">Loading…</p></div><p class="setup-tags-status status" id="setup-tags-status" role="status" aria-live="polite"></p>`);
  }
  const tagsPath = (spaceId, tag = '') => `/api/spaces/${encodeURIComponent(spaceId)}/tags${tag ? `/${encodeURIComponent(tag)}` : ''}`;
  function tagsSay(words, bad = false) {
    const s = q('#setup-tags-status');
    if (!s) return;
    s.textContent = '';
    s.textContent = words;
    s.classList.toggle('bad', bad);
  }
  function paintTags() {
    const box = q('#setup-tags');
    if (!box || !state.tags) return;
    const may = state.tagsManage === true;
    box.replaceChildren();
    if (!state.tags.length) {
      const none = doc.createElement('p');
      none.className = 'hint';
      none.textContent = `No tags yet. They are made from a ${word('module')}'s tag picker.`;
      box.appendChild(none);
      return;
    }
    for (const t of state.tags) {
      const row = doc.createElement('div');
      row.className = 'setup-tag-row';
      row.setAttribute('role', 'listitem');
      row.dataset.tag = t.id;
      if (!may) {
        const chip = doc.createElement('span');
        chip.className = 'sdk-chip-tag';
        paintTagChip(chip, t.color);
        chip.textContent = t.name;
        row.appendChild(chip);
        box.appendChild(row);
        continue;
      }
      const name = doc.createElement('input');
      name.type = 'text';
      name.className = 'setup-tag-name';
      name.maxLength = 24;
      name.autocomplete = 'off';
      name.value = t.name;
      name.setAttribute('aria-label', `Name of the tag ${t.name}`);
      name.addEventListener('change', () => changeTag(t, { name: name.value }, '.setup-tag-name'));
      const tone = doc.createElement('span');
      tone.className = 'setup-tag-field'; // sized by what it shows: the swatch and the hex, or "No colour"
      const colour = doc.createElement('input');
      colour.type = 'text';
      colour.className = 'setup-tag-colour';
      colour.maxLength = 7;
      colour.autocomplete = 'off';
      colour.spellcheck = false;
      colour.value = t.color || '';
      colour.setAttribute('aria-label', `Colour of the tag ${t.name}`);
      colour.addEventListener('change', () => changeTag(t, { color: colour.value.trim() }, '.setup-tag-field .sdk-picker, .setup-tag-colour'));
      tone.appendChild(colour);
      const plain = doc.createElement('button');
      plain.type = 'button';
      plain.className = 'btn btn-small setup-tag-plain';
      plain.textContent = TAG_NO_COLOUR;
      plain.setAttribute('aria-label', `No colour for the tag ${t.name}`);
      plain.disabled = !t.color;
      plain.addEventListener('click', () => changeTag(t, { color: '' }, '.setup-tag-field .sdk-picker, .setup-tag-colour'));
      const del = doc.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-small btn-danger';
      del.setAttribute('aria-label', `Delete the tag ${t.name}`);
      del.textContent = 'Delete';
      del.addEventListener('click', () => deleteTag(t));
      row.append(name, tone, plain, del);
      box.appendChild(row);
      if (window.hostColour) window.hostColour.field(colour, { opacity: false, none: TAG_NO_COLOUR, label: `Colour of the tag ${t.name}` });
    }
  }
  // `back`: where the keyboard goes in the tag's row once the list is drawn again (after a colour, and after a refusal).
  async function changeTag(tag, patch, back) {
    const spaceId = state.space.id;
    try {
      const answer = await api('PATCH', tagsPath(spaceId, tag.id), patch);
      if (!state || state.space.id !== spaceId) return;
      state.tags = state.tags.map((t) => (t.id === tag.id ? { id: answer.tag.id, name: answer.tag.name, color: answer.tag.color } : t)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      tagsSay(patch.name !== undefined ? `Renamed to ${answer.tag.name}.` : answer.tag.color ? 'Colour changed.' : 'Colour taken off.');
      paintTags();
      if (patch.color !== undefined) tagFocus(tag.id, back);
    } catch (err) {
      tagsSay(err.message, true); // the server's sentence
      paintTags(); // the field goes back to what is kept
      tagFocus(tag.id, back);
    }
  }
  function tagFocus(id, sel) {
    const row = sel ? q(`.setup-tag-row[data-tag="${id}"]`) : null;
    const again = row && [...row.querySelectorAll(sel)].find((f) => f.getClientRects().length > 0);
    if (again) again.focus();
  }
  async function deleteTag(tag) {
    const spaceId = state.space.id;
    const yes = await confirmDialog({ title: `Delete the tag ${tag.name}?`, message: `It is taken off everything that uses it, in every ${word('module')}. This can't be undone.`, action: 'Delete', kind: 'destructive' }, doc).catch(() => false);
    if (!yes || !state || state.space.id !== spaceId) return;
    try {
      await api('DELETE', tagsPath(spaceId, tag.id));
      if (!state || state.space.id !== spaceId) return;
      state.tags = state.tags.filter((t) => t.id !== tag.id);
      tagsSay(`Deleted the tag ${tag.name}.`);
      paintTags();
      const next = q('#setup-tags .setup-tag-name') || q('#setup-content-modules');
      if (next) next.focus();
    } catch (err) {
      tagsSay(err.message, true);
    }
  }
  async function loadTags(space) {
    if (!q('#setup-tags')) return;
    const [list, me] = await Promise.all([
      api('GET', tagsPath(space.id)).then((r) => r.tags || []).catch((err) => { tagsSay(err.message, true); return null; }),
      api('GET', '/api/me').then((r) => r.user || null).catch(() => null),
    ]);
    if (!state || state.space.id !== space.id || !list) return;
    // Who may change them is the server's to say on each call; this only decides whether the fields are drawn, from the person's
    // own rights here (an owner and the admin always; else the right the Roles grid gives their role in this space).
    const { role, spaces: mine } = me || {};
    state.tagsManage = role === 'admin' || role === 'owner' || Boolean(mine && mine[space.id] && mine[space.id].effective && mine[space.id].effective.manageTags);
    state.tags = list.map((t) => ({ id: t.id, name: t.name, color: t.color }));
    paintTags();
  }

  const TAB_HTML = { details: detailsTabHtml, members: membersTabHtml, phases: phasesTabHtml, call: callTabHtml, layout: layoutTabHtml, modules: modulesTabHtml };

  function draw() {
    const { tabs, space } = state;
    const one = tabs.length === 1;
    const tabButtons = tabs.map((id) => `<button type="button" role="tab" class="setup-tab" id="setup-tab-${id}" data-tab="${id}" aria-controls="setup-content-${id}" aria-selected="false" tabindex="-1"><span class="setup-tab-label">${esc(tabLabel(id))}</span><span class="setup-tab-dot" aria-hidden="true" hidden></span><span class="visually-hidden setup-tab-unsaved"></span></button>`).join('');
    const contents = tabs.map((id) => `<div role="tabpanel" class="setup-tab-content" id="setup-content-${id}" data-tab="${id}" aria-labelledby="setup-tab-${id}" tabindex="-1" hidden><p class="hint setup-cue" data-cue="${id}">${esc(saveCue(id))}</p>${TAB_HTML[id]()}${id === budgetTabOf(tabs) && !space.isLobby ? budgetSectionHtml() : ''}${id === 'details' && !space.isLobby ? dangerSectionHtml() : ''}</div>`).join('');
    el.innerHTML = `
      <div class="setup-head">
        <h2 id="space-setup-title">${esc(one ? tabLabel(tabs[0]) : configLabel())}</h2>
        <p class="setup-which" id="space-setup-which"></p>
        <div class="setup-tabs setup-tabs-fit" id="setup-tabs" role="tablist" aria-label="${esc(configLabel())}"${one ? ' hidden' : ''}>${tabButtons}<button type="button" class="core-link layout-tabs-more" id="setup-tabs-more" data-tip="More tabs" aria-label="More tabs" aria-haspopup="menu" aria-expanded="false" hidden><i class="fa-solid fa-ellipsis-vertical fa-fw" aria-hidden="true"></i></button></div>
      </div>
      <div class="setup-body">${contents}</div>
      <p class="setup-status status" id="space-setup-status" role="status" aria-live="polite"></p>`;
    el.querySelector('.setup-body').classList.add('action-content');
    state.bar = actionBar({
      label: 'Save the set up',
      doc,
      ids: { save: 'setup-save', cancel: 'setup-cancel-button' },
      discardWords: 'Discard your changes?',
      dirty: isDirty,
      onSave: () => done(),
      onCancel: () => close(),
    });
    el.appendChild(state.bar.el);
    el.querySelector('#space-setup-which').textContent = space.name;
    fillFields();
    wire();
  }

  // The Fixed Workspaces' switches (fixedRows), each under its module's section on the Modules tab: in the module's own card
  // when it has settings for this space, else in a section of its own named after it. A switch is a draft, saved with Save
  // through the module's own settings route for its scope (what Manage writes); `state.fixedDraft` holds what was changed.
  // Drawn again whenever either part arrives (the layouts list, the module settings); the labels come from module
  // manifests and are set with textContent.
  function paintFixed() {
    if (!state) return;
    const holder = q('#setup-fixed-modules');
    if (!holder) return;
    for (const old of el.querySelectorAll('[data-fixed-block]')) old.remove();
    const rows = fixedRows(state.layouts.system, word);
    state.fixedRows = rows;
    const byModule = new Map();
    for (const r of rows) { if (!byModule.has(r.module)) byModule.set(r.module, []); byModule.get(r.module).push(r); }
    for (const [moduleId, list] of byModule) {
      const block = doc.createElement('div');
      block.className = 'setup-fixed-block';
      block.dataset.fixedBlock = moduleId;
      const card = state.moduleSettings && state.moduleSettings.sectionOf(moduleId);
      const icon = ((state.options.modules || []).find((m) => m.id === moduleId) || {}).icon || '';
      if (!card) {
        block.classList.add('module-settings-card', 'module-settings-draft');
        const head = doc.createElement('h4');
        head.className = 'module-settings-name';
        if (/^[a-z0-9-]{1,40}$/.test(icon)) {
          const i = doc.createElement('i');
          i.className = `fa-solid fa-${icon} fa-fw`;
          i.setAttribute('aria-hidden', 'true');
          head.append(i, doc.createTextNode(' '));
        }
        head.append(doc.createTextNode(list[0].moduleName));
        block.appendChild(head);
      }
      for (const r of list) {
        const sub = doc.createElement('p');
        sub.className = 'setup-subheading';
        sub.textContent = r.where.length ? `In the ${r.where.join(' and ')} ${r.where.length > 1 ? 'tabs' : 'tab'}` : '';
        const box = doc.createElement('div');
        box.className = 'switch-list';
        box.innerHTML = switchListHtml([{ id: r.id, icon, name: ' ', note: r.note ? ' ' : '', on: r.id in state.fixedDraft ? state.fixedDraft[r.id] : r.on, disabled: r.disabled }], 'fixed');
        const input = box.querySelector('input.sdk-switch');
        input.dataset.fixed = r.id;
        const row = input.closest('label');
        row.querySelector('.sdk-choice-label').textContent = r.label;
        const desc = row.querySelector('.sdk-choice-desc');
        if (desc) desc.textContent = r.note;
        input.addEventListener('change', () => {
          if (input.checked === r.on) delete state.fixedDraft[r.id]; else state.fixedDraft[r.id] = input.checked;
          refresh();
        });
        wireSwitchList(box);
        if (sub.textContent) block.appendChild(sub);
        block.appendChild(box);
      }
      (card ? (card.querySelector('.module-settings-fields') || card) : holder).appendChild(block);
    }
    const section = q('[data-section="module-settings"]');
    if (section && rows.length) section.hidden = false;
  }
  // The Fixed Workspace switches changed and not yet saved: [{ id, row, on }].
  const fixedChanges = () => (state && state.fixedRows ? state.fixedRows.filter((r) => r.id in state.fixedDraft && state.fixedDraft[r.id] !== r.on).map((r) => ({ id: r.id, row: r, on: state.fixedDraft[r.id] })) : []);

  // The tabs that fit show; the rest go into the "..." after them (tabOverflow: the first tab and the one shown never
  // leave). The "..." lists the hidden ones on the shared menu, a check on none of them (the one shown is always in the row).
  function fitTabs() {
    if (!state) return;
    const strip = q('#setup-tabs');
    const more = q('#setup-tabs-more');
    if (!strip || !more) return;
    const list = [...strip.querySelectorAll(':scope > .setup-tab')];
    for (const t of list) t.classList.remove('layout-tab-out');
    more.hidden = true;
    if (strip.hidden || !strip.getClientRects().length) return;
    const view = doc.defaultView || window;
    const css = view.getComputedStyle(strip);
    const gap = parseFloat(css.columnGap) || 0;
    const avail = strip.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
    more.hidden = false;
    const moreWidth = more.getBoundingClientRect().width;
    more.hidden = true;
    const { out, more: showMore } = tabOverflow({ avail: Math.floor(avail) - 1, gap, widths: list.map((t) => t.getBoundingClientRect().width), more: moreWidth, current: list.findIndex((t) => t.dataset.tab === state.tab) });
    const focused = doc.activeElement && strip.contains(doc.activeElement) ? doc.activeElement : null;
    list.forEach((t, i) => t.classList.toggle('layout-tab-out', out.includes(i)));
    more.hidden = !showMore;
    if (focused && focused.classList.contains('layout-tab-out')) more.focus();
  }
  function openMoreTabs() {
    const more = q('#setup-tabs-more');
    const hidden = [...el.querySelectorAll('#setup-tabs > .setup-tab.layout-tab-out')];
    const dirty = dirtyNow();
    openHostMenu(more, hidden.map((t) => ({
      label: tabLabel(t.dataset.tab),
      radio: true,
      checked: t.dataset.tab === state.tab,
      ...(dirty.has(t.dataset.tab) ? { tag: 'Unsaved' } : {}),
      onPick: () => select(t.dataset.tab, { focus: true }),
    })));
  }

  const q = (sel) => el.querySelector(sel);
  const say = (words) => { const s = q('#space-setup-status'); if (s) { s.textContent = ''; s.textContent = words; } };
  const sayIn = (sel, words) => { const s = q(sel); if (s) { s.textContent = ''; s.textContent = words; } };

  // --- the tabs ---
  function select(id, { focus = false } = {}) {
    if (!state || !state.tabs.includes(id)) return;
    state.tab = id;
    for (const b of el.querySelectorAll('.setup-tab')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    fitTabs(); // the tab shown never stays in the "..."
    if (focus) q(`#setup-tab-${id}`)?.focus();
    for (const p of el.querySelectorAll('.setup-tab-content')) p.hidden = p.dataset.tab !== id;
    hideDeleteConfirm();
    if (typeof state.opts.onTab === 'function') state.opts.onTab(id);
  }

  // The dots: a tab with unsaved changes, said to a screen reader too.
  function paintDots() {
    if (!state) return;
    const dirty = dirtyNow();
    for (const b of el.querySelectorAll('.setup-tab')) {
      const on = dirty.has(b.dataset.tab);
      b.querySelector('.setup-tab-dot').hidden = !on;
      b.querySelector('.setup-tab-unsaved').textContent = on ? ', unsaved changes' : '';
      b.classList.toggle('dirty', on);
    }
  }
  function refresh() {
    if (!state) return;
    state.bar.refresh();
    paintDots();
  }

  // The Template choice (owners and the admin): "Same as the <environment>", then each template offered. Hidden until the
  // choices are in, on the Lobby, and while the switch in Manage is off.
  function paintTemplate() {
    const section = q('[data-section="template"]');
    if (!section || !state) return;
    const show = state.owner && Boolean(state.templates) && state.spaceTemplates === true;
    section.hidden = !show;
    if (!show) return;
    const options = fillSelect(q('#setup-template'), state.templates, state.draft.template, word);
    const about = q('#setup-template-about');
    about.textContent = (options.find((o) => o.value === q('#setup-template').value) || {}).description || '';
    about.hidden = !about.textContent;
  }
  // A moderator reads the template and does not choose it (decision 2): a line on the Modules tab, named when the server says the name.
  function paintTemplateSeen(record, on) {
    const section = q('[data-section="template-seen"]');
    if (!section) return;
    const id = record && typeof record.template === 'string' ? record.template : '';
    const name = (record && record.templateName) || id;
    section.hidden = !on;
    q('#setup-template-seen').textContent = id ? `This ${spaceWord()} reads the ${name} template.` : `This ${spaceWord()} reads the ${word('environment')}'s template.`;
  }

  // --- filling the fields from the draft ---
  function fillFields() {
    const { draft, opts } = state;
    const set = (sel, v) => { const f = q(sel); if (f && f.value !== v) f.value = v; };
    set('#setup-name', draft.name);
    set('#setup-description', draft.description);
    paintTemplate();
    set('#setup-profile', draft.profile);
    set('#setup-link', draft.link);
    const cal = q('#setup-publish-calendar');
    if (cal) cal.checked = draft.publishCalendar;
    paintEntry();
    const ask = q('#setup-request-access');
    if (ask) ask.checked = draft.requestAccess;
    const seeHidden = q('#setup-guests-see-hidden');
    if (seeHidden) seeHidden.checked = draft.guestsSeeHidden;
    paintPicture();
    paintIcons();
    paintMembers();
    paintGuestLink();
    if (q('#setup-first-visit')) paintLayouts();
    if (q('#setup-opens-with')) paintOpensWith();
    const ai = q('#setup-ai-off');
    if (ai) ai.checked = draft.aiOff;
    paintAiSees();
    paintBudgetSection();
    paintBudget();
    paintCall();
    paintPhases();
    if (q('#setup-phase-list') && !state.phaseStatesAsked) { state.phaseStatesAsked = true; loadPhaseStates(); }
    if (opts.nameInput && state.owner) opts.nameInput.value = draft.name;
  }

  // What AI may see (ai-sees.js): the space's own, or, with the switch on, the environment's choice shown and not changeable.
  function wireAiSees() {
    const box = q('#setup-ai-sees-box');
    if (!box) return;
    state.sees = mountSees(box, { word, idPrefix: 'setup-ai-sees', onChange: (v) => { state.draft.aiSees = v; refresh(); } });
    q('#setup-ai-sees-follow').addEventListener('change', (event) => {
      state.draft.aiSees = event.target.checked ? null : fullSees(state.envSees);
      paintAiSees();
      refresh();
    });
  }
  function paintAiSees() {
    if (!state.sees) return;
    const follow = state.draft.aiSees === null || state.draft.aiSees === undefined;
    q('#setup-ai-sees-follow').checked = follow;
    state.sees.setModules((state.installed || []).filter((m) => m.enabled && Array.isArray(m.scope) && m.scope.includes('space')));
    state.sees.set(follow ? state.envSees : state.draft.aiSees, { locked: follow, lookupOff: state.envSees && state.envSees.lookup === false ? `Off for the whole ${word('environment')}.` : '' });
  }

  function paintPicture() {
    const img = q('#setup-picture-img');
    if (!img) return;
    const { space, image } = state;
    let src = '';
    if (image.file) src = image.url;
    else if (!image.remove && space.hasImage) src = `/img/space/${encodeURIComponent(space.id)}?v=${space.imageVersion || 0}`;
    img.hidden = !src;
    if (src) img.src = src;
    q('#setup-picture-none').hidden = Boolean(src);
    q('#setup-picture-remove').hidden = !src;
  }

  // Whether the Budget section shows, and its hint naming the module that reads it (budgetWanted). Once shown it stays
  // for this opening, so a field someone is typing in never goes away under them.
  function budgetNow() {
    return budgetWanted({ lobby: state.space.isLobby, installed: state.installed || (state.options && state.options.budgetModules) || [], reported: state.opts.budget || null, stored: state.before.budget });
  }
  function paintBudgetSection() {
    const section = q('[data-section="budget"]');
    if (!section) return;
    const { show, name } = budgetNow();
    if (show && state.ownerPartsIn) section.hidden = false;
    const hint = q('#setup-budget-hint');
    if (hint) hint.textContent = `What you plan to spend.${name ? ` ${name} shows what is spent against it.` : ''} Leave it empty for no budget.${name ? ` The currency is also used for costs in ${name}.` : ''}`;
  }
  // The budget's amount and currency (the page's currency list, window.hostCurrency from /sdk/host.js: the common ones
  // first, then every other the server takes; the first choice "" is the reporting module's own currency). A bad entry
  // in the field is left as it is (the browser holds it; the draft says `bad`).
  function paintBudget() {
    const amount = q('#setup-budget-amount');
    const currency = q('#setup-budget-currency');
    if (!amount || !currency) return;
    const b = state.draft.budget || budgetText(null);
    if (!state.draft.budget?.bad && amount.value !== b.amount) amount.value = b.amount;
    const empty = 'Default currency';
    const fill = doc.defaultView && doc.defaultView.hostCurrency ? doc.defaultView.hostCurrency.fill : null;
    if (fill) fill(currency, { value: b.currency, empty, currencies: state.currencies || undefined });
    else if (!currency.options.length) currency.innerHTML = `<option value="">${esc(empty)}</option>${b.currency ? `<option value="${esc(b.currency)}">${esc(b.currency)}</option>` : ''}`;
    currency.value = b.currency;
  }

  // The link icon: a radio group of icon buttons (the page's .icon-grid), one tab stop, the arrows move the choice.
  function paintIcons() {
    const grid = q('#setup-link-icon');
    if (!grid) return;
    const icons = deps.icons();
    const picked = icons.some((i) => i.id === state.draft.linkIcon) ? state.draft.linkIcon : (icons[0] && icons[0].id);
    grid.innerHTML = icons.map(({ id, classes, label }) => `<button type="button" role="radio" data-icon="${esc(id)}" data-tip="${esc(label || id)}" aria-label="${esc(label || id)}" aria-checked="${id === picked}" tabindex="${id === picked ? 0 : -1}"${id === picked ? ' class="selected"' : ''}><i class="${esc(classes)} fa-fw" aria-hidden="true"></i></button>`).join('');
  }
  function pickIcon(id, { focus = false } = {}) {
    state.draft.linkIcon = id;
    for (const b of el.querySelectorAll('#setup-link-icon [data-icon]')) {
      const on = b.dataset.icon === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('selected', on);
      if (on && focus) b.focus();
    }
    refresh();
  }

  // The members: a switch for each account, its picture and name; on while it is in the draft.
  function paintMembers() {
    const list = q('#setup-members');
    if (!list) return;
    const chosen = new Set(state.draft.members);
    if (!state.users) { list.innerHTML = '<p class="hint">Loading…</p>'; return; }
    list.innerHTML = state.users.map((u) => `<label class="sdk-choice-row setup-member"><img class="setup-member-face" alt="" src="/img/${encodeURIComponent(u.key)}/profile"><span class="sdk-choice-text"><span class="sdk-choice-label">${esc(u.displayName || u.key)}${u.agent === true ? ' (agent)' : ''}</span></span><input type="checkbox" class="sdk-switch" role="switch" data-member="${esc(u.key)}"${chosen.has(u.key) ? ' checked' : ''}></label>`).join('');
    wireSwitchList(list);
  }

  // The four switches of Who can enter from the draft (entrySwitches). Closed for set up dims the other three, which keep
  // their values; Visiting guests is dimmed too while the host's guest sign-in is off, with one line saying so.
  function paintEntry() {
    const sw = entrySwitches(state.draft);
    const closed = !sw.open;
    const set = (sel, on, off) => { const f = q(sel); if (f) { f.checked = on; f.disabled = off; } };
    set('#setup-open', sw.open, false);
    set('#setup-entry-accounts', sw.accounts, closed);
    set('#setup-allow-guests', sw.invited, closed);
    set('#setup-entry-guests', sw.visiting, closed || state.door === false);
    const open = q('#setup-open-label');
    if (open) {
      // "Members of <this space's saved name>", as text (never markup); a long name is cut with an ellipsis, the whole in the title.
      const full = String((state.before && state.before.name) || state.space.name || '').trim() || spaceWord();
      const chars = [...full];
      open.textContent = `${membersWord(true)} of ${chars.length > 30 ? `${chars.slice(0, 29).join('')}…` : full}`;
      open.title = `${membersWord(true)} of ${full}`;
    }
    const name = q('#setup-environment-name');
    if (name) name.textContent = state.environmentName || word('environment');
    const note = q('#setup-closed-note');
    if (note) note.hidden = !closed;
    const door = q('#setup-door-note');
    if (door) door.hidden = state.door !== false;
  }
  // The guest link as the server has it (the same record the in-space guest link controls read: guestToken and
  // allowGuests). It follows the saved Allow guests, not the draft: turning guests on is saved with Save.
  function paintGuestLink() {
    const value = q('#setup-guest-link-value');
    if (!value) return;
    const { links, draft } = state;
    const token = links.guestToken || null;
    const allowed = links.allowGuests !== false;
    const origin = doc.defaultView ? doc.defaultView.location.origin : '';
    value.textContent = token ? `${origin}/guest/${token}` : 'off';
    q('#setup-guest-link-on').hidden = !allowed || Boolean(token);
    q('#setup-guest-link-copy').hidden = !token;
    q('#setup-guest-link-new').hidden = !allowed || !token;
    q('#setup-guest-link-off').hidden = !token;
    const note = q('#setup-guest-link-note');
    const guestLink = `${word('guest')} link`;
    note.textContent = !allowed
      ? (draft.allowGuests ? `Press Save to turn on the ${guestLink}, then make the link.` : `The ${guestLink} is off, so the link can't be made.`)
      : (!draft.allowGuests && token ? `Saving with the ${guestLink} off turns this link off too.` : '');
    note.hidden = !note.textContent;
  }

  // Opens with, as space-settings draws it: what can open now (the chat, the modules on here), then any saved id that
  // cannot open now, kept and said why. The conference is not a switch here: the call follows joining (GitHub #199), so
  // a `conference` id a list still holds is kept in the stored list and not drawn.
  function choices() {
    const o = state.options;
    const shown = (id, name, icon) => ({ id, name, icon, ...(o.builtin.find((b) => b.id === id) || {}) });
    return [
      shown('chat', 'Chat', 'message'),
      ...o.modules.map((m) => ({ id: m.id, name: m.name, icon: m.icon })),
    ];
  }
  // What the template opens a new person with, as a sentence: read only (the template's Default Workspace decides): its
  // layout's shape and the modules in it, in plain words (opens-with.js, layoutLine).
  function paintOpensWith() {
    const all = choices();
    q('#setup-opens-with').textContent = layoutLine({
      layout: state.options.layout,
      space: spaceWord(),
      modules: state.options.modules.map((m) => m.id),
      canOpen: (id) => all.some((c) => c.id === id),
      nameOf: (id) => all.find((c) => c.id === id)?.name || id,
      groupOf: (id) => (all.some((c) => c.id === groupOf(id)) ? groupOf(id) : id),
    });
  }
  // The layouts that can be what opens first: the fixed ones the server lists for this space (Layouts section), then the shared
  // layouts by name, each with its icon. `fixed` and `shared` are the two parts; the radios of both are one group.
  const iconOk = (icon) => /^[a-z0-9-]{1,40}$/.test(icon || '');
  const fixedAvailable = () => layoutRows(state.draft.tabs, state.layouts.system);
  function layoutChoices() {
    const { shared } = state.layouts;
    return [
      ...fixedAvailable().filter((r) => r.id !== 'workspace').map((r) => ({ id: r.id, name: r.name, icon: iconOk(r.icon) ? r.icon : 'object-group' })),
      ...shared.map((l) => ({ id: l.id, name: l.name, icon: iconOk(l.icon) && l.icon !== 'object-group' ? l.icon : 'user-group' })),
    ];
  }
  const radioChecks = () => {
    const { draft, layouts } = state;
    const choices = [{ id: 'workspace' }, ...layoutChoices()];
    const picked = choices.some((c) => c.id === draft.defaultLayout) ? draft.defaultLayout : 'workspace';
    for (const r of el.querySelectorAll('input[name="setup-first-visit"]')) {
      r.checked = r.value === picked;
      const hid = LAYOUT_IDS.includes(r.value) && r.value !== 'workspace' && tabsWhole(draft.tabs).hide.includes(r.value);
      r.disabled = !layouts.canSetDefault || hid;
    }
  };
  // The Layouts section's rows, from the draft: written fresh on each change, the keyboard put back where it was.
  function paintLayoutRows(focus = null) {
    const list = q('#setup-layout-rows');
    if (!list) return;
    const rows = fixedAvailable();
    const can = state.layouts.canSetDefault;
    list.innerHTML = rows.map((r, i) => {
      const name = escapeHtml(r.name);
      return `<li class="setup-layout-row" data-layout="${escapeHtml(r.id)}">
        <div class="setup-layout-head"><i class="fa-solid fa-${iconOk(r.icon) ? escapeHtml(r.icon) : 'object-group'} fa-fw" aria-hidden="true"${r.id === 'workspace' ? ' id="setup-workspace-icon"' : ''}></i><span class="setup-layout-name"${r.id === 'workspace' ? ' id="setup-workspace-name"' : ''}>${name}</span>${r.shown && !r.locked ? '<i class="fa-solid fa-thumbtack setup-layout-pinned" data-pinned title="Pinned: kept in the bar for everyone" aria-hidden="true"></i>' : ''}
          <span class="setup-layout-move"><button type="button" class="btn btn-small" data-move="up" aria-label="Move ${name} up"${i === 0 || !can ? ' disabled' : ''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Move up</button><button type="button" class="btn btn-small" data-move="down" aria-label="Move ${name} down"${i === rows.length - 1 || !can ? ' disabled' : ''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Move down</button></span></div>
        <div class="setup-layout-controls">
          <label class="sdk-choice-row setup-layout-show"><span class="sdk-choice-text"><span class="sdk-choice-label">Show in the bar</span>${r.locked ? '<span class="sdk-choice-desc">The Workspace is always shown.</span>' : r.shown ? '<span class="sdk-choice-desc">Pinned: kept in the bar for everyone.</span>' : ''}</span><input type="checkbox" class="sdk-switch" role="switch" data-layout-show="${escapeHtml(r.id)}" aria-label="Show ${name} in the bar"${r.shown ? ' checked' : ''}${r.locked || !can ? ' disabled' : ''}></label>
          <label class="setup-choice setup-layout-first"><input type="radio" name="setup-first-visit" value="${escapeHtml(r.id)}"${r.id === 'workspace' ? ' id="setup-first-workspace"' : ''} aria-label="${name} opens first"><span class="setup-choice-name">Opens first</span></label>
        </div></li>`;
    }).join('');
    radioChecks();
    if (focus) {
      const row = list.querySelector(`[data-layout="${CSS.escape(focus.id)}"]`);
      const mine = row && row.querySelector(`[data-move="${focus.move}"]:not(:disabled)`);
      const other = row && row.querySelector('[data-move]:not(:disabled)');
      (mine || other || row)?.focus();
    }
  }
  function paintLayouts() {
    const { layouts } = state;
    paintLayoutRows();
    const choices = layoutChoices().filter((c) => layouts.shared.some((l) => l.id === c.id));
    q('#setup-first-visit-layouts').innerHTML = choices.map((c) => `<label class="setup-choice"><input type="radio" name="setup-first-visit" value="${escapeHtml(c.id)}"><i class="fa-solid fa-${escapeHtml(c.icon)} fa-fw" aria-hidden="true"></i><span class="setup-choice-name">${escapeHtml(c.name)}</span></label>`).join('');
    radioChecks();
    const note = q('#setup-layout-note');
    // A layout for everyone is made with the layout picker, New layout for everyone in the menu on the Workspace's tab (plan-layout-picker.md, step 6).
    note.textContent = layouts.shared.length ? '' : 'A shared layout can be picked too: make one with New layout for everyone, in the menu on the Workspace tab.';
    note.hidden = !note.textContent;
    paintLayoutLine();
  }
  // One of the Layouts section's controls changed or was pressed: the draft follows, the rows are drawn again.
  function layoutsEvent(event) {
    if (!state) return;
    const t = event.target;
    const live = q('#setup-layouts-live');
    const available = fixedAvailable().map((r) => r.id);
    if (event.type === 'click') {
      const b = t.closest ? t.closest('[data-move]') : null;
      if (!b || b.disabled) return;
      const id = b.closest('[data-layout]').dataset.layout;
      const name = (fixedAvailable().find((r) => r.id === id) || {}).name || id;
      state.draft = withLayoutMoved(state.draft, id, b.dataset.move === 'up' ? -1 : 1, available);
      paintLayoutRows({ id, move: b.dataset.move });
      if (live) live.textContent = movedWords(state.draft, id, name, available);
      return;
    }
    if (t.dataset && t.dataset.layoutShow) {
      state.draft = withLayoutShown(state.draft, t.dataset.layoutShow, t.checked);
      paintLayouts();
      return;
    }
    if (t.name === 'setup-first-visit' && t.checked) {
      state.draft = withOpensFirst(state.draft, t.value);
      paintLayoutLine();
    }
  }
  // While the first visit is a layout (a shared one, Calendar or Map), the line above the choices names it, with Stop
  // using it (the old page's, now a draft: the Workspace is picked, the Opens with switches stay as they are).
  function paintLayoutLine() {
    const box = q('#setup-opens-with-layout');
    if (!box) return;
    const id = layoutOrNull(state.draft.defaultLayout);
    const known = id ? layoutChoices().find((c) => c.id === id) : null;
    box.hidden = !id;
    q('#setup-opens-with-layout-text').textContent = id ? (known ? `Opens with the layout ${known.name}` : 'Opens with a saved layout') : '';
  }
  function stopUsingLayout() {
    state.draft.defaultLayout = null;
    paintLayouts();
    const workspace = q('#setup-first-workspace');
    if (workspace && !workspace.disabled) workspace.focus();
    refresh();
  }

  // --- the phases: the sheet's rows, inline, as a draft (phasesTabHtml) ---
  const fmtDay = (d) => dayWords(d, { today: state.today });
  const phaseTimeline = () => state.rule.timelineOf(state.phaseList, state.draft.phases, { today: state.today, created: state.space.createdAt });
  const phaseRow = (id) => [...el.querySelectorAll('#setup-phase-list .phase-row')].find((li) => li.dataset.id === id) || null;
  const daysWord = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  function paintPhases() {
    const list = q('#setup-phase-list');
    if (!list || !state.rule) return;
    const R = state.rule;
    const bands = phaseTimeline();
    const rows = rowsOf(bands, { rule: R });
    q('#setup-phases-now').textContent = state.today ? `Today, ${fmtDay(state.today)}: ${R.chipWords(bands, state.today)}` : R.chipWords(bands, state.today);
    for (const r of rows) {
      const row = phaseRow(r.id);
      if (!row) continue;
      row.classList.toggle('off', !r.dated);
      row.classList.toggle('current', r.current);
      row.classList.toggle('main', r.main);
      row.querySelector('[data-phase-tag="now"]').hidden = !r.current;
      row.querySelector('[data-phase-tag="main"]').hidden = !r.main;
      const start = row.querySelector('input[data-edge="start"]');
      const end = row.querySelector('input[data-edge="end"]');
      start.value = r.start || '';
      end.value = r.end || '';
      start.disabled = !r.dated;
      end.disabled = !r.endEditable;
      if (r.minStart) start.min = r.minStart; else start.removeAttribute('min');
      if (r.maxStart) start.max = r.maxStart; else start.removeAttribute('max');
      if (r.minEnd) end.min = r.minEnd; else end.removeAttribute('min');
      row.querySelector('.phase-row-days').textContent = !r.dated ? '' : r.days !== null ? daysWord(r.days) : 'no end yet';
      row.querySelector('.phase-row-tools').hidden = !r.canSkip;
      row.querySelector('.phase-row-off').hidden = r.dated;
    }
    const nothing = !Object.keys(R.cleanDates(state.draft.phases)).length;
    const first = q('#setup-phase-first');
    first.hidden = !nothing;
    const firstDay = q('#setup-phase-first-day');
    if (nothing && !firstDay.value) firstDay.value = state.today || '';
  }
  // How the template measures its phases (plan-templates-redesign.md, step 6): by dates as before, or by goals or progress, where
  // each phase shows what the server counts (GET /api/spaces/:id/phases) and a Done switch for a phase no goal names. The switch
  // acts at once, as the server holds it (PUT .../done), for an owner and a moderator.
  async function loadPhaseStates() {
    const mine = state;
    try {
      const answer = await api('GET', `/api/spaces/${encodeURIComponent(mine.space.id)}/phases`);
      if (state !== mine) return;
      mine.phaseStates = answer;
      paintDone();
    } catch { /* the dates are still there */ }
  }
  function paintDone() {
    const note = q('#setup-phases-measure');
    const got = state && state.phaseStates;
    if (!note || !got) return;
    const goals = got.measure === 'goals';
    note.hidden = got.measure !== 'goals' && got.measure !== 'progress';
    const cue = q('[data-cue="phases"]');
    if (cue) cue.textContent = saveCue('phases', { done: !note.hidden });
    note.textContent = goals ? 'These phases are measured by goals: a phase is done when every goal that names it is done. One no goal names has a Done switch.' : 'These phases are measured by progress: switch a phase to Done when it is done.';
    for (const p of got.phases || []) {
      const box = q(`.phase-row-done[data-done-for="${CSS.escape(p.id)}"]`);
      if (!box) continue;
      box.hidden = note.hidden;
      if (note.hidden) continue;
      const counted = p.goals && p.goals.total > 0;
      box.innerHTML = counted
        ? `<span class="phase-row-count">${p.goals.done} of ${p.goals.total} ${p.goals.total === 1 ? 'goal' : 'goals'} done</span>${p.done ? ' <span class="sdk-chip-tag" data-tone="ok">Done</span>' : ''}`
        : `<label class="sdk-choice-row phase-row-switch"><span class="sdk-choice-text">Done</span><input type="checkbox" class="sdk-switch" role="switch" data-phase-done="${esc(p.id)}" aria-label="${esc(p.label)} is done"${p.done ? ' checked' : ''}></label>`;
      box.closest('.phase-row').classList.toggle('done', p.done === true);
    }
  }
  el.addEventListener('change', async (event) => {
    const box = event.target.closest && event.target.closest('[data-phase-done]');
    if (!box || !state) return;
    box.disabled = true;
    try {
      const answer = await api('PUT', `/api/spaces/${encodeURIComponent(state.space.id)}/phases/${encodeURIComponent(box.dataset.phaseDone)}/done`, { done: box.checked });
      state.phaseStates = answer;
      paintDone();
      sayIn('#setup-phases-status', box.checked ? 'Marked done.' : 'Marked not done.');
      if (typeof state.opts.onPhaseStates === 'function') state.opts.onPhaseStates(answer);
    } catch (err) {
      box.checked = !box.checked;
      box.disabled = false;
      sayIn('#setup-phases-status', err.message);
    }
  });
  // A refusal's sentence by its row (and read out); an edit kept clears every row's.
  function phaseProblem(id, words) {
    for (const row of el.querySelectorAll('#setup-phase-list .phase-row')) {
      const mine = row.dataset.id === id ? words || '' : '';
      const p = row.querySelector('.phase-row-problem');
      p.textContent = mine;
      p.hidden = !mine;
      row.classList.toggle('has-problem', Boolean(mine));
      for (const d of row.querySelectorAll('.phase-date')) { if (mine) d.setAttribute('aria-invalid', 'true'); else d.removeAttribute('aria-invalid'); }
    }
  }
  function phaseAnswer(id, answer, said) {
    if (!answer.ok) {
      const words = plainDays(answer.problem, fmtDay);
      phaseProblem(id, words);
      sayIn('#setup-phases-status', words);
      paintPhases(); // the input snaps back
      return false;
    }
    state.draft.phases = answer.dates;
    phaseProblem(id, '');
    paintPhases();
    sayIn('#setup-phases-status', said(phaseTimeline()));
    refresh();
    return true;
  }
  const labelOf = (id) => (state.phaseList.find((p) => p.id === id) || { label: id }).label;
  function phaseSet(id, edge, day) {
    const created = state.space.createdAt;
    return phaseAnswer(id, state.rule.setPhaseDate(state.phaseList, state.draft.phases, id, edge, day, { created }), (bands) => {
      const me = bands.find((b) => b.id === id);
      if (edge === 'end' && !me.end) return `${me.label} has no end now.`;
      if (edge === 'end' && !bands.some((b, k) => k > bands.indexOf(me) && b.dated)) return `${me.label} runs ${fmtDay(me.start)} to ${fmtDay(me.end)}.`;
      return `${me.label} ${edge === 'end' ? 'ends' : 'starts'} ${fmtDay(edge === 'end' ? me.end : me.start)}.`;
    });
  }
  function phaseSkip(id) {
    const ok = phaseAnswer(id, state.rule.skipPhase(state.phaseList, state.draft.phases, id, { created: state.space.createdAt }), () => `${labelOf(id)} is skipped.`);
    if (ok) phaseRow(id)?.querySelector('.phase-add')?.focus();
  }
  function phaseAdd(id) {
    const ok = phaseAnswer(id, state.rule.addDatesFor(state.phaseList, state.draft.phases, id, { created: state.space.createdAt, today: state.today }), (bands) => {
      const me = bands.find((b) => b.id === id);
      return `${me.label} ${me.end ? `is ${fmtDay(me.start)} to ${fmtDay(me.end)}` : `starts ${fmtDay(me.start)}`}.`;
    });
    if (ok) phaseRow(id)?.querySelector('input[data-edge="start"]')?.focus();
  }
  // A date input keeps its edit when its value is a whole day that differs from the row's (Chromium fires change on
  // every keystroke in the year: those wait for the fourth digit, Enter or leaving), as the sheet's do.
  function wirePhaseInput(input) {
    const current = () => {
      const me = phaseTimeline().find((b) => b.id === input.dataset.id);
      return me && me.dated ? (input.dataset.edge === 'end' ? me.end || '' : me.start) : '';
    };
    const tryKeep = ({ typing = false } = {}) => {
      const v = input.value;
      if (!state.rule.isDay(v)) {
        // An emptied end gives the end up (open-ended again), on leaving or Enter only, as the sheet does.
        if (!typing && v === '' && input.dataset.edge === 'end' && current() !== '') phaseSet(input.dataset.id, 'end', '');
        else if (!typing) paintPhases();
        return;
      }
      if (typing && Number(v.slice(0, 4)) < 1000) return;
      if (v === current()) return;
      phaseSet(input.dataset.id, input.dataset.edge, v);
    };
    input.addEventListener('change', () => tryKeep({ typing: true }));
    input.addEventListener('blur', () => tryKeep());
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); tryKeep(); } });
  }
  function phaseStartFirst() {
    const day = q('#setup-phase-first-day').value;
    if (!state.phaseList.length || !state.rule.isDay(day)) { sayIn('#setup-phases-status', 'Pick a day to start on.'); return; }
    if (phaseSet(state.phaseList[0].id, 'start', day)) phaseRow(state.phaseList[0].id)?.querySelector('input[data-edge="end"]')?.focus();
  }

  // --- Delete: its own question inside the panel, at once, not part of the draft ---
  function showDeleteConfirm() {
    const box = q('#setup-delete-confirm');
    if (!box) return;
    q('#setup-delete-words').textContent = `Delete ${state.space.name}? Its ${membersWord()} stay in the Lobby.`;
    sayIn('#setup-delete-problem', '');
    box.hidden = false;
    q('#setup-delete').setAttribute('aria-expanded', 'true');
    q('#setup-delete-keep').focus();
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
  }
  function hideDeleteConfirm({ focus = false } = {}) {
    const box = q('#setup-delete-confirm');
    if (!box || box.hidden) return false;
    box.hidden = true;
    q('#setup-delete').setAttribute('aria-expanded', 'false');
    if (focus) q('#setup-delete').focus();
    return true;
  }
  async function deleteSpace() {
    if (!state || state.saving) return;
    const { space, opts } = state;
    state.saving = true;
    el.classList.add('saving');
    try {
      await api('DELETE', `/api/spaces/${encodeURIComponent(space.id)}`);
    } catch (err) {
      sayIn('#setup-delete-problem', err.message || 'It was not deleted.');
      state.saving = false;
      el.classList.remove('saving');
      return;
    }
    const onDeleted = opts.onDeleted;
    close();
    if (typeof onDeleted === 'function') onDeleted(space);
  }

  // --- the invite and the guest link: actions, at once ---
  async function linkAction(run, okWords) {
    try {
      await run();
      if (okWords) sayIn('#setup-links-status', okWords);
      if (typeof state?.opts.onLinks === 'function') state.opts.onLinks(state.space);
    } catch (err) {
      sayIn('#setup-links-status', err.message || 'That did not work.');
    }
  }
  async function copyText(value) {
    try {
      await doc.defaultView.navigator.clipboard.writeText(value);
      sayIn('#setup-links-status', 'Copied.');
    } catch {
      doc.defaultView.prompt('Copy this:', value);
    }
  }
  async function setGuestLink(body) {
    const id = encodeURIComponent(state.space.id);
    await linkAction(async () => {
      const answer = body === null ? await api('DELETE', `/api/spaces/${id}/guest-link`) : await api('POST', `/api/spaces/${id}/guest-link`, body);
      if (state && answer && answer.space) {
        state.links = { guestToken: answer.space.guestToken || null, allowGuests: answer.space.allowGuests !== false };
        paintGuestLink();
      }
    }, body === null ? 'The link is off.' : body.regenerate ? 'A new link; the old one no longer works.' : 'The link is on.');
  }

  function wire() {
    const tablist = q('#setup-tabs');
    tablist.addEventListener('click', (event) => {
      const b = event.target.closest('.setup-tab');
      if (b) select(b.dataset.tab, { focus: true });
    });
    q('#setup-tabs-more').addEventListener('click', openMoreTabs);
    if (typeof (doc.defaultView || window).ResizeObserver === 'function') {
      state.fitWatch = new (doc.defaultView || window).ResizeObserver(() => fitTabs());
      state.fitWatch.observe(tablist);
    }
    tablist.addEventListener('keydown', (event) => {
      const all = [...el.querySelectorAll('.setup-tab:not(.layout-tab-out)')];
      if (event.target.id === 'setup-tabs-more') {
        if (event.key === 'ArrowLeft' && all.length) { event.preventDefault(); all[all.length - 1].focus(); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); openMoreTabs(); }
        return;
      }
      const at = all.indexOf(event.target.closest('.setup-tab'));
      if (at < 0) return;
      const more = q('#setup-tabs-more');
      if (event.key === 'ArrowRight' && at === all.length - 1 && !more.hidden) { event.preventDefault(); more.focus(); return; }
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      const next = all[(to + all.length) % all.length];
      select(next.dataset.tab, { focus: true });
    });

    const field = (sel, key) => { const f = q(sel); if (f) f.addEventListener('input', () => { state.draft[key] = f.value; }); };
    const name = q('#setup-name');
    if (name) name.addEventListener('input', () => { state.draft.name = name.value; if (state.opts.nameInput) state.opts.nameInput.value = name.value; });
    field('#setup-description', 'description');
    field('#setup-link', 'link');
    const template = q('#setup-template');
    if (template) template.addEventListener('change', () => { state.draft.template = template.value; paintTemplate(); refresh(); });
    const profile = q('#setup-profile');
    if (profile) profile.addEventListener('change', () => { state.draft.profile = profile.value; });
    // A new object on each edit, so the draft never shares one with `before`.
    const budgetAmount = q('#setup-budget-amount');
    // A bad entry (`12-3`, `1e`) reads as '' with validity.badInput: kept as `bad`, never as an empty field (which clears).
    if (budgetAmount) budgetAmount.addEventListener('input', () => {
      const bad = Boolean(budgetAmount.validity && budgetAmount.validity.badInput);
      const { bad: _was, ...rest } = state.draft.budget || {};
      state.draft.budget = { ...rest, amount: budgetAmount.value.trim(), ...(bad ? { bad: true } : {}) };
    });
    const budgetCurrency = q('#setup-budget-currency');
    if (budgetCurrency) budgetCurrency.addEventListener('change', () => { state.draft.budget = { ...state.draft.budget, currency: budgetCurrency.value }; });
    const cal = q('#setup-publish-calendar');
    if (cal) cal.addEventListener('change', () => { state.draft.publishCalendar = cal.checked; });
    for (const [id, which] of [['#setup-open', 'open'], ['#setup-entry-accounts', 'accounts'], ['#setup-entry-guests', 'visiting']]) {
      const box = q(id);
      if (box) box.addEventListener('change', () => { Object.assign(state.draft, withEntrySwitch(state.draft, which, box.checked)); paintEntry(); });
    }
    const askBox = q('#setup-request-access');
    if (askBox) askBox.addEventListener('change', () => { state.draft.requestAccess = askBox.checked; });
    const guests = q('#setup-allow-guests');
    if (guests) guests.addEventListener('change', () => { state.draft.allowGuests = guests.checked; paintEntry(); paintGuestLink(); });
    const seeHidden = q('#setup-guests-see-hidden');
    if (seeHidden) seeHidden.addEventListener('change', () => { state.draft.guestsSeeHidden = seeHidden.checked; });
    const members = q('#setup-members');
    if (members) members.addEventListener('change', (event) => {
      if (event.target.type !== 'checkbox') return;
      state.draft.members = [...members.querySelectorAll('input:checked')].map((i) => i.dataset.member);
    });

    const grid = q('#setup-link-icon');
    if (grid) {
      grid.addEventListener('click', (event) => { const b = event.target.closest('[data-icon]'); if (b) pickIcon(b.dataset.icon); });
      grid.addEventListener('keydown', (event) => {
        const all = [...grid.querySelectorAll('[data-icon]')];
        const at = all.indexOf(event.target.closest('[data-icon]'));
        if (at < 0) return;
        const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
        if (to === undefined) return;
        event.preventDefault();
        pickIcon(all[(to + all.length) % all.length].dataset.icon, { focus: true });
      });
    }

    const file = q('#setup-picture-file');
    if (file) file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (state.image.url) URL.revokeObjectURL(state.image.url);
      state.image = { file: f, url: URL.createObjectURL(f), remove: false };
      paintPicture();
    });
    const remove = q('#setup-picture-remove');
    if (remove) remove.addEventListener('click', () => {
      if (state.image.url) URL.revokeObjectURL(state.image.url);
      state.image = { file: null, url: '', remove: true };
      paintPicture();
      q('.setup-picture-pick input').focus();
    });

    const del = q('#setup-delete');
    if (del) {
      del.addEventListener('click', () => (q('#setup-delete-confirm').hidden ? showDeleteConfirm() : hideDeleteConfirm({ focus: true })));
      q('#setup-delete-keep').addEventListener('click', () => hideDeleteConfirm({ focus: true }));
      q('#setup-delete-yes').addEventListener('click', () => deleteSpace());
    }

    const invite = q('#setup-make-invite');
    if (invite) {
      invite.addEventListener('click', () => linkAction(async () => {
        const { invite: made } = await api('POST', '/api/invites', { spaces: [state.space.id] });
        q('#setup-invite-link').textContent = made.url;
        q('#setup-invite-row').hidden = false;
      }, 'Invite link made.'));
      q('#setup-invite-copy').addEventListener('click', () => copyText(q('#setup-invite-link').textContent));
      q('#setup-guest-link-on').addEventListener('click', () => setGuestLink({}));
      q('#setup-guest-link-new').addEventListener('click', () => setGuestLink({ regenerate: true }));
      q('#setup-guest-link-off').addEventListener('click', () => setGuestLink(null));
      q('#setup-guest-link-copy').addEventListener('click', () => copyText(q('#setup-guest-link-value').textContent));
    }

    const phaseList = q('#setup-phase-list');
    if (phaseList) {
      phaseList.querySelectorAll('input.phase-date').forEach(wirePhaseInput);
      phaseList.addEventListener('click', (event) => {
        const skip = event.target.closest('.phase-skip');
        if (skip) { phaseSkip(skip.closest('.phase-row').dataset.id); return; }
        const add = event.target.closest('.phase-add');
        if (add) phaseAdd(add.closest('.phase-row').dataset.id);
      });
      q('#setup-phase-first-go').addEventListener('click', phaseStartFirst);
      q('#setup-phase-first-day').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); phaseStartFirst(); } });
    }
    const stop = q('#setup-opens-with-layout-stop');
    if (stop) stop.addEventListener('click', () => stopUsingLayout());
    const ai = q('#setup-ai-off');
    if (ai) ai.addEventListener('change', () => { state.draft.aiOff = ai.checked; });
    wireAiSees();
    wireCall();
    const content = q('#setup-content-layout');
    if (content) {
      content.addEventListener('change', layoutsEvent);
      content.addEventListener('click', layoutsEvent);
    }
  }
  // Any edit in the panel: Save and the dots follow what changed (once, here; the panel is drawn again on each open).
  el.addEventListener('input', () => refresh());
  el.addEventListener('change', () => refresh());
  el.addEventListener('click', () => refresh()); // Remove picture and the like
  // Escape: the Delete question first (Keep), else Cancel, which asks "Discard your changes?" when something changed.
  el.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !state) return;
    event.preventDefault();
    event.stopPropagation();
    if (hideDeleteConfirm({ focus: true })) return;
    state.bar.requestCancel();
  });

  // What would be sent now: the draft against what was, the name from the bar's input for an owner, and for a moderator
  // only the fields the server lets them send.
  function patchNow() {
    const { draft, before, opts } = state;
    const name = opts.nameInput && state.owner ? opts.nameInput.value : draft.name;
    const patch = setupPatch(before, { ...draft, name }, { phaseIds: state.phaseList.map((p) => p.id) });
    if (!state.owner) for (const k of Object.keys(patch)) if (!MODERATOR_FIELDS.includes(k)) delete patch[k];
    return patch;
  }
  const imageChanged = () => Boolean(state.image.file) || Boolean(state.image.remove && state.space.hasImage);
  // The modules whose settings were changed here: [{ id, name, values }] (module-settings.js, its draft mode).
  const moduleChanges = () => (state.moduleSettings ? state.moduleSettings.changes() : []);
  function dirtyNow() {
    return dirtyTabs({ ...patchNow(), ...callPatchNow() }, { image: imageChanged(), modules: moduleChanges().length > 0 || fixedChanges().length > 0, tabs: state.tabs });
  }
  // Whether something would be lost on Cancel: the PATCH has something in it, a picture was chosen or removed, or a
  // module's settings changed.
  function isDirty() {
    if (!state) return false;
    return Object.keys(patchNow()).length > 0 || Object.keys(callPatchNow()).length > 0 || imageChanged() || moduleChanges().length > 0 || fixedChanges().length > 0;
  }

  // What the panel draws comes from the server: the space's whole record and the accounts (an owner's tabs), the
  // published calendar's switch, Opens with's choices and the layouts. A field not touched while it was asked is set
  // from the answer.
  function takeServerSpace(record) {
    const fresh = beforeOf(record);
    for (const k of Object.keys(fresh)) {
      if (k === 'defaultLayout') continue; // loadOptions has this from the first visit's own answer
      if (sameValue(state.draft[k], state.before[k])) {
        state.draft[k] = Array.isArray(fresh[k]) ? [...fresh[k]] : k === 'tabs' ? tabsWhole(fresh[k]) : k === 'phases' ? datesCopy(fresh[k]) : k === 'budget' || k === 'call' ? { ...fresh[k] } : fresh[k];
        state.before[k] = fresh[k];
      }
    }
    state.space = { ...state.space, ...record };
    state.links = { guestToken: record.guestToken || null, allowGuests: record.allowGuests !== false };
  }
  // The call's stored values and the one in force are known: the Call section shows (paintCall).
  function takeCall(record, lookCall) {
    state.lookCall = lookCall;
    const fresh = callOf(record.call);
    if (sameValue(state.draft.call, state.before.call)) state.draft.call = { ...fresh };
    state.before.call = fresh;
    state.callIn = true;
    paintCall();
  }
  // A moderator's own answer for the space ({ id, phases, defaultLayout, budget }) holds the stored budget and
  // nothing else of the record, so only the budget is taken from it; the module list they may use is loadOptions'.
  async function loadModeratorParts(space) {
    let lookCall = null;
    const record = await api('GET', `/api/spaces/${encodeURIComponent(space.id)}`).then((r) => { lookCall = r.look && r.look.call ? r.look.call : null; return r.space; }).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    if (!record) return;
    takeCall(record, lookCall); // the stored target is not known: the Budget section stays hidden rather than risk replacing it
    paintTemplateSeen(record, !space.isLobby && await spaceTemplatesOn(api));
    if (!state || state.space.id !== space.id) return;
    const fresh = budgetText(record.budget);
    if (sameValue(state.draft.budget, state.before.budget)) { state.draft.budget = { ...fresh }; state.before.budget = fresh; }
    if (q('#setup-budget-currency')) state.currencies = await api('GET', '/api/currencies').then((r) => r.currencies || null).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    state.ownerPartsIn = true;
    fillFields();
    refresh();
  }
  // Waiting to come in: the pending requests for this space (owners and the admin), each with Approve and Deny. Names are
  // drawn as text. A decision is not part of Save: it goes at once, then the list is read again.
  const agoText = (at) => {
    const m = Math.max(0, Math.round((Date.now() - Number(at)) / 60000));
    if (!Number.isFinite(m)) return '';
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  };
  async function loadWaiting() {
    const box = q('#setup-waiting');
    const space = state && state.space;
    if (!box || !space) return;
    const say = (text, bad = false) => { const f = q('#setup-waiting-status'); if (f) { f.textContent = text; f.classList.toggle('error', bad); } };
    let rows;
    try {
      rows = (await api('GET', `/api/spaces/${encodeURIComponent(space.id)}/access-requests`)).requests || [];
    } catch (err) {
      if (!state || state.space.id !== space.id) return;
      box.replaceChildren();
      say(err.message || "Couldn't load the list.", true);
      return;
    }
    if (!state || state.space.id !== space.id || !q('#setup-waiting')) return;
    box.replaceChildren();
    if (!rows.length) {
      const p = doc.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nobody is waiting.';
      box.append(p);
      return;
    }
    const ul = doc.createElement('ul');
    ul.className = 'setup-waiting';
    for (const r of rows) {
      const li = doc.createElement('li');
      li.className = 'setup-waiting-row';
      const who = doc.createElement('span');
      who.className = 'setup-waiting-who';
      const name = doc.createElement('strong');
      name.textContent = r.name;
      const when = doc.createElement('span');
      when.className = 'hint';
      when.textContent = agoText(r.at);
      who.append(name, when);
      const actions = doc.createElement('span');
      actions.className = 'setup-waiting-actions';
      const decide = async (decision, buttons) => {
        buttons.forEach((b) => { b.disabled = true; });
        say('');
        try {
          await api('POST', `/api/spaces/${encodeURIComponent(space.id)}/access-requests/${encodeURIComponent(r.id)}`, { decision });
        } catch (err) {
          say(err.message || "Couldn't save that. Try again.", true); // a 409 (already answered) and a 429 read as the server says them
        }
        loadWaiting();
      };
      const button = (label, icon, cls, decision) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.dataset.decision = decision;
        const i = doc.createElement('i');
        i.className = `fa-solid ${icon} fa-fw`;
        i.setAttribute('aria-hidden', 'true');
        b.append(i, doc.createTextNode(` ${label}`));
        b.addEventListener('click', () => decide(decision, [...actions.querySelectorAll('button')]));
        return b;
      };
      actions.append(button('Approve', 'fa-check', 'btn btn-small btn-primary', 'approve'), button('Deny', 'fa-xmark', 'btn btn-small', 'deny'));
      li.append(who, actions);
      ul.append(li);
    }
    box.append(ul);
  }
  async function loadOwnerParts(space) {
    const id = encodeURIComponent(space.id);
    let lookCall = null; // the call as it is in force now (the template's, then this space's own): GET's `look.call`
    const [record, users, installed, ai, templates] = await Promise.all([
      api('GET', `/api/spaces/${id}`).then((r) => { lookCall = r.look && r.look.call ? r.look.call : null; return r.space; }).catch(() => null),
      space.isLobby ? Promise.resolve([]) : api('GET', '/api/users').then((r) => r.users || []).catch(() => []),
      api('GET', '/api/modules').then((r) => r.modules || []).catch(() => null),
      api('GET', '/api/ai').then((r) => r.ai || null).catch(() => null),
      space.isLobby ? Promise.resolve(null) : loadTemplateChoices(api), // the Lobby has no template of its own
    ]);
    if (!state || state.space.id !== space.id) return;
    if (record) { takeServerSpace(record); takeCall(record, lookCall); }
    // Visiting guests does something only while the host's guest sign-in is on; the environment's name is in the second switch.
    const branding = await api('GET', '/api/branding').catch(() => ({}));
    if (!state || state.space.id !== space.id) return;
    state.door = Boolean(branding.guestDoor);
    state.templates = templates;
    state.spaceTemplates = branding.spaceTemplates !== false; // off in Manage: the choice is hidden
    state.environmentName = typeof branding.environmentName === 'string' ? branding.environmentName.trim() : '';
    paintEntry();
    if (q('#setup-budget-currency')) state.currencies = await api('GET', '/api/currencies').then((r) => r.currencies || null).catch(() => null);
    if (!state || state.space.id !== space.id) return;
    state.users = users;
    state.installed = installed;
    state.ownerPartsIn = true; // the stored budget is known now: the Budget section may show (paintBudgetSection)
    fillFields();
    loadWaiting();
    // Turn AI off is for an environment where AI Assistant is on and set up.
    const aiSection = q('[data-section="ai"]');
    if (aiSection) aiSection.hidden = !ai || ai.moduleOn === false || !ai.active || ai.active.provider === 'none';
    const seesSection = q('[data-section="ai-sees"]');
    if (seesSection) seesSection.hidden = !ai || ai.moduleOn === false || !ai.active || ai.active.provider === 'none';
    state.envSees = fullSees(ai && ai.sees);
    paintAiSees();
    refresh();
    if (!space.isLobby) loadCalendarSwitch(space);
  }
  // The modules' own settings for this space, drawn without their Saves (module-settings.js, `draft: true`): the panel's
  // Save sends them. With none (and no Fixed Workspace switch) the section is hidden; Tags stay.
  async function loadModuleSettings(space) {
    const box = q('#setup-module-settings');
    if (!box) return;
    const answer = typeof deps.renderModuleSettings === 'function'
      ? await deps.renderModuleSettings(box, { scope: 'space', space: space.id, draft: true, onChange: () => refresh() }).catch(() => null)
      : null;
    if (!state || state.space.id !== space.id) return;
    state.moduleSettings = answer;
    const section = q('[data-section="module-settings"]');
    if (section) section.hidden = !answer;
    paintFixed(); // a Fixed Workspace's switches go into the module's card now that it is drawn (and show the section)
    refresh();
  }
  // The space's place in the published calendar (plan-space-calendars.md, section 2): shown only while an owner has
  // turned publishing on and the module whose events it carries is on, named after it.
  async function loadCalendarSwitch(space) {
    try {
      const settings = await api('GET', '/api/settings').then((r) => r.settings || {});
      if (!state || state.space.id !== space.id) return;
      const mods = state.installed || [];
      const m = mods.find((x) => x.sharing === true && x.sharingReasons && 'publishedCalendar' in x.sharingReasons);
      const section = q('[data-section="calendar"]');
      if (!section) return;
      q('#setup-calendar-heading').textContent = m ? (m.displayName || m.name) : 'Calendar';
      section.hidden = settings.publishedCalendar !== true || !(m && m.enabled);
    } catch {
      /* the switch stays hidden */
    }
  }

  async function loadOptions() {
    const { space } = state;
    const asks = state.tabs.includes('layout') || state.tabs.includes('modules');
    const [answer, layouts] = await Promise.all([
      asks ? api('GET', `/api/modules/for-space?space=${encodeURIComponent(space.id)}`).catch(() => ({})) : Promise.resolve({}),
      asks ? api('GET', `/api/spaces/${encodeURIComponent(space.id)}/layouts`).catch(() => ({})) : Promise.resolve({}),
    ]);
    if (!state || state.space.id !== space.id) return;
    state.options = {
      modules: (answer.modules || []).filter((m) => !m.canvas || m.canvas.menu !== false),
      builtin: answer.builtin || [],
      // What the template opens a new person with (its Default Workspace's layout, { shape, areas }); the space keeps none of its own. Read only.
      layout: answer.layout && typeof answer.layout.shape === 'string' && Array.isArray(answer.layout.areas) ? answer.layout : null,
      budgetModules: answer.modules || [], // a moderator's list for the Budget section (an owner has GET /api/modules)
    };
    // The server's own view is the freshest: the presence record may lag a save by someone else. What was not touched
    // while it was asked is set from it; the first visit as the server resolved it (a layout no longer there reads as
    // the Workspace, and stays stored until another is picked).
    const fv = layouts.firstVisit || answer.firstVisit;
    const served = fv && typeof fv.layout === 'string' ? layoutOrNull(fv.layout) : answer.defaultLayout !== undefined ? (answer.defaultLayout ? answer.defaultLayout.id : null) : undefined;
    if (served !== undefined && layoutOrNull(state.draft.defaultLayout) === layoutOrNull(state.before.defaultLayout)) {
      state.draft.defaultLayout = served;
      state.before.defaultLayout = served;
    }
    // The owner's tabs as the server holds them, whole; a draft the person already changed is left alone.
    if (layouts.tabs && sameValue(state.draft.tabs, state.before.tabs)) {
      state.before.tabs = tabsWhole(layouts.tabs);
      state.draft.tabs = tabsWhole(layouts.tabs);
    }
    state.layouts = { system: Array.isArray(layouts.system) ? layouts.system : [], shared: Array.isArray(layouts.shared) ? layouts.shared : [], canSetDefault: layouts.canSetDefault !== false };
  }

  function open(opts) {
    if (state) close();
    const space = opts.space;
    // The template's phases (a list) and the rule (public/phases.js); without either, no phases tab.
    const rule = opts.rule || null;
    const phaseList = rule && Array.isArray(opts.phases) ? rule.cleanPhases(opts.phases) : [];
    const tabs = setupTabs({ owner: opts.owner, moderator: opts.moderator, phases: phaseList.length > 0 });
    if (!tabs.length) return false;
    const before = beforeOf(space);
    state = {
      space, tabs, tab: null, opts, owner: Boolean(opts.owner), before, draft: copyOf(before),
      options: { modules: [], builtin: [], layout: null }, layouts: { system: [], shared: [], canSetDefault: true },
      image: { file: null, url: '', remove: false }, links: { guestToken: space.guestToken || null, allowGuests: space.allowGuests !== false },
      users: null, saving: false, rule, phaseList, today: opts.today || null, installed: null, moduleSettings: null, fixedRows: [], fixedDraft: {},
    };
    el.dataset.who = opts.owner ? 'owner' : opts.moderator ? 'moderator' : 'member';
    draw();
    // The bar's input and the panel's Name are one name: typed in either, the other follows.
    if (opts.nameInput && state.owner) {
      state.onBarName = () => { if (!state) return; state.draft.name = opts.nameInput.value; refresh(); const f = q('#setup-name'); if (f && f.value !== opts.nameInput.value) f.value = opts.nameInput.value; };
      opts.nameInput.addEventListener('input', state.onBarName);
    }
    el.hidden = false;
    if (!el.isConnected) doc.body.appendChild(el);
    select(pickTab(tabs, opts.tab));
    focusFirst();
    fitTabs();
    (doc.defaultView || window).requestAnimationFrame(() => fitTabs());
    refresh();
    loadOptions().then(() => { if (state && state.space.id === space.id) { if (q('#setup-opens-with')) paintOpensWith(); if (q('#setup-first-visit')) paintLayouts(); paintFixed(); paintBudgetSection(); refresh(); } });
    if (state.owner) loadOwnerParts(space);
    else if (opts.moderator && !space.isLobby) loadModeratorParts(space);
    if (state.tabs.includes('modules')) { loadModuleSettings(space); if (!space.isLobby) loadTags(space); }
    return true;
  }
  // The keyboard goes to the tab's first field that shows: the name, the first member's switch, the first phase's start (or
  // the first step's day), the call's Join on entry (or Faces), the first tab in the bar's switch (or the first visit's
  // choice), the first of the modules' fields.
  const FIRST_FIELD = {
    details: '#setup-name',
    members: '#setup-members input, #setup-open',
    phases: '#setup-phase-list input:not(:disabled), #setup-phase-list .phase-add',
    call: '#setup-call-join, #setup-profile',
    layout: '#setup-layout-rows [data-layout-show]:not(:disabled), #setup-first-visit input:checked, #setup-first-visit input:not(:disabled), #setup-open',
    modules: '#setup-ai-off, #setup-tags input, #setup-module-settings input, #setup-module-settings select, #setup-fixed-modules input:not(:disabled)',
  };
  const shownField = (sel) => [...el.querySelectorAll(sel || ':not(*)')].find((f) => f.getClientRects().length > 0 && !f.disabled) || null;
  function focusFirst() {
    const content = q(`#setup-content-${state.tab}`);
    const firstStep = state.tab === 'phases' && q('#setup-phase-first') && !q('#setup-phase-first').hidden ? q('#setup-phase-first-day') : null;
    const first = firstStep || shownField(FIRST_FIELD[state.tab]);
    if (first) first.focus();
    else if (content) content.focus();
  }

  function close() {
    if (!state) return;
    if (state.image.url) URL.revokeObjectURL(state.image.url);
    const { opts } = state;
    if (state.onBarName && opts.nameInput) opts.nameInput.removeEventListener('input', state.onBarName);
    state.fitWatch?.disconnect();
    state = null;
    el.hidden = true;
    el.innerHTML = '';
    if (typeof opts.onLeave === 'function') opts.onLeave();
  }

  // Cancel, as Escape does: asks "Discard your changes?" first when something was edited.
  function cancel() {
    if (!state || state.saving) return;
    state.bar.requestCancel();
  }

  // A refusal: the panel stays, on the field's tab, with the sentence and the keyboard on the field. What went through
  // before it stays saved and is said.
  const FIELD_INPUT = {
    name: '#setup-name', description: '#setup-description', template: '#setup-template', profile: '#setup-profile', link: '#setup-link', linkIcon: '#setup-link-icon [aria-checked="true"]',
    publishCalendar: '#setup-publish-calendar', members: '#setup-members input', allowGuests: '#setup-allow-guests', entry: '#setup-entry-accounts', closed: '#setup-open', requestAccess: '#setup-request-access', budget: '#setup-budget-amount',
    defaultLayout: 'input[name="setup-first-visit"]:checked', tabs: '#setup-layout-rows [data-layout-show]:not(:disabled)', image: '.setup-picture-pick input', imageRemoved: '.setup-picture-pick input',
    phases: '#setup-phase-list input:not(:disabled)', aiOff: '#setup-ai-off', aiSees: '#setup-ai-sees-follow', call: '#setup-call-join',
  };
  // The fields in this environment's words: the members, the guest link switch, and each module's settings by its name.
  function fieldWords() {
    const words = { members: `the ${membersWord()}`, allowGuests: `invited ${word('guest', { many: true })}`, entry: 'who can enter', closed: `whether the ${spaceWord()} is closed for set up` };
    for (const m of (state && state.moduleSettings ? state.moduleSettings.modules : [])) words[`module:${m.id}`] = `the ${m.name} settings`;
    for (const r of (state ? state.fixedRows : [])) words[`fixed:${r.id}`] = `${r.label} (${r.moduleName})`;
    return words;
  }
  function refused(saved, failed, problem) {
    say(setupSaidWords({ saved, failed, problem }, { setUp: configLabel(), words: fieldWords() }));
    const tab = tabOfField(failed, state.tabs);
    if (tab && state.tabs.includes(tab)) select(tab);
    const moduleId = String(failed).startsWith('module:') ? failed.slice(7) : null;
    const card = moduleId && state.moduleSettings ? state.moduleSettings.sectionOf(moduleId) : null;
    const fixedId = String(failed).startsWith('fixed:') ? failed.slice(6) : null;
    const fixedInput = fixedId ? [...el.querySelectorAll('[data-fixed]')].find((f) => f.dataset.fixed === fixedId) : null;
    const input = fixedInput || (card ? card.querySelector('input, select, textarea, button') : q(FIELD_INPUT[failed] || '') || (failed === 'name' && state.opts.nameInput));
    if (input) input.focus();
    if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
    refresh();
    return false;
  }

  // One save, in order, stopping at the first refusal: the PATCH for what changed, the call's, the picture, each changed
  // module's settings, then each changed Fixed Workspace switch. (No module on/off switches: availability per space was
  // removed; the server ignores `spaces`.)
  async function done() {
    if (!state || state.saving) return false;
    const { space, image, opts } = state;
    if (opts.nameInput && state.owner) state.draft.name = opts.nameInput.value;
    // A budget the field cannot read is refused here, before anything is sent: sent, it would read as no budget.
    const budgetField = q('#setup-budget-amount');
    const entry = budgetField && !q('[data-section="budget"]').hidden ? budgetEntryProblem({ ...state.draft.budget, bad: Boolean(state.draft.budget?.bad || (budgetField.validity && budgetField.validity.badInput)) }) : null;
    if (entry) return refused([], 'budget', entry);
    const patch = patchNow();
    // A change of template asks first: what changes now and what stays (the plan's wording).
    if ('template' in patch) {
      const chosen = optionList(state.templates || {}, patch.template || SAME, word).find((o) => o.value === (patch.template || SAME));
      // Which modules turn off and on here: the template the space reads now against the one it will read, in full.
      let shift = null;
      try {
        const env = (state.templates && state.templates.environment && state.templates.environment.id) || 'default';
        const read = async (id) => (await api('GET', `/api/environment/templates/${encodeURIComponent(id)}`)).template;
        const catalog = [{ id: 'chat', name: 'Chat' }, { id: 'conference', name: 'Conference' }, ...(state.installed || []).filter((m) => m.enabled).map((m) => ({ id: m.id, name: m.name }))];
        shift = moduleShift(await read(state.before.template || env), await read(patch.template || env), catalog);
      } catch (err) { shift = null; }
      if (!await confirmDialog(changeQuestion(patch.template ? chosen.label : '', word, shift))) return false;
      if (!state) return false;
    }
    const moduleChanged = moduleChanges();
    const saved = [];
    let answered = null;
    state.saving = true;
    el.classList.add('saving');
    say('');
    try {
      if (Object.keys(patch).length) {
        try {
          answered = (await api('PATCH', `/api/spaces/${encodeURIComponent(space.id)}`, patch)).space;
          saved.push(...Object.keys(patch));
          // What went through is now what was: a later refusal leaves only the rest to save.
          if (answered) {
            ({ before: state.before, draft: state.draft } = takeSaved(state.before, state.draft, Object.keys(patch), answered));
            for (const [k, sel] of [['description', '#setup-description'], ['link', '#setup-link']]) {
              const f = k in patch ? q(sel) : null;
              if (f && f.value !== state.draft[k]) f.value = state.draft[k];
            }
            state.space = { ...state.space, ...answered };
            state.links = { guestToken: answered.guestToken || null, allowGuests: answered.allowGuests !== false };
          }
        } catch (err) {
          return refused(saved, problemField(patch, err.message), err.message);
        }
      }
      // The call is its own request, on its own: a moderator's body may hold nothing else with it.
      const callBody = callPatchNow();
      if (callBody.call) {
        try {
          const back = (await api('PATCH', `/api/spaces/${encodeURIComponent(space.id)}`, callBody)).space;
          saved.push('call');
          if (back) {
            answered = back;
            ({ before: state.before, draft: state.draft } = takeSaved(state.before, state.draft, ['call'], back));
          }
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, 'call', err.message);
        }
      }
      if (image.file) {
        try {
          answered = (await api('PUT', `/api/spaces/${encodeURIComponent(space.id)}/image`, image.file, image.file.type)).space;
          saved.push('image');
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          paintGuestLink();
          return refused(saved, 'image', err.message);
        }
      } else if (image.remove && state.space.hasImage) {
        try {
          answered = (await api('DELETE', `/api/spaces/${encodeURIComponent(space.id)}/image`)).space;
          saved.push('imageRemoved');
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, 'imageRemoved', err.message);
        }
      }
      for (const change of moduleChanged) {
        try {
          await api('PUT', `/api/modules/${encodeURIComponent(change.id)}/settings/space`, { values: change.values, space: space.id });
          saved.push(`module:${change.id}`);
          state.moduleSettings.saved(change.id); // what went through is now what was
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, `module:${change.id}`, err.message);
        }
      }
      // A Fixed Workspace's switches: the module's own setting, through its own route for its scope (what Manage writes).
      const fixedChanged = fixedChanges();
      for (const { id, row, on } of fixedChanged) {
        try {
          await api('PUT', `/api/modules/${encodeURIComponent(row.module)}/settings/${row.scope}`, { values: { [row.key]: on }, ...(row.scope === 'space' ? { space: space.id } : {}) });
          saved.push(`fixed:${id}`);
          row.on = on; // what went through is now what was
          delete state.fixedDraft[id];
        } catch (err) {
          if (saved.length && typeof opts.onSaved === 'function') opts.onSaved(answered, saved);
          return refused(saved, `fixed:${id}`, err.message);
        }
      }
      if (fixedChanged.length && typeof opts.onFixedSaved === 'function') opts.onFixedSaved(); // the values the page holds follow
    } finally {
      if (state) { state.saving = false; el.classList.remove('saving'); }
    }
    const said = setupSaidWords({ saved }, { setUp: configLabel(), words: fieldWords() });
    const onDone = opts.onDone;
    close();
    if (typeof onDone === 'function') onDone(answered, said, saved);
    return true;
  }

  // The page's facts arrived after the panel opened (opened by address, say): a module reads the budget, so the section
  // shows, named after it. Nothing typed is touched.
  function offerBudget(info) {
    if (!state || !info) return;
    state.opts = { ...state.opts, budget: { name: String(info.name || '') } };
    paintBudgetSection();
    paintBudget();
  }

  return { el, open, close, done, cancel, offerBudget, select: (id) => select(id, { focus: true }), isOpen: () => Boolean(state) };
}
