// What a space opens with when someone enters it (documentation/plans/plan-entering.md, "What opens on entering";
// plan-layout-picker.md, decisions 2 and 14). canvas.js's restore() asks this, after a fresh request to open one module
// on one object (which wins, and is handled there). Pure, no document and no imports, so tools/check-canvas.mjs runs it
// in node.
//
// In order:
//   1. the person's remembered arrangement for this space (`__open`), if they have been in it before; never for a guest;
//   2. the template's layout (workspace.layout, a shape and its areas): firstVisitShape() answers it, and the canvas
//      places it through its own loader (canvas.loadLayout), so it is only the starting arrangement (decision 6);
//   3. with no layout: the chat and every module on in the space, without the conference; for a guest, the
//      conference and the chat (whatOpens).
//
// `canOpen(id)` says whether this person may open a module here (the conference by conferenceAllowed() below, the chat
// by its permission; any other id by being on in the space for them). `modules` is the ids on in the space for
// this person, in the Modules menu's order.
// `column`: the always-on column holds the conference and the chat (plan-one-bar.md, step 6), so wider than a phone
// the canvas asks with it and the two ids are left out of the answer, whichever list names them. The lists still
// hold them (a phone opens them as tabs; nothing a person stored changes).
export const COLUMN_IDS = Object.freeze(['conference', 'chat']);
// `aliases` (composites.js's aliasesFor; plan-calendar-todo.md and plan-map-places.md, step 3): a stored id read as
// another, or as a list of others ({ calendar: 'dest:calendar', todo: 'dest:calendar' } while the Calendar is on in the
// space; { maps: 'dest:map' } while the space's Map is shown), each once, in the first place it is
// named. The lists themselves are never rewritten.
export function readAliased(list, aliases = {}) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    const to = aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id;
    for (const one of Array.isArray(to) ? to : [to]) if (typeof one === 'string' && one && !out.includes(one)) out.push(one);
  }
  return out;
}
export function whatOpens({ remembered = null, modules = [], canOpen = () => true, guest = false, column = false, aliases = {} } = {}) {
  const keep = (list) => (column ? list.filter((id) => !COLUMN_IDS.includes(id)) : list);
  if (!guest && Array.isArray(remembered)) return keep(readAliased(remembered, aliases));
  return keep(readAliased(guest ? ['conference', 'chat'] : ['chat', ...modules], aliases).filter((id) => canOpen(id)));
}

// The template's layout a visit starts from (step 2 above), or null: `shape` is the server's { shape, areas }
// (GET /api/modules/for-space, `layout`; the Default template's is `one` with its area empty). Only while this person has
// no remembered arrangement here (a guest never has one, so a guest starts from it every time); after the first visit
// the person's own arrangement wins (plan-layout-picker.md, decision 2). Whether the shape's id is known, and what each
// area may hold here, is the canvas's to decide when it places it.
export function firstVisitShape({ shape = null, remembered = null, guest = false } = {}) {
  if (!guest && Array.isArray(remembered)) return null;
  return shape && typeof shape === 'object' && typeof shape.shape === 'string' && Array.isArray(shape.areas) ? shape : null;
}

// Which layout a visit opens on (plan-layout-views.md, step 5, "Opens with and the default layout, as one choice"):
// 'workspace' (the Workspace with whatOpens's list), a fixed layout's id (that tab, with the Workspace behind it), or a
// shared layout's id (loaded into the Workspace). `firstVisit` is the server's resolved { layout, shape }
// (GET /api/modules/for-space); the template's shape is the Workspace's own content and sits beside any layout, so a
// layout never needs a shape to open, and a shape never stops a layout. Only the restore on entering asks (`entering`), and only a
// first visit: a person's remembered arrangement (`remembered`, never a guest's) wins afterwards. A guest has no tabs,
// so Calendar or Map open the Workspace for one (the server already answers 'workspace' for a guest).
export const SYSTEM_TABS = Object.freeze(['calendar', 'map', 'conference', 'whiteboard', 'documents']);
// `last` (plan-workspaces.md, step 6) is the layout this person last used here, already checked as still available by
// the page: it wins over the owner's default for anyone signed in ('workspace' too: the Workspace, as it was). A guest
// has none, so the owner's default is theirs every time.
export function firstVisitLayout({ firstVisit = null, remembered = null, guest = false, entering = true, last = null } = {}) {
  if (!entering) return 'workspace';
  if (!guest && typeof last === 'string' && last) return last;
  if (!guest && Array.isArray(remembered)) return 'workspace';
  const layout = firstVisit && typeof firstVisit.layout === 'string' && firstVisit.layout ? firstVisit.layout : 'workspace';
  if (guest && SYSTEM_TABS.includes(layout)) return 'workspace';
  return layout;
}

