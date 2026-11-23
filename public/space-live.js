// The live stream (documentation/plans/plan-realtime-optional-livekit.md, steps 2 and 3): one server-sent stream per
// page, GET /api/live?space=<id> while the page is in a space or an aside, GET /api/live on Home. It says who is there
// (`presence`, the whole list on connect and on every change) and what happens in the chat (the space's and the Lobby's,
// Home's chat) and the asides' nudges for this person (step 4), and the page says its own state with PATCH /api/spaces/:id/presence (in the space is the stream being
// open; away, its message and on the call are said). space.js opens it on entering and on Home; who is here, the
// conference's "Not in a call" list, Start or Join call, the tiles' away and the chat read it.
//
// The stream drops (a network blip, a server restart): it is opened again after 2, 4, 8 seconds and so on, up to a
// minute between tries, for as long as the page stays in the space. Each opening is a new stream with a new id, so the
// page's state is said again on every `ready` (onReady). A refusal (401, 403 or 404 when asked again) or the server's
// `removed` (the access gone, or a kick) ends it for good (onEnd); 429 (too many open) is tried again later, since an old stream of the same person
// may still be closing. Nothing here reads the page's globals: space.js hands in what it needs, so a check can run it
// against a stand-in EventSource and clock.

export const LIVE_RETRY_FIRST_MS = 2000;
export const LIVE_RETRY_MAX_MS = 60000;

// The wait before the `tries`th try again (1, 2, 3, ...): 2 s, 4 s, 8 s, ... never more than a minute.
export function liveRetryDelay(tries) {
  const n = Math.max(1, Math.floor(Number(tries) || 1));
  return Math.min(LIVE_RETRY_MAX_MS, LIVE_RETRY_FIRST_MS * 2 ** Math.min(n - 1, 16));
}

// The stream's address: the space (or aside), none on Home; a guest adds their link's token and their guest pass (POST
// /api/guest-join), by which the server knows them.
export function liveStreamUrl({ space = null, guest = null, pass = '' } = {}) {
  const q = new URLSearchParams();
  if (space) q.set('space', space);
  if (guest) {
    q.set('guest', guest);
    if (pass) q.set('pass', pass);
  }
  const query = String(q);
  return query ? `/api/live?${query}` : '/api/live';
}

// The people of a `presence` event as who is here lists them: { key, name, you, onCall, away, awayMessage, layout }, you first,
// then by name. `you` is the key the stream's `ready` gave; `youName` names you when the list does not have you yet (the
// first event is on its way, or the stream is reconnecting); `meOnCall` is the page's own say about the call (it knows
// before the server echoes it back), and `meLayout` the tab the page shows (likewise). `layout` is the tab each person is
// on (the server's: a fixed layout's id, a layout for everyone's id, 'personal' for their own one, or null).
export function peopleFromPresence(list, { you = null, youName = '', meOnCall = false, meLayout = null } = {}) {
  const out = [];
  const others = [];
  let mine = null;
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p.key !== 'string' || !p.key) continue;
    const person = { key: p.key, name: String(p.name || p.key), you: p.key === you, onCall: Boolean(p.onCall), away: Boolean(p.away), awayMessage: p.away ? String(p.awayMessage || '') : '', layout: typeof p.layout === 'string' && p.layout ? p.layout : null };
    if (person.you) mine = person;
    else others.push(person);
  }
  if (you) {
    const me = mine || { key: you, name: youName || you, you: true, onCall: false, away: false, awayMessage: '', layout: null };
    out.push({ ...me, onCall: Boolean(meOnCall), ...(meLayout ? { layout: meLayout } : {}) });
  }
  others.sort((a, b) => a.name.localeCompare(b.name));
  return out.concat(others);
}

// Open the stream. `url` is liveStreamUrl's; `onReady({ you, space, stream }, first)` on every opening (`first` true
// only the first time, so the page catches up on the others), `onPresence(people)` on every presence event for this
// space, `onChat(data)` on every chat event (`chat`, `chat-delete`, ... each with its `space`), `onAside(data)` on every
// aside nudge (`aside-pull`, `aside-started`, `aside-recall`, `aside-return`, each with its `spaceId`), `onBring(data)` on
// every Bring everyone here (`layout-bring`, `layout-bring-cancel`, each with its `spaceId` and `bring`), `onState('live' |
// 'reconnecting')` as it goes, `onEnd({ reason, error })` once when it ends for good (never on close()); `reason` is the
// server's (`access`, `kicked`) or `refused` (with `status`, and `error`, the server's sentence, when the probe had one).
// `probe(url)` answers the HTTP status of a fresh request (0 when the server was not reached), or { status, error }, asked
// after a stream that never opened, to tell a refusal from a drop. Answers { close, ready }:
// `ready` is the last `ready`'s data while the stream is open, else null.
export const ASIDE_NUDGES = ['aside-pull', 'aside-started', 'aside-recall', 'aside-return'];
// Bring everyone here (plan-workspaces.md, decisions 36 and 48): `onBring(data)` on each, with its `spaceId` and `bring`.
export const BRING_NUDGES = ['layout-bring', 'layout-bring-cancel'];

