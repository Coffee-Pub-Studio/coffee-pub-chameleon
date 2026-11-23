// The fixture's model, shared by its page and its server actions (tools/check-module-actions.mjs).
function fixtureTitle(text) {
  const t = String(text || '').trim();
  if (!t) throw new Error('A note needs a title.');
  return t.slice(0, 200);
}
