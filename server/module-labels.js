'use strict';

// A module's renameable labels (documentation/plans/plan-templates-redesign.md, "The module manifest", 2): the few words
// a module shows that a template may rename ("event" reads "meeting"), declared in module.json as
// `"labels": { "<key>": { "one", "many", "a"? } }`. A label is a word a person reads, held to the same rules as the level
// and role words (server/words.js cleanWord: letters, single spaces, hyphens and apostrophes, at most 30 characters), so
// neither a manifest nor a template can put markup, a control character or a long text in front of anyone. A template
// renames only the keys the manifest declares (server/templates.js); everything else reads the manifest's own word.

const words = require('./words');

const MAX_LABELS = 20;
const LABEL_KEY_RE = /^[a-z][a-z0-9-]{0,29}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// A manifest's `labels`, checked: { <key>: { one, many, a? } }, keys in the manifest's order. Throws `onError(sentence)`'s
// error on the first problem. Absent is none ({}).
function cleanLabels(raw, onError) {
  if (raw === undefined || raw === null) return {};
  if (!isObject(raw)) throw onError('module.json: labels must be an object of words by key, such as { "event": { "one": "event", "many": "events" } }');
  const keys = Object.keys(raw);
  if (keys.length > MAX_LABELS) throw onError(`module.json: labels can list at most ${MAX_LABELS} words`);
  const out = {};
  for (const key of keys) {
    if (!LABEL_KEY_RE.test(key)) throw onError(`module.json: label "${String(key).slice(0, 40)}" must be lowercase letters, digits and dashes, starting with a letter, up to 30 characters`);
    const { word, error } = words.cleanWord(key, raw[key]);
    if (error) throw onError(`module.json: labels: ${error}`);
    out[key] = word;
  }
  return out;
}

// What a module's labels read in one place: for each label the manifest declares, the template's word when it gives a
// good one, else the manifest's own. Each { one, many, a }, `a` filled with the usual article when not given. Nothing a
// manifest does not declare is ever answered, whatever the template holds.
function effectiveLabels(manifest, templateLabels) {
  const declared = isObject(manifest?.labels) ? manifest.labels : {};
  const given = isObject(templateLabels) ? templateLabels : {};
  const out = {};
  for (const key of Object.keys(declared)) {
    if (!LABEL_KEY_RE.test(key)) continue;
    const own = words.cleanWord(key, declared[key]).word;
    if (!own) continue;
    const fromTemplate = Object.hasOwn(given, key) ? words.cleanWord(key, given[key]).word : null;
    const w = fromTemplate || own;
    out[key] = { one: w.one, many: w.many, a: w.a || `${/^[aeiou]/i.test(w.one) ? 'an' : 'a'} ${w.one}` };
  }
  return out;
}

module.exports = { cleanLabels, effectiveLabels, MAX_LABELS, LABEL_KEY_RE };
