// Maps' actions (plan-agent-server-actions.md, section 7): one copy of the rules for what other modules and agents ask of
// Maps, run by the server for an agent's request (module.json actions.server) and by the page for everyone else's
// (host.actions.fromLibrary in maps-lib-g-list-view.js). Plain data in, plain answer out: no page, no network.
//   - addPlace: a new place, kept where `in` says (environment, space or person; left out, for everyone and shown in this
//     space). An environment place is always marked for this space. With an address and no position, the server's place
//     search for the address (the manifest's `lookups`, ctx.lookups.address) gives the position when it is one clear match
//     (every result within 60 metres of the first); otherwise the place is saved without one and the note says why, with the
//     matches when there were several.
//   - updatePlace, setPlacePoint: a place of this space, or the environment's marked for this space, followed through a
//     forward when it moved.
//   - findPlace: the place search's matches as the note, changing nothing.
// A place kept for the person ("person" in `in`, or the bookmark beside a shared one) is a write with scope 'person': the
// server refuses it for an agent, and the page for anyone's request but the page person's own.
// The model is the list's (maps-lib-f-list-model.js listModel), with the SDK's geo and word helpers from ctx.util.

const MAPS_ACTION_MODULE = 'maps';

// The list's model, for one request.
function mapsActionModel(ctx) {
  return listModel(ctx.util.geo, LIB_TYPES, ctx.util.word);
}
// The owner's category list (the module's `categories` setting), as the page reads it; the defaults when it has no Other.
function mapsActionCats(M, settings) {
  const list = settings && Array.isArray(settings.categories) ? settings.categories.filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string' && c.label) : [];
  return list.length && list.some((c) => c.id === 'other') ? list.map((c) => ({ id: c.id, label: c.label, icon: c.icon || 'note-sticky', color: c.color || M.AUTO_COLOR })) : M.DEFAULT_CATEGORIES;
}
// Whether a place search is set up: a service chosen, and no picture map (an invented world the service does not know).
function mapsActionSearchOn(M, settings) {
  const s = settings || {};
  return M.searchOn(s) && !(typeof s.imageMap === 'string' && s.imageMap);
}
// A pointer to a place in `scope` ('space': this space's, 'environment', 'person').
function mapsActionRef(ctx, scope, id) {
  return scope === 'space' ? { module: MAPS_ACTION_MODULE, kind: 'place', id, scope: 'space', space: ctx.space.id } : { module: MAPS_ACTION_MODULE, kind: 'place', id, scope };
}
// The write of a place in `scope`: marks only on the environment's places.
function mapsActionWrite(M, scope, p) {
  const value = M.placeValue({ ...p, spaces: scope === 'environment' ? p.spaces : [] });
  return { key: M.PLACE_PREFIX + p.id, value, ...(scope === 'space' ? {} : { scope }) };
}
// The place a pointer names, where this request may read it: this space's own, or the environment's marked for this space,
// through a forward when it moved. { scope, p }, or a throw.
function mapsActionPlaceOf(M, ctx, ref) {
  if (!ref || typeof ref !== 'object' || ref.module !== MAPS_ACTION_MODULE || ref.kind !== 'place' || typeof ref.id !== 'string') throw new Error('that is not a place');
  const scopeOf = (h) => (h.scope === 'environment' ? 'environment' : h.scope === 'space' && (!h.space || h.space === ctx.space.id) ? 'space' : null);
  let scope = scopeOf(ref);
  const id = ref.id;
  for (let hop = 0; scope && hop < 4; hop += 1) {
    const v = ctx.read(M.PLACE_PREFIX + id, scope);
    if (!v) break;
    const p = M.cleanPlace(id, v);
    if (p) return { scope, p };
    const f = M.cleanForward(v);
    if (!f) break;
    scope = scopeOf(f.movedTo);
  }
  throw new Error('there is no such place, or it is no longer shared here');
}
// The matches of a place search, as an agent reads them: at most 5 { name, address, lat, lng }.
function mapsActionMatches(ctx, found) {
  const geo = ctx.util.geo;
  return (Array.isArray(found) ? found : []).filter((h) => h && geo.inRange(Number(h.lat), Number(h.lng))).slice(0, 5)
    .map((h) => ({ name: geo.oneLine(h.title, 80), address: geo.oneLine(h.sub, 120), lat: geo.round6(Number(h.lat)), lng: geo.round6(Number(h.lng)) }));
}
const MAPS_ACTION_SEARCH_OFF = 'Place search is off. An admin chooses one in the Maps settings.';

