'use strict';
// The shared delete path, and the Undo of an agent's change (documentation/plans/plan-agent-edit-delete.md, "Left to build",
// step 4, and "The contract", 4).
//
// One delete function for one module object: a person's page delete (DELETE /api/modules/:id/data/:key), the Undo of an
// agent's `added`, and a person's approval of an agent's delete ask (step 6). Each is run as the person it is for (`ctx`, from
// moduleAccess or moduleAccessAt), so whoever deletes is held to the module's rules as they are: a copy of another module's
// object only by whoever may change its original (#857), the module's guards (`checkDelete`), the hidden fields, and what
// belongs to the object (a rule's `parent`: a poll's votes) going with it. Then other modules hear of it (object-sync: a
// Calendar copy goes, a holder is removed or marked), schedules about the object are cancelled (a Calendar reminder set
// by a page does not fire for an event that is gone), and the files it named go, unless a hold keeps them for an Undo.
//
// `hold`: { changeId, by, days } keeps what the delete takes, before it is taken, as a keyed hold (server/module-holds.js):
// the object, its children and the holders object-sync is about to remove or mark, with the links a removed holder had.
// Nothing here awaits, so the check and the write are one step.
//
// The Undo of an object change (`added`, `edited`, `deleted`) is here too, run as the person undoing: each refusal is one
// sentence (UNDO_WHY), answered 409 by the routes.
//
// Built by server/index.js with what it needs, by name (createDeletePath(deps)), so this file names nothing of the app.

const UNDO_WHY = Object.freeze({
  changed: 'That has been changed since, so undo would lose that change.',
  taken: 'Something new is there now.',
  undone: 'That was undone already.',
  old: 'That is too old to undo.',
  gone: 'That is gone.',
  large: 'Too large to undo.',
});