// The people on one tab, as its faces show them: you first, then the rest in the list's order; at most `max` faces and
// the count of the rest (`more`, the "+N"). `all` is everyone on it.
export function facesOnTab(people, layout, max = 3) {
  const all = (Array.isArray(people) ? people : []).filter((p) => p && p.layout === layout);
  const mine = all.filter((p) => p.you);
  const ordered = mine.concat(all.filter((p) => !p.you));
  const shown = ordered.slice(0, Math.max(0, max));
  return { all: ordered, shown, more: ordered.length - shown.length };
}

// What a page does with a `layout-bring` (pure, for check-bring-everyone): 'warn' (the 5-second warning, then the move),
// or 'ignore'. Ignored: a message for another space; a page in an aside (only the call is there) or with no space; a
// page already on that tab; a tab this person can't open (`canOpen` false: a guest, a module off for them); the mover's
// own (`you` is `by`'s key when it says it, which it does not: the server sends it to the others only).
export function bringAction({ data, spaceId, aside = false, current = null, canOpen = false } = {}) {
  if (!data || data.type !== 'layout-bring' || typeof data.layout !== 'string' || typeof data.bring !== 'string') return 'ignore';
  if (!spaceId || aside || data.spaceId !== spaceId) return 'ignore';
  if (current === data.layout || !canOpen) return 'ignore';
  return 'warn';
}

// How many stayed where they were after a bring to `layout`, for the mover: the others whose page says it is on another
// tab. Those who say nothing (a guest, a page still loading) are not counted either way.
export function stayedCount(people, layout) {
  return (Array.isArray(people) ? people : []).filter((p) => p && !p.you && typeof p.layout === 'string' && p.layout && p.layout !== layout).length;
}

export function openLiveStream({ url, onReady = () => {}, onPresence = () => {}, onChat = () => {}, onAside = () => {}, onBring = () => {}, onState = () => {}, onEnd = () => {}, probe = async () => 0, EventSourceImpl = globalThis.EventSource, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) }) {
  let source = null;
  let timer = null;
  let tries = 0;
  let stopped = false;
  let ready = null;
  let readies = 0;
  let suspended = false;
  let generation = 0; // suspend() moves it on: an `again` that began before it does not go on
  const stop = () => {
    stopped = true;
    ready = null;
    if (timer !== null) cancel(timer);
    timer = null;
    source?.close();
    source = null;
  };
  const end = (why) => {
    if (stopped) return;
    stop();
    onEnd(why);
  };
  const again = async (wasLive) => {
    const mine = generation;
    ready = null;
    if (suspended) return;
    onState('reconnecting');
    if (!wasLive) {
      const answer = await probe(url);
      if (stopped || suspended || mine !== generation) return;
      const { status = 0, error = '' } = typeof answer === 'number' ? { status: answer } : answer || {};
      if (status === 401 || status === 403 || status === 404) return end({ reason: 'refused', status, error });
    }
    tries += 1;
    timer = schedule(open, liveRetryDelay(tries));
  };
  function open() {
    timer = null;
    if (stopped || suspended) return;
    const es = new EventSourceImpl(url);
    let live = false;
    es.addEventListener('message', (event) => {
      if (source !== es) return;
      let data = null;
      try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ready') {
        live = true;
        tries = 0;
        ready = { you: data.you, space: data.space, stream: data.stream };
        readies += 1;
        onState('live');
        onReady(ready, readies === 1);
      } else if (data.type === 'presence') {
        if (live && Array.isArray(data.people)) onPresence(data.people);
      } else if (typeof data.type === 'string' && data.type.startsWith('chat')) {
        if (live && typeof data.space === 'string') onChat(data);
      } else if (ASIDE_NUDGES.includes(data.type)) {
        if (live && typeof data.spaceId === 'string' && data.spaceId) onAside(data);
      } else if (BRING_NUDGES.includes(data.type)) {
        if (live && typeof data.spaceId === 'string' && data.spaceId && typeof data.bring === 'string') onBring(data);
      } else if (data.type === 'removed') {
        end({ reason: data.reason || 'removed', error: data.error || '' });
      }
    });
    es.addEventListener('error', () => {
      if (source !== es) return;
      es.close();
      source = null;
      again(live);
    });
    source = es;
  }
  // The page is leaving (pagehide): close the connection and any pending retry, so a page kept in the browser's
  // back-forward cache holds none of the browser's few connections. resume() opens it again (pageshow, persisted): a new
  // stream with a new `ready`, which the page treats as any reconnect (it catches up, and says its state again).
  const suspend = () => {
    if (stopped || suspended) return;
    suspended = true;
    generation += 1;
    ready = null;
    if (timer !== null) cancel(timer);
    timer = null;
    source?.close();
    source = null;
  };
  const resume = () => {
    if (stopped || !suspended) return;
    suspended = false;
    tries = 0;
    onState('reconnecting');
    open();
  };
  open();
  return { close: stop, suspend, resume, get ready() { return ready; } };
}
