'use strict';

// Freezes an object and everything inside it, so a default every environment shares can't be changed by one of them: in
// strict code a write throws instead of quietly reaching the others. Only plain values are walked; a getter is left
// alone (never called), so a value read live, like a name from PRODUCT_NAME, stays live.
function deepFreeze(o, seen = new WeakSet()) {
  if (!o || typeof o !== 'object' || seen.has(o)) return o;
  seen.add(o);
  Object.freeze(o);
  for (const d of Object.values(Object.getOwnPropertyDescriptors(o))) if ('value' in d) deepFreeze(d.value, seen);
  return o;
}

module.exports = { deepFreeze };