const ACTION_HANDLERS = {
  // A new place. Where it is kept follows `in` (Maps' Shows in: everyone, this space, the person's own list), and when left out
  // it is everyone's and shown in this space. The asker is its maker (ctx.credit).
  addPlace(input, ctx) {
    const M = mapsActionModel(ctx);
    const geo = ctx.util.geo;
    const word = ctx.util.word;
    const here = ctx.space && ctx.space.id;
    if (!here) throw new Error(`there is no ${word('space')} here to add it to`);
    const i = input || {};
    const asked = M.ticksFromIn(i.in, here) || { everyone: true, spaces: [here], mine: false };
    // An environment place made from a space shows in that space too.
    if (asked.everyone && !asked.spaces.includes(here)) asked.spaces = [...asked.spaces, here];
    const target = M.homeFor(asked);
    if (target.error) throw new Error(target.error === 'spaces' ? `to show it in more than one ${word('space')}, it must be in the ${word('environment')} too` : 'say where it goes');
    const place = M.placeFromRequest(i, (ctx.credit && ctx.credit.key) || '', ctx.people);
    const notes = [];
    let data = {};
    // An address and no position: the server's place search for it (ctx.lookups.address), one clear match only.
    if (!place.point && place.address) {
      if (!mapsActionSearchOn(M, ctx.settings)) notes.push(`Saved without a position, since place search is off. An admin chooses one in the Maps settings.`);
      else {
        const found = (ctx.lookups && Array.isArray(ctx.lookups.address) ? ctx.lookups.address : []).filter((h) => h && geo.inRange(Number(h.lat), Number(h.lng)));
        const first = M.oneClear(found);
        const q = geo.oneLine(i.address, 200);
        if (first) {
          place.point = { lat: geo.round6(Number(first.lat)), lng: geo.round6(Number(first.lng)) };
          if (typeof first.key === 'string' && first.key) place.origin = first.key.slice(0, 60);
          notes.push(`Placed at ${[geo.oneLine(first.title, 80), geo.oneLine(first.sub, 120)].filter(Boolean).join(', ')}: ${place.point.lat}, ${place.point.lng}.`);
        } else if (!found.length) {
          notes.push(`Saved without a position: found nothing for "${geo.oneLine(q, 80)}". Give one with setPlacePoint.`);
        } else {
          const results = mapsActionMatches(ctx, found);
          notes.push(`Saved without a position: the address matches more than one place. Give one with setPlacePoint. ${M.findNote(q, results)}`);
          data = { results };
        }
      }
    }
    place.id = ctx.util.id();
    place.spaces = target.marks;
    place.icon = M.lookOf(place, mapsActionCats(M, ctx.settings)).icon;
    const scope = target.scope;
    const ref = mapsActionRef(ctx, scope, place.id);
    const writes = [mapsActionWrite(M, scope, place)];
    // Mine beside a shared home: a bookmark in the person's own list.
    if (target.mine) writes.push({ key: M.bookmarkKey(ref), value: { ref, title: place.title }, scope: 'person' });
    // What it was made from: linked when the place is this space's (a link from the environment's data is not made here).
    const links = place.ref && scope === 'space' ? [{ add: { from: ref, to: place.ref } }] : [];
    if (place.ref && scope !== 'space') notes.push(`It is not linked to what it was made from, since it is kept ${scope === 'environment' ? 'for everyone' : 'for one person'}.`);
    const note = notes.join(' ').slice(0, 300);
    return { writes, ref, ...(links.length ? { links } : {}), ...(note || Object.keys(data).length ? { data: { ...(note ? { note } : {}), ...data } } : {}) };
  },

  // Give a saved place a position.
  setPlacePoint(input, ctx) {
    const M = mapsActionModel(ctx);
    const geo = ctx.util.geo;
    const { scope, p } = mapsActionPlaceOf(M, ctx, input && input.place);
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    if (!geo.inRange(lat, lng)) throw new Error('the coordinates are out of range');
    const place = { ...p, point: { lat: geo.round6(lat), lng: geo.round6(lng) } };
    return { writes: [mapsActionWrite(M, scope, place)], ref: mapsActionRef(ctx, scope, p.id) };
  },

  // Change a place's title, type, category, status, address, notes or who it is for: only the fields given change.
  updatePlace(input, ctx) {
    const M = mapsActionModel(ctx);
    const { scope, p } = mapsActionPlaceOf(M, ctx, input && input.place);
    const place = M.placeChanged(p, input, (ctx.credit && ctx.credit.key) || '', ctx.people);
    if (!place.iconOwn) place.icon = M.lookOf(place, mapsActionCats(M, ctx.settings)).icon;
    return { writes: [mapsActionWrite(M, scope, place)], ref: mapsActionRef(ctx, scope, p.id) };
  },

  // A few matches to pick from for setPlacePoint (Maps issue 1077), as the note request_status shows an agent. Off when no
  // place search is chosen, and then nothing is searched.
  findPlace(input, ctx) {
    const M = mapsActionModel(ctx);
    const geo = ctx.util.geo;
    if (!mapsActionSearchOn(M, ctx.settings)) throw new Error(MAPS_ACTION_SEARCH_OFF);
    const q = geo.oneLine(input && input.q, 200);
    if (q.length < 2) throw new Error('nothing to look for');
    const results = mapsActionMatches(ctx, ctx.lookups && ctx.lookups.q);
    return { data: { note: M.findNote(q, results), results } };
  },
};
