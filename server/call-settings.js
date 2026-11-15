// The core call settings (plan-templates-redesign.md, decision 16 and 37): whether entering a space joins the call, where the
// call sits and how its tiles are laid out. A template gives each as a default (`template.call`); a space may hold its own
// (`space.call`); a person's own position and layout, kept in their browser, win once picked. Kept in one small file so the
// template rules (server/templates.js) and the space rules (server/store.js updateSpace) read the same lists.
// They move to the call's manifest when the call becomes a module.

const CALL_KEYS = ['joinOnEntry', 'position', 'layout'];
const CALL_POSITIONS = ['top', 'bottom', 'left', 'right', 'float', 'workspace', 'window'];
const CALL_LAYOUTS = ['grid', 'strip', 'focus', 'spotlight'];
// What a call does when nothing, no template included, says otherwise (the Default template's own values).
const CALL_DEFAULTS = Object.freeze({ joinOnEntry: false, position: 'top', layout: 'grid' });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// One value, or the sentence for why not. `at` is the start of the sentence ("call." in a template, "" for a space).
function problemOfValue(key, value, at = '') {
  if (key === 'joinOnEntry') return typeof value === 'boolean' ? null : `${at}joinOnEntry must be true or false.`;
  if (key === 'position') return CALL_POSITIONS.includes(value) ? null : `${at}position must be one of ${CALL_POSITIONS.join(', ')}.`;
  if (key === 'layout') return CALL_LAYOUTS.includes(value) ? null : `${at}layout must be one of ${CALL_LAYOUTS.join(', ')}.`;
  return `${at}${String(key).slice(0, 40)} is not a call setting; the call takes only ${CALL_KEYS.join(', ')}.`;
}

// A space's own call settings after a patch: `patch` is an object (each key set, or null to go back to the template's) or
// null (all of them go back). `stored` is what the space holds now. Returns { call, error }: `call` is an object, empty
// when the space holds none (the caller stores nothing then); `error` one plain sentence and nothing changes.
function applyCallPatch(stored, patch) {
  if (patch === null) return { call: {} };
  if (!isObject(patch)) return { error: `The call's settings are sent as an object with ${CALL_KEYS.join(', ')}, or null to follow the template.` };
  const call = {};
  for (const k of CALL_KEYS) if (isObject(stored) && stored[k] !== undefined && problemOfValue(k, stored[k]) === null) call[k] = stored[k];
  for (const [k, v] of Object.entries(patch)) {
    if (!CALL_KEYS.includes(k)) return { error: problemOfValue(k, v) };
    if (v === null) { delete call[k]; continue; }
    const bad = problemOfValue(k, v, 'The call\'s ');
    if (bad) return { error: bad };
    call[k] = v;
  }
  return { call };
}

// What a place's call reads: the defaults, then the template's, then the space's own, each key checked, so a hand-edited
// file never gives the page a value it can't use.
function resolveCall(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isObject(layer)) continue;
    for (const k of CALL_KEYS) if (layer[k] !== undefined && problemOfValue(k, layer[k]) === null) out[k] = layer[k];
  }
  return out;
}

module.exports = { CALL_KEYS, CALL_POSITIONS, CALL_LAYOUTS, CALL_DEFAULTS, problemOfValue, applyCallPatch, resolveCall };