// Whether the conference may be opened: the server has a call service (branding.callService; with none there is no
// conference at all), the environment's switch, for everyone (an owner and the admin included), then this person's own
// permission ("See and join the conference").
export function conferenceAllowed({ callService = true, conferenceEnabled = true, permitted = false } = {}) {
  return callService !== false && conferenceEnabled !== false && Boolean(permitted);
}

// Whether entering a space joins the call by itself (GitHub #199; the space's `call.joinOnEntry`, from its look). Only with
// the setting on (`setting`); never while already in the call; only for a person the Join
// button would show to (`canJoin`: connected, the conference allowed here for them); never in an aside (an aside is the
// call already, and a pull into one keeps the call on its own); and not for a person who left the call since they
// entered (`left`): they stay out until they enter again. Asked once per entry, so a join never repeats.
export function shouldAutoJoin({ setting = false, inCall = false, canJoin = false, aside = false, left = false } = {}) {
  return setting === true && !inCall && Boolean(canJoin) && !aside && !left;
}

// What Set up says a new person sees open, read only, in plain words (plan-layout-picker.md, step 3): the template's
// layout (`layout`, { shape, areas }) as its shape and the modules in it, else, with none, what the product opens (the
// chat and the modules on here). `nameOf(id)` is the name a person reads; `groupOf(id)` the id whose name an id sits
// under (To-do under the Calendar where the Calendar is on). `canOpen(id)`: whether the module is on here; an area whose
// module is not closes up (decision 13), and the line says so. `space` and `module` are the words a person reads for
// a space and a module (the page's word()); the defaults are for node.
// "Whiteboard opens on the left, with Goals above Documents on the right."
const SHAPE_WORDS = {
  one: (a) => `${a[0]} fills the Workspace.`,
  'two-equal': (a) => `${a[0]} and ${a[1]} open side by side, the same width.`,
  'wide-narrow': (a) => `${a[0]} opens wide, with ${a[1]} narrow beside it.`,
  'three-equal': (a) => `${a[0]}, ${a[1]} and ${a[2]} open side by side, the same width.`,
  'tall-split': (a) => `${a[0]} opens on the left, with ${a[1]} above ${a[2]} on the right.`,
  'wide-split': (a) => `${a[0]} opens wide, with ${a[1]} above ${a[2]} narrow beside it.`,
};
const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
const upFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
export function layoutLine({ layout = null, modules = [], canOpen = () => true, nameOf = (id) => id, groupOf = (id) => id, space = 'space', module = 'module' } = {}) {
  const words = layout && typeof layout === 'object' && Object.prototype.hasOwnProperty.call(SHAPE_WORDS, layout.shape) ? SHAPE_WORDS[layout.shape] : null;
  if (!words || !Array.isArray(layout.areas)) {
    const names = [...new Set(whatOpens({ modules, canOpen }).map(groupOf))].map(nameOf);
    if (!names.length) return 'Nothing opens.';
    return `${andList(names)} ${names.length > 1 ? 'open' : 'opens'}.`;
  }
  const areas = layout.areas.map((id) => (typeof id === 'string' && id ? id : null));
  if (layout.shape === 'one' && !areas[0]) return `One empty area opens, for each person to choose a ${module}.`;
  const off = [];
  const named = areas.map((id) => {
    if (!id) return 'an empty area';
    if (!canOpen(id)) off.push(nameOf(id));
    return nameOf(groupOf(id));
  });
  const lines = [upFirst(words(named))];
  const empty = areas.filter((id) => !id).length;
  if (empty) lines.push(`Each person chooses a ${module} for the empty ${empty > 1 ? 'areas' : 'area'}.`);
  if (off.length) lines.push(`${andList(off)} ${off.length > 1 ? 'are' : 'is'} off in this ${space}, so ${off.length > 1 ? 'their areas close' : 'its area closes'} up.`);
  return lines.join(' ');
}
