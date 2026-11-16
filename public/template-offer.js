// A template's offer after a switch (plan-environment-templates.md, "Addendum: switching a template", GitHub #59), shared
// by Manage's Template tab and the host console's environment card. The offer is what the server answers with a switch:
// { modules: [{ id, name, allowed, why? }], lobby: { name, description } | null, spaceDefaults: { profile?, opensWith? } | null,
// reactions: [{ id, glyph, label }] | null, iconSet: [Font Awesome names] | null } (addendum 2, "templates grow"; no theme: the
// theme left templates, plan-templates-redesign.md decision 13).
// Modules are ticked by default; one the plan leaves out is shown unticked and disabled, with the server's why. The
// Lobby, the new-space profile, the reactions and the icons are unticked (the Lobby's words are the owner's by now). Apply sends what is ticked
// ({ offerId, version, modules, lobby, spaceDefaults, reactions, iconSet, starterSpaces }); even with nothing ticked it closes the offer.
// Not now only hides it here. The starter spaces (offer.starterSpaces: [{ index, name, description }], only for a switch not yet
// confirmed) are offered unticked; the ticked ones are sent by their index and made once. offerId and version go back exactly as the offer gave them.
import { escapeHtml, word } from '/brand.js';
import { shiftSentences } from '/template-choice.js';

