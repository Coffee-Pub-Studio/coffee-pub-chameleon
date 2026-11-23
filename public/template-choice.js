// A space's own template (documentation/plans/plan-space-templates.md, step 3): the choice in Set up's Details tab and in
// Add <space> (public/space-add.js). The templates are the ones this environment offers (GET /api/environment/template's `choices`; the hidden
// ones are not in it), and the first choice, "Same as the <environment>", clears the space's own (template: null).
// The choice is hidden everywhere while the owner has the switch off (branding.spaceTemplates).
//
// The pure parts (sameLabel, optionList, changeQuestion) touch no document, so tools/check-nav.mjs can run them in node.
// A select's value is '' for "Same as the <environment>", else the template's id.

export const SAME = '';

// "Same as the campaign (Fantasy)": the environment's word, then the template it reads, when it has one.
export const sameLabel = (word, environment = null) => `Same as the ${word('environment')}${environment ? ` (${environment.name || environment.id})` : ''}`;

// The select's options: "Same as ..." first, then each template offered, then the template the space already has when this
// server no longer offers it (hidden or gone), so the choice always says what is in use. [{ value, label, description }].
export function optionList({ choices = [], environment = null } = {}, current = SAME, word = (w) => w) {
  const list = [{ value: SAME, label: sameLabel(word, environment), description: environment ? environment.description || '' : '' }];
  for (const c of choices) list.push({ value: c.id, label: c.name || c.id, description: c.description || '' });
  if (current && !list.some((o) => o.value === current)) list.push({ value: current, label: current, description: '' });
  return list;
}

// Which modules a change of template turns off and on (the template decides a space's modules; a module that turns off keeps
// its data). `from` and `to` are templates in full ({ modules: '*' | { id: { name? } } }); `catalog` is [{ id, name }], the
// modules this environment has, needed only to read a '*' (the Default template). Answers { off: [names], on: [names] }, or
// null when it cannot be told (a template not read, or a '*' with no catalog).
export function moduleShift(from, to, catalog = null) {
  if (!from || !to) return null;
  const known = new Map((catalog || []).map((m) => [m.id, m.name || m.id]));
  // With a catalog, only modules that are on here count: a template can list one this environment has not turned on.
  const idsOf = (t) => (t.modules === '*' ? (catalog ? [...known.keys()] : null) : Object.keys(t.modules || {}).filter((id) => !catalog || known.has(id)));
  const before = idsOf(from);
  const after = idsOf(to);
  if (!before || !after) return null;
  const nameIn = (t, id) => (t.modules && t.modules !== '*' && t.modules[id] && t.modules[id].name) || known.get(id) || id;
  return {
    off: before.filter((id) => !after.includes(id)).map((id) => nameIn(from, id)),
    on: after.filter((id) => !before.includes(id)).map((id) => nameIn(to, id)),
  };
}

const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');

// The sentences about modules for a confirm. `where` begins them ("In every trip that reads it,"). Without a shift (it could not
// be told) it says what the rule is.
export function shiftSentences(shift, where, word) {
  const modules = word('module', { many: true });
  if (!shift) return `${where} ${modules} the new template doesn't list turn off, and ${modules} it lists that were off turn on. A ${word('module')} that turns off keeps its data.`;
  const { off, on } = shift;
  if (!off.length && !on.length) return `${where} the same ${modules} stay on.`;
  const parts = [];
  if (off.length) parts.push(`${where} ${list(off)} turn${off.length > 1 ? '' : 's'} off. ${off.length > 1 ? 'Their' : 'Its'} data is kept.`);
  if (on.length) parts.push(`${off.length ? 'And ' : `${where} `}${list(on)} turn${on.length > 1 ? '' : 's'} on.`);
  return parts.join(' ');
}

// The question before a change: what changes now, which modules turn off and on (`shift`, from moduleShift) and that what turns
// off keeps its data.
export const changeQuestion = (name, word, shift = null) => ({
  title: name ? `Change this ${word('space')} to ${name}?` : `Change this ${word('space')} to the ${word('environment')}'s template?`,
  message: `Its words, phases and ${word('module')} names change now. ${shiftSentences(shift, `In this ${word('space')},`, word)} Nothing is deleted.`,
  action: 'Change',
});

// What this environment offers: { choices, environment: { id, name, description } | null }, or null when it cannot be read.
export async function loadTemplateChoices(api) {
  try {
    const answer = await api('GET', '/api/environment/template');
    const own = answer.template || null;
    const found = own && (answer.choices || []).find((c) => c.id === own.id);
    return { choices: answer.choices || [], environment: own ? { id: own.id, name: own.name || own.id, description: found ? found.description || '' : '' } : null };
  } catch (err) {
    return null;
  }
}

// Whether a space may read a template of its own here (the owner's switch; absent means on).
export async function spaceTemplatesOn(api) {
  try {
    const branding = await api('GET', '/api/branding');
    return branding.spaceTemplates !== false;
  } catch (err) {
    return false;
  }
}

// Fill a select with the options; `current` is the chosen value.
export function fillSelect(select, loaded, current, word) {
  const options = optionList(loaded, current, word);
  select.replaceChildren(...options.map((o) => {
    const e = select.ownerDocument.createElement('option');
    e.value = o.value;
    e.textContent = o.label;
    return e;
  }));
  select.value = options.some((o) => o.value === current) ? current : SAME;
  return options;
}
