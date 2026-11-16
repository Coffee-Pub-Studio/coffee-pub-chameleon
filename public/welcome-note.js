// The welcome note (GitHub #870), the page's half: one short text the owner writes (Manage > Environment > Welcome note),
// shown once at a person's first sign-in and from the Welcome entry any time after.
//   loadWelcome()        GET /api/environment/welcome: { note, seen, guest, maxLength } or null when it can't be asked.
//   welcomeNow()         the last answer; `hasWelcome()` is true when there is a note this page can draw.
//   showWelcome()        the note in the SDK's one dialog (confirm.js), drawn only by hostText.markdown; "Got it" (or any
//                        way of closing it) marks it seen.
//   welcomeOnArrival()   the first-sign-in showing: loads, and shows the note once when there is one this person has not seen.
// A guest has nothing stored on the server (it answers guest: true and seen is always false), so a guest's mark is kept
// in sessionStorage, and the page works without it.
import { confirmDialog } from '/confirm.js';

const KEY = 'welcome-seen';
let view = null;
let asked = false; // the arrival showing is once per page load
let query = ''; // a guest link's guest has no cookie: ?guest=<token>&pass=<pass> says who is asking, as space.js does

const markedHere = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const markHere = () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* no storage: the page works without it */ } };

function take(v) {
  if (!v || typeof v !== 'object') return null;
  const seen = v.guest ? markedHere() : Boolean(v.seen);
  view = { note: v.note && typeof v.note.text === 'string' && v.note.text ? v.note : null, seen, guest: Boolean(v.guest), maxLength: Number(v.maxLength) || 4000 };
  return view;
}

export async function loadWelcome() {
  try {
    const res = await fetch(`/api/environment/welcome${query}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    return take(await res.json());
  } catch {
    return null;
  }
}
export const welcomeNow = () => view;
export const hasWelcome = () => Boolean(view && view.note && window.hostText && typeof window.hostText.markdown === 'function');

async function markSeen() {
  if (!view || view.seen) return;
  view.seen = true;
  if (view.guest) { markHere(); return; }
  try { await fetch(`/api/environment/welcome/seen${query}`, { method: 'POST' }); } catch { /* it is asked again at the next sign-in */ }
}

export async function showWelcome() {
  if (!hasWelcome()) return;
  try {
    await confirmDialog({ title: 'Welcome', html: window.hostText.markdown(view.note.text), action: 'Got it', single: true });
  } catch {
    return; // the dialog could not be drawn: not marked seen
  }
  markSeen();
}

// `link`: { token, pass } for a guest who came in by a guest link; nothing for everyone else (a cookie says who they are).
export async function welcomeOnArrival(link = null) {
  if (asked) return;
  asked = true;
  if (link && link.token) query = `?${new URLSearchParams({ guest: link.token, pass: link.pass || '' })}`;
  await loadWelcome();
  if (hasWelcome() && !view.seen) await showWelcome();
}