const sentence = (text) => {
  const t = String(text || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : '';
};
const PROFILE_LABELS = { roleplaying: 'Roleplaying', participants: 'Participants', characters: 'Characters' };

// The sentence after a confirm that made starter spaces: 'Made 2 spaces: Kickoff, Planning.' ('' when none). `ticked` are the
// indexes sent, `made` the ids the server answered with.
export function madeSentence(offer, ticked, made) {
  const got = (made || []).length;
  if (!got) return '';
  const names = (ticked || []).map((i) => ((offer && offer.starterSpaces) || []).find((sp) => sp.index === i)?.name).filter(Boolean);
  const noun = (n) => word('space', { many: n !== 1 });
  const lead = got < (ticked || []).length ? `Made ${got} of ${ticked.length} ${noun(ticked.length)}` : `Made ${got} ${noun(got)}`;
  return `${lead}${names.length && got === names.length ? `: ${names.join(', ')}` : ''}.`;
}

// The question before a switch (the options for confirmDialog): what changes at once, which modules turn off and on in the
// spaces that read the template (`shift`, from moduleShift), and that their data is kept. `name` is the template's.
export function switchConfirm(name, shift = null) {
  const where = `In every ${word('space')} that reads it,`;
  return { title: `Switch to the ${name} template?`, message: `Words, icons and ${word('module')} names change now. ${shiftSentences(shift, where, word)} Nothing is deleted. Then you choose what else it turns on.`, action: 'Switch' };
}

// True when the offer has anything to tick.
const hasExtras = (offer) => Boolean(offer && (offer.lobby || offer.spaceDefaults || offer.reactions || (offer.iconSet && offer.iconSet.length)));
export const offerHasChoices = (offer) => Boolean(offer && ((offer.modules || []).length || hasExtras(offer)));

// Draws the offer into `box`. `templateName` names the template; `lobbyName` is the Lobby's name as the environment has
// it (the console doesn't know it: "the Lobby"). `apply(body)` sends the confirmed part and resolves once the caller has
// redrawn; `later()` hides the offer. Errors from apply are shown in the box as the server sent them.
// `notice`: a refusal to show in the status line at first (the offer was read again after the server turned a confirm down).
export function renderOffer(box, { templateName, offer, lobbyName = '', apply, later, notice = '' }) {
  const lobby = !lobbyName || lobbyName === 'Lobby' ? 'the Lobby' : lobbyName; // as a sentence reads it
  const mods = (offer && offer.modules) || [];
  const uid = `offer-${Math.random().toString(36).slice(2, 8)}`;
  const moduleRow = (m) => {
    const why = m.allowed ? '' : sentence(m.why);
    return `<label class="sdk-choice-row${m.allowed ? '' : ' offer-refused'}"><input type="checkbox" data-offer-module="${escapeHtml(m.id)}"${m.allowed ? ' checked' : ' disabled'}> <span><strong>${escapeHtml(m.name || m.id)}</strong>${why ? ` <span class="hint">${escapeHtml(why)}</span>` : ''}</span></label>`;
  };
  const lobbyRow = () => {
    const l = offer.lobby;
    const renames = l.name && l.name !== lobbyName;
    const text = renames ? `Name ${escapeHtml(lobby)} "${escapeHtml(l.name)}"` : `Give ${escapeHtml(lobby)} the template's description`;
    return `<label class="sdk-choice-row"><input type="checkbox" data-offer-lobby> <span>${text}${l.description ? ` <span class="hint">${escapeHtml(l.description)}</span>` : ''}</span></label>`;
  };
  const profileRow = () => {
    const defaults = offer.spaceDefaults;
    const p = defaults.profile;
    const profile = p ? `New ${escapeHtml(word('space', { many: true }))} use the ${escapeHtml(PROFILE_LABELS[p] || p)} profile` : '';
    const names = (defaults.opensWith || []).map((id) => {
      const offered = (offer.modules || []).find((m) => m.id === id);
      if (offered && offered.name) return offered.name;
      if (id === 'chat') return 'Chat';
      if (id === 'conference') return 'Conference';
      return id;
    });
    const opens = names.length === 1
      ? `A new ${escapeHtml(word('space'))} opens ${escapeHtml(names[0])}`
      : names.length > 1
        ? `A new ${escapeHtml(word('space'))} opens ${names.slice(0, -1).map(escapeHtml).join(', ')} and ${escapeHtml(names[names.length - 1])}`
        : '';
    const text = [profile, opens].filter(Boolean).join('. ');
    return `<label class="sdk-choice-row"><input type="checkbox" data-offer-space-defaults> <span>${text}</span></label>`;
  };
  const reactionsRow = () => {
    const list = offer.reactions;
    const glyphs = list.map((r) => r.glyph).join(' ');
    return `<label class="sdk-choice-row"><input type="checkbox" data-offer-reactions> <span>${list.length ? 'Use its reactions' : 'Turn reactions off'}${glyphs ? ` <span class="offer-glyphs">${escapeHtml(glyphs)}</span>` : ''} <span class="hint">Replaces the reactions you have.</span></span></label>`;
  };
  const iconSetRow = () => {
    const names = offer.iconSet;
    const shown = names.slice(0, 12).map((n) => `<i class="fa-solid fa-${escapeHtml(n)} fa-fw" aria-hidden="true"></i>`).join('');
    return `<label class="sdk-choice-row"><input type="checkbox" data-offer-icon-set> <span>Add its ${names.length === 1 ? 'icon' : `${names.length} icons`} to the icon list <span class="offer-icons">${shown}</span></span></label>`;
  };
  const starters = (offer && offer.starterSpaces) || [];
  const starterRow = (sp) => `<label class="sdk-choice-row"><input type="checkbox" data-offer-starter="${escapeHtml(String(sp.index))}"> <span><strong>${escapeHtml(sp.name)}</strong>${sp.description ? ` <span class="hint">${escapeHtml(sp.description)}</span>` : ''}</span></label>`;
  const any = offerHasChoices(offer) || starters.length > 0;
  box.innerHTML = `
    <div class="template-offer" role="group" aria-labelledby="${uid}">
      <h3 id="${uid}">What the ${escapeHtml(templateName)} template can add</h3>
      ${offerHasChoices(offer) ? `<p class="hint">Untick anything you don't want.</p>` : starters.length ? `<p class="hint">Tick what you want.</p>` : `<p class="hint">Nothing more to add: what it lists is already on.</p>`}
      ${mods.length ? `<div class="offer-group"><span class="field-label">Turn on</span>${mods.map(moduleRow).join('')}<p class="hint">Each goes on in every ${escapeHtml(word('space'))}. ${escapeHtml(lobby[0].toUpperCase() + lobby.slice(1))} keeps only chat, the call and ${escapeHtml(word('module', { many: true }))} made for it.</p></div>` : ''}
      ${hasExtras(offer) ? `<div class="offer-group"><span class="field-label">Also</span>${offer.lobby ? lobbyRow() : ''}${offer.spaceDefaults ? profileRow() : ''}${offer.reactions ? reactionsRow() : ''}${offer.iconSet && offer.iconSet.length ? iconSetRow() : ''}</div>` : ''}
      ${starters.length ? `<div class="offer-group" data-offer-starters><span class="field-label">${escapeHtml(word('space', { many: true, cap: true }))} to start with</span>${starters.map(starterRow).join('')}<p class="hint">Tick the ones to make now. They are made once; each starts with what the template gives it.</p></div>` : ''}
      <div class="row">
        <button class="btn btn-primary" type="button" data-offer-apply>${any ? 'Apply' : 'Done'}</button>
        <button class="btn" type="button" data-offer-later>Not now</button>
        <span class="status" data-offer-status role="status" tabindex="-1"></span>
      </div>
    </div>`;
  box.hidden = false;
  const status = box.querySelector('[data-offer-status]');
  if (notice) { status.textContent = notice; status.classList.add('error'); }
  box.querySelector('[data-offer-later]').addEventListener('click', () => later && later());
  let busy = false; // a second activation while a request is in flight does nothing
  box.querySelector('[data-offer-apply]').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const body = {
      offerId: offer && offer.offerId,
      version: offer && offer.version,
      starterSpaces: [...box.querySelectorAll('[data-offer-starter]:checked')].map((i) => Number(i.dataset.offerStarter)),
      modules: [...box.querySelectorAll('[data-offer-module]:checked:not(:disabled)')].map((i) => i.dataset.offerModule),
      lobby: Boolean(box.querySelector('[data-offer-lobby]')?.checked),
      spaceDefaults: Boolean(box.querySelector('[data-offer-space-defaults]')?.checked),
      reactions: Boolean(box.querySelector('[data-offer-reactions]')?.checked),
    };
    // Sent only when offered, so a server without icon sets never sees the field.
    if (offer && offer.iconSet) body.iconSet = Boolean(box.querySelector('[data-offer-icon-set]')?.checked);
    const buttons = box.querySelectorAll('button, input');
    for (const b of buttons) b.disabled = true;
    status.classList.remove('error');
    status.textContent = body.starterSpaces.length ? `Making ${body.starterSpaces.length === 1 ? `1 ${word('space')}` : `${body.starterSpaces.length} ${word('space', { many: true })}`}...` : body.modules.length ? `Turning on ${body.modules.length === 1 ? `1 ${word('module')}` : `${body.modules.length} ${word('module', { many: true })}`}...` : 'Applying...';
    try {
      await apply(body);
    } catch (err) {
      for (const b of buttons) b.disabled = b.matches('[data-offer-module]') && b.closest('.offer-refused') ? true : false;
      status.textContent = err.message; // the server's own sentence
      status.classList.add('error');
    } finally {
      busy = false;
    }
  });
}