function createDeletePath(d) {
  const ownRef = (ctx, key) => d.ownRefAt(ctx.manifest, ctx.scopeKey, key);

  // The holders in other modules object-sync will remove or mark when `ref` goes: [{ module, scopeKey, key, value,
  // version, updatedAt, by, removed, links? }] as they are now.
  function holdersOf(ref) {
    if (!ref) return [];
    const out = [];
    for (const holder of d.moduleLinks.to(ref)) {
      const produce = d.produceOf(holder.module, holder.kind);
      if (!produce || !produce.holds) continue;
      const scopeKey = holder.scope === 'space' && holder.space ? `space:${holder.space}` : holder.scope === 'environment' ? 'environment' : null;
      if (!scopeKey) continue;
      const key = produce.key.replace('{id}', holder.id);
      const stored = d.moduleData.get(holder.module, scopeKey, key);
      const got = stored && stored.value && typeof stored.value === 'object' ? stored.value[produce.holds.field] : null;
      if (!got || got.module !== ref.module || got.kind !== ref.kind || String(got.id) !== String(ref.id)) continue;
      const removed = produce.holds.onDelete === 'remove';
      if (!removed && (!produce.holds.markField || stored.value[produce.holds.markField] === true)) continue;
      const pairs = new Set(d.moduleLinks.pairsFrom(holder).map((p) => JSON.stringify(p.to)));
      const links = removed ? d.moduleLinks.from(holder).filter((to) => !pairs.has(JSON.stringify(to))) : undefined;
      out.push({ module: holder.module, kind: holder.kind, id: holder.id, scopeKey, key, value: stored.value, version: stored.version, updatedAt: stored.updatedAt, by: stored.by, removed, ...(links ? { links } : {}) });
    }
    return out;
  }

  // Deletes `key` where ctx works, as ctx's person. Answers a refusal { status, error } (a copy they may not change, a
  // guard, a hidden field; a hidden copy answers as a key that is not there: { removed }), or { removed, had, children,
  // held } where `removed` is what the data route answers ({ key, deleted, version }), `children` the keys that went with
  // it and `held` whether a hold keeps it (null when none was asked; false when it was too big). Throws what moduleData
  // throws: a 409 StoreError with `current` when `expected` is not the version stored, a bad key 400.
  function removeObject(ctx, key, { expected = null, tz = null, hold = null } = {}) {
    const id = ctx.manifest.id;
    // A plan an issue pull fills is the pull's to change (plan-github-pull.md, decision 9).
    const pulled = d.pulledRefusal(ctx, key);
    if (pulled) return pulled;
    const copyRefused = d.takesCopies(ctx.manifest) ? d.copyRemoveRefusal(ctx, key) : null;
    if (copyRefused?.hidden) return { removed: { key, deleted: true, version: 0 }, had: null, children: [], held: null };
    if (copyRefused) return { status: copyRefused.status, error: copyRefused.error };
    const had = d.moduleData.get(id, ctx.scopeKey, key);
    const guards = d.guardsAt(ctx);
    // A person removes their own data; guards that don't read still refuse it.
    const refused = guards && (!d.personalAt(ctx) || guards.invalid) ? d.moduleGuards.checkDelete(guards, { key, before: had ? had.value : null, who: d.guardWho(ctx), read: d.storedValue(ctx) }) : null;
    if (refused) return { status: refused.status, error: refused.error };
    // What belongs to it (a rule's `parent`: a poll's votes) goes with it, closed or not.
    const all = had && guards ? d.moduleData.list(id, ctx.scopeKey) : [];
    const children = new Set(d.moduleGuards.childrenOf(guards, key, all.map((item) => item.key)));
    const childItems = all.filter((item) => children.has(item.key));
    // A writer who can't see the hidden fields can't remove what holds any, nor what goes with it.
    const hiddenRefused = had ? d.moduleGuards.hiddenDeleteRefusal(had.value, ctx.hide, childItems.map((item) => item.value)) : null;
    if (hiddenRefused) return { status: hiddenRefused.status, error: hiddenRefused.error };
    const want = Number.isInteger(expected) ? expected : null;
    if (want !== null && had && had.version !== want) {
      const err = new d.StoreError('someone changed this since you read it', 409);
      err.current = had;
      throw err;
    }
    const ref = had ? ownRef(ctx, key) : null;
    // Held first, then deleted: a stop between the two leaves the object where it was.
    let held = null;
    let files = [];
    if (hold && had) {
      const items = [had, ...childItems].map(({ key: k, value, version, updatedAt, by }) => ({ key: k, value, version, updatedAt, by }));
      files = d.filesNamedBy(ctx.manifest, items);
      held = Boolean(d.moduleHolds.holdKeyed(id, hold.changeId, { scopeKey: ctx.scopeKey, key, kind: 'deleted', items, holders: holdersOf(ref), files, by: hold.by || ctx.by, tz, days: hold.days }));
    }
    let removed;
    try {
      removed = d.moduleData.remove(id, ctx.scopeKey, key, { expected: want, by: ctx.by });
    } catch (err) {
      if (held) d.moduleHolds.dropKeyed(id, hold.changeId);
      throw err;
    }
    if (had) {
      d.objectSync.afterWrite({ module: id, scopeKey: ctx.scopeKey, key, before: had.value, after: null, by: ctx.by, tz });
      for (const child of childItems) {
        d.moduleData.remove(id, ctx.scopeKey, child.key, { by: ctx.by });
        d.objectSync.afterWrite({ module: id, scopeKey: ctx.scopeKey, key: child.key, before: child.value, after: null, by: ctx.by, tz });
      }
      // A schedule about what went (a reminder a page set) is cancelled: nothing fires for an object that is gone.
      for (const k of [key, ...children]) {
        const about = ownRef(ctx, k);
        if (about) d.moduleHooks.cancelAbout(id, ctx.scopeKey, about);
      }
      // The files it named go, unless the hold keeps them for its Undo (they go when the hold does: finishKeyed).
      if (!held) d.removeFilesOf(ctx, [{ key, value: had.value }, ...childItems]);
    }
    return { removed, had, children: [...children], held };
  }

  // Why ctx's person may not delete `key`, asked without deleting anything: the refusals removeObject would answer (a copy
  // they may not change, a guard, a hidden field), or null. For a list that says whether a person may approve a delete.
  function removeRefusal(ctx, key) {
    const id = ctx.manifest.id;
    // A plan an issue pull fills is the pull's to change (plan-github-pull.md, decision 9).
    const pulled = d.pulledRefusal(ctx, key);
    if (pulled) return pulled;
    const copyRefused = d.takesCopies(ctx.manifest) ? d.copyRemoveRefusal(ctx, key) : null;
    if (copyRefused) return { status: copyRefused.hidden ? 404 : copyRefused.status, error: copyRefused.hidden ? "That isn't there." : copyRefused.error };
    const had = d.moduleData.get(id, ctx.scopeKey, key);
    const guards = d.guardsAt(ctx);
    const refused = guards && (!d.personalAt(ctx) || guards.invalid) ? d.moduleGuards.checkDelete(guards, { key, before: had ? had.value : null, who: d.guardWho(ctx), read: d.storedValue(ctx) }) : null;
    if (refused) return { status: refused.status, error: refused.error };
    const all = had && guards ? d.moduleData.list(id, ctx.scopeKey) : [];
    const children = new Set(d.moduleGuards.childrenOf(guards, key, all.map((item) => item.key)));
    const hidden = had ? d.moduleGuards.hiddenDeleteRefusal(had.value, ctx.hide, all.filter((item) => children.has(item.key)).map((item) => item.value)) : null;
    return hidden ? { status: hidden.status, error: hidden.error } : null;
  }

  // What goes with the object at `key` when it is deleted, as counts: { children } (what belongs to it: a poll's votes) and
  // { holders } (objects in other modules that go or are marked because they hold it).
  function goesWith(manifest, scopeKey, key) {
    const guards = d.guardsAt({ manifest });
    const keys = guards ? d.moduleData.list(manifest.id, scopeKey).map((item) => item.key) : [];
    return { children: guards ? d.moduleGuards.childrenOf(guards, key, keys).length : 0, holders: holdersOf(d.ownRefAt(manifest, scopeKey, key)).length };
  }

  // Holds the value at `key` before an agent's write changes it (`edited`): { held } (false when too big to keep). An added
  // object holds nothing.
  function holdEdit(ctx, key, had, { changeId, by, days, tz = null }) {
    return Boolean(d.moduleHolds.holdKeyed(ctx.manifest.id, changeId, { scopeKey: ctx.scopeKey, key, kind: 'edited', items: [{ key, value: had.value, version: had.version, updatedAt: had.updatedAt, by: had.by }], by, tz, days }));
  }

  // Why the change `c` can't be undone now, as a key of UNDO_WHY, or null. `hold` is its keyed hold (or null).
  function undoProblem(c, hold) {
    if (c.undoneAt) return 'undone';
    const found = d.enabledModule(c.object.module);
    if (!found) return 'gone';
    const scopeKey = `space:${c.space}`;
    const now = d.moduleData.get(c.object.module, scopeKey, c.object.key);
    if (c.change === 'added') {
      if (!now) return 'gone';
      return now.version === c.versionAfter ? null : 'changed';
    }
    if (c.change === 'edited') {
      if (!c.held) return 'large';
      if (!hold) return 'old';
      if (!now) return 'gone';
      return now.version === c.versionAfter ? null : 'changed';
    }
    if (c.change === 'deleted') {
      if (!c.held) return 'large';
      if (!hold) return 'old';
      return hold.items.some((item) => d.moduleData.get(c.object.module, scopeKey, item.key)) ? 'taken' : null;
    }
    return 'gone';
  }

  // Undoes the object change `c` as ctx's person (moduleAccessAt for the change's module in its space, 'own'). Answers
  // null when done, or a refusal { status, error }. The person must be able to make that change themselves: the module's
  // write permission (ctx), and its guards for the write or the delete, as them.
  function undoChange(ctx, c, { tz = null } = {}) {
    const id = c.object.module;
    const hold = c.change === 'added' ? null : d.moduleHolds.readKeyed(id, c.id);
    const why = undoProblem(c, hold);
    if (why) return { status: 409, error: UNDO_WHY[why] };
    if (c.change === 'added') {
      const out = removeObject(ctx, c.object.key, { expected: c.versionAfter, tz });
      return out.error ? { status: out.status, error: out.error } : null;
    }
    if (c.change === 'edited') {
      const out = d.putModuleValue(ctx, c.object.key, hold.items[0].value, { expected: c.versionAfter, tz });
      if (out.error) return { status: out.status, error: out.error };
      d.moduleHolds.dropKeyed(id, c.id);
      return null;
    }
    // A delete: the person must be one who could have made that change, so one the module's guards would let delete the
    // object as it was (an owner or the admin puts back someone else's object, which they could not create in that name).
    const guards = d.guardsAt(ctx);
    if (guards && hold.items.length) {
      const refused = d.moduleGuards.checkDelete(guards, { key: hold.items[0].key, before: hold.items[0].value, who: d.guardWho(ctx), read: d.storedValue(ctx) });
      if (refused) return { status: refused.status, error: refused.error };
    }
    const result = d.moduleData.restoreMany(id, ctx.scopeKey, hold.items, { by: ctx.by });
    if (result.taken.length) return { status: 409, error: UNDO_WHY.taken };
    // Other modules hear it is back: a Calendar copy is made again (object-sync), as after a Clear's Undo.
    for (const item of hold.items) {
      try { d.objectSync.afterWrite({ module: id, scopeKey: ctx.scopeKey, key: item.key, before: null, after: item.value, by: ctx.by, tz: tz || hold.tz }); } catch (err) { if (!err || err.status !== 413) throw err; }
    }
    // The holders it took or marked come back as they were, only where nothing changed them since.
    for (const h of hold.holders) {
      try {
        const now = d.moduleData.get(h.module, h.scopeKey, h.key);
        if (h.removed) {
          if (now) continue;
          d.moduleData.restoreMany(h.module, h.scopeKey, [{ key: h.key, value: h.value, version: h.version, updatedAt: h.updatedAt, by: h.by }], { by: ctx.by });
          if (Array.isArray(h.links) && h.links.length) d.moduleLinks.set({ module: h.module, kind: h.kind, id: h.id, scope: h.scopeKey === 'environment' ? 'environment' : 'space', ...(h.scopeKey.startsWith('space:') ? { space: h.scopeKey.slice(6) } : {}) }, h.links, ctx.by);
        } else if (now && now.version === h.version + 1) {
          d.moduleData.put(h.module, h.scopeKey, h.key, h.value, { expected: now.version, by: ctx.by });
        }
      } catch (err) {
        if (!err || !err.status) throw err; // a holder that can't be written back stays as it is
      }
    }
    d.moduleHolds.dropKeyed(id, c.id);
    return null;
  }

  // A keyed hold whose time is over (server/module-holds.js onKeyedExpire): the files only it kept go, unless a value stored
  // there names one now.
  function finishKeyed(hold) {
    if (!hold.files || !hold.files.length) return;
    const stored = d.moduleData.list(hold.module, hold.scopeKey).map((item) => item.value);
    for (const fid of hold.files) {
      if (d.moduleGuards.namesFile(stored, fid)) continue;
      if (d.moduleHolds.keyedHoldsFile(hold.module, hold.scopeKey, fid)) continue;
      try { d.moduleUploads.remove(hold.module, hold.scopeKey, fid); } catch (err) { console.error(`A deleted object's file could not be removed: ${err.message}`); }
    }
  }

  return { removeObject, removeRefusal, goesWith, holdEdit, undoProblem, undoChange, finishKeyed, holdersOf };
}

module.exports = { createDeletePath, UNDO_WHY };
