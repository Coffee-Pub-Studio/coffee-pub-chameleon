/* The Design System page's catalog, part 1: controls (buttons, fields, choices, pickers, links, the call's buttons). Each family is
   one family block of public/sdk/system.css (`/* <id>:start *\/ ... /* <id>:end *\/`; `block` names it when the id differs) or, said
   in its description, a look public/style.css still draws. Each look is the product's own markup with the classes the product
   uses, and only classes some rule of its stylesheets names (tools/check-design-system-catalog.mjs fails otherwise).
   `ctx` says which stylesheets the look is drawn with: 'app' (an app page: public/style.css, the theme and public/sdk/system.css),
   'host' (a module's page: public/sdk/system.css and public/sdk/host.css) or 'mod:<id>' (that, and the module's own stylesheet).
   `sel` is the selector the page finds the file and line for; `states` are the stylesheet's own :hover, :focus and :active rules,
   forced on. Nothing here is a style: only markup and words. */
window.DS_FAMILIES = window.DS_FAMILIES || [];
window.DS_NOT_MOUNTED = window.DS_NOT_MOUNTED || [];
(() => {
  const fa = (n, extra) => `<i class="fa-solid fa-${n}${extra ? ' ' + extra : ''}" aria-hidden="true"></i>`;
  window.DSH = { fa };
  const F = window.DS_FAMILIES;
  const row = (inner, gap = 8) => `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:${gap}px">${inner}</div>`;

  // ---- Buttons ----
  F.push({
    id: 'buttons', group: 'Controls', name: 'Buttons',
    desc: 'One button for the app and every module: <code>.btn</code> (words), <code>.sdk-btn</code> (the same look in a form) and <code>.sdk-icon-btn</code> (an icon only). The kind is a second class: <code>.btn-primary</code>, <code>.btn-danger</code> (add <code>.solid</code> for a final action), <code>.btn-quiet</code>; <code>.btn-small</code> is the 30px size. Pressed (a toggle) is <code>.on</code> or <code>aria-pressed="true"</code>; busy is <code>aria-busy="true"</code>.',
    variants: [
      { n: 'Secondary (the default)', ctx: 'app', sel: ':is(.btn, .sdk-btn, .sdk-icon-btn)', html: '<button type="button" class="btn">Cancel</button>', states: ['hover', 'focus', 'active', 'disabled'] },
      { n: 'Primary', ctx: 'app', sel: '.btn-primary', html: '<button type="button" class="btn btn-primary">Save</button>', states: ['hover', 'focus', 'active', 'disabled'] },
      { n: 'Danger', ctx: 'app', sel: '.btn-danger', note: 'An action that removes something, soft: a person can undo it or is asked first.', html: '<button type="button" class="btn btn-danger">Remove</button>', states: ['hover', 'focus', 'active', 'disabled'] },
      { n: 'Danger, solid (final)', ctx: 'app', sel: '.btn-danger.solid', note: 'Cannot be undone: the confirm\'s action for a final delete.', html: '<button type="button" class="btn btn-danger solid">Delete for good</button>', states: ['hover', 'focus', 'disabled'] },
      { n: 'Quiet', ctx: 'app', sel: '.btn-quiet', html: '<button type="button" class="btn btn-quiet">Not now</button>', states: ['hover', 'focus', 'active'] },
      { n: 'With an icon', ctx: 'app', sel: ':is(.btn, .sdk-btn) > :is(i, .ic)', html: row('<button type="button" class="btn">' + fa('plus') + ' Add</button><button type="button" class="btn btn-primary">' + fa('check') + ' Done</button>') },
      { n: 'Small (30px)', ctx: 'app', sel: '.btn-small', note: 'The toolbar, a card\'s head, the action bar. A phone keeps a 44px touch area around it.', html: row('<button type="button" class="btn btn-small btn-primary">Save</button><button type="button" class="btn btn-small">Cancel</button><button type="button" class="btn btn-small btn-danger">Discard</button>'), target: '.btn' },
      { n: 'Pressed (a toggle)', ctx: 'app', sel: '.btn.on', html: row('<button type="button" class="btn btn-small" aria-pressed="false">' + fa('filter') + ' Filter</button><button type="button" class="btn btn-small on" aria-pressed="true">' + fa('filter') + ' Filter</button>') },
      { n: 'Busy', ctx: 'app', sel: '[aria-busy="true"]', html: '<button type="button" class="btn btn-primary" aria-busy="true"><span class="sdk-spinner sdk-spinner-sm" aria-hidden="true"></span> Saving</button>' },
      { n: 'Form button .sdk-btn', ctx: 'host', sel: '.sdk-btn', note: 'The same button, in a form\'s line.', html: row('<button type="button" class="sdk-btn">Find</button><button type="button" class="sdk-btn primary">Save</button>'), target: '.sdk-btn', states: ['hover', 'focus', 'disabled'] },
      { n: 'Icon button .sdk-icon-btn', ctx: 'app', sel: '.sdk-icon-btn', note: 'Always with an aria-label. Secondary, Primary or Quiet; regular or small.', html: row('<button type="button" class="sdk-icon-btn" aria-label="Add">' + fa('plus') + '</button><button type="button" class="sdk-icon-btn btn-primary" aria-label="Send">' + fa('paper-plane') + '</button><button type="button" class="sdk-icon-btn btn-quiet" aria-label="More">' + fa('ellipsis-vertical') + '</button>'), target: '.sdk-icon-btn', states: ['hover', 'focus', 'active', 'disabled'] },
      { n: 'Icon button, small', ctx: 'app', sel: '.sdk-icon-btn.btn-small', html: row('<button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="Reply">' + fa('reply') + '</button><button type="button" class="sdk-icon-btn btn-quiet btn-small on" aria-pressed="true" aria-label="Keep">' + fa('bookmark') + '</button><button type="button" class="sdk-icon-btn btn-small" aria-label="Close">' + fa('xmark') + '</button>'), target: '.sdk-icon-btn', states: ['hover'] },
      { n: 'In a module', ctx: 'host', sel: '.btn', note: 'A module\'s page has the same rules (the server puts system.css in it).', html: row('<button type="button" class="btn">Cancel</button><button type="button" class="btn btn-primary">Save</button><button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="More">' + fa('ellipsis-vertical') + '</button>'), target: '.btn', states: ['hover', 'focus'] },
    ],
  });

  // ---- Fields ----
  const field = (label, input, hint = '', cls = '') => `<label class="sdk-field${cls ? ' ' + cls : ''}"><span class="sdk-label">${label}</span>${input}<span class="sdk-hint">${hint}</span></label>`;
  F.push({
    id: 'fields', group: 'Controls', name: 'Fields and forms',
    desc: 'The bare <code>input</code>, <code>select</code> and <code>textarea</code> are the field (system.css draws them, at no weight). A labelled field is <code>.sdk-field</code> with <code>.sdk-label</code>, the control and <code>.sdk-hint</code> or <code>.sdk-error</code>; a form is <code>.sdk-form</code> with <code>.sdk-form-row</code> and the widths <code>.sdk-s</code>, <code>.sdk-m</code>, <code>.sdk-l</code>, <code>.sdk-full</code>. An error is <code>aria-invalid="true"</code>.',
    variants: [
      { n: 'Text field', ctx: 'host', sel: '.sdk-field', html: '<form class="sdk-form" onsubmit="return false" style="width:240px">' + field('Title', '<input type="text" value="Flight to Lisbon">', 'A short hint under the field.') + '</form>', target: 'input', states: [{ n: 'Hover', force: 'hover' }, { n: 'Focus', force: 'focus' }, { n: 'Disabled', attrs: { disabled: '' } }, { n: 'Error', html: '<form class="sdk-form" onsubmit="return false" style="width:240px"><label class="sdk-field"><span class="sdk-label">Title</span><input type="text" aria-invalid="true" value=""><span class="sdk-error">Enter a title.</span></label></form>' }] },
      { n: 'Select and text area', wide: true, ctx: 'host', sel: ':where(select)', html: '<form class="sdk-form" onsubmit="return false"><div class="sdk-form-row">' + field('Class', '<select><option>Economy</option><option>Business</option></select>', '', 'sdk-m') + field('Seats', '<input type="number" value="2">', '', 'sdk-s') + '</div>' + field('Notes', '<textarea rows="3">Window seat if there is one.</textarea>', '', 'sdk-full') + '</form>' },
      { n: 'Optional label', wide: true, ctx: 'host', sel: '.sdk-optional', html: '<form class="sdk-form" onsubmit="return false"><label class="sdk-field"><span class="sdk-label">Booking code <span class="sdk-optional">optional</span></span><input type="text" placeholder="ABC123"><span class="sdk-hint"></span></label></form>' },
      { n: 'Search .sdk-search', ctx: 'host', sel: '.sdk-search', html: '<label class="sdk-search">' + fa('magnifying-glass') + '<input type="search" placeholder="Search places" aria-label="Search places"></label>', target: 'input', states: [{ n: 'Focus', force: 'focus' }] },
      { n: 'Date field .sdk-datefield', wide: true, ctx: 'host', sel: '.sdk-datefield', note: 'host.ui.datePicker puts the calendar button in the field; the month grid is under Pickers.', html: '<form class="sdk-form" onsubmit="return false"><div class="sdk-field" role="group" aria-labelledby="dsl1"><span class="sdk-label" id="dsl1">Departure day</span><div class="sdk-datefield sdk-group"><input type="date" value="2026-10-09" aria-labelledby="dsl1"><button type="button" class="sdk-icon-btn btn-small btn-quiet" aria-label="Open the calendar">' + fa('calendar') + '</button></div><span class="sdk-hint">Fri</span></div></form>' },
      { n: 'A pair .sdk-pair and a section .sdk-section', ctx: 'host', sel: '.sdk-pair', wide: true, html: '<form class="sdk-form" onsubmit="return false"><div class="sdk-pair">' + field('From', '<input type="text" value="Lisbon">') + '<span class="sdk-pair-arrow">' + fa('arrow-right') + '</span>' + field('To', '<input type="text" value="Porto">') + '</div><fieldset class="sdk-section"><legend class="sdk-section-title">Details</legend><div class="sdk-form-row">' + field('Hours', '<span class="sdk-group"><input type="text" inputmode="numeric" value="2" aria-label="Hours"><span class="sdk-unit">h</span></span>', '', 'sdk-s') + field('Cost', '<input type="text" value="40">', '', 'sdk-m') + '</div></fieldset></form>' },
      { n: 'Form error .sdk-form-error', wide: true, ctx: 'host', sel: '.sdk-form-error', note: 'The line under a form when saving did not work; <code>.ok</code> when it did.', html: '<div class="sdk-form"><div class="sdk-form-error">The save did not work. Try again.</div><div class="sdk-form-error ok">Saved.</div></div>' },
      { n: 'On an app page', wide: true, ctx: 'app', sel: '.sdk-field', note: 'Profile, Manage and the space settings use the same field.', html: '<form class="sdk-form" onsubmit="return false"><div class="sdk-form-row">' + field('Display name', '<input type="text" value="Thomas">', '', 'sdk-m') + field('Role', '<select><option>Member</option><option>Moderator</option></select>', '', 'sdk-m') + '</div></form>', target: 'input', states: [{ n: 'Focus', force: 'focus' }] },
      { n: 'File, colour and range', wide: true, ctx: 'host', sel: ':where(input[type="file"])', html: row('<input type="file" aria-label="Choose a file"><input type="color" value="#c47a2c" aria-label="Colour"><input type="range" value="40" aria-label="Volume">', 16) },
    ],
  });

  // ---- Choices ----
  F.push({
    id: 'choices', group: 'Controls', name: 'Tick boxes, choices and switches',
    desc: 'A tick box or a radio is the bare <code>input</code>; a switch is <code>input type="checkbox" class="sdk-switch" role="switch"</code>. A labelled row is <code>.sdk-choice-row</code> in a <code>.sdk-choice-list</code>, with <code>.sdk-choice-text</code>, <code>.sdk-choice-label</code> and <code>.sdk-choice-desc</code>; <code>.sdk-choice-boxed</code> draws the row as a box.',
    variants: [
      { n: 'Tick rows', ctx: 'host', sel: '.sdk-choice-row', html: '<div class="sdk-choice-list"><label class="sdk-choice-row"><input type="checkbox" checked><span class="sdk-choice-text"><span class="sdk-choice-label">Round trip</span></span></label><label class="sdk-choice-row"><input type="checkbox"><span class="sdk-choice-text"><span class="sdk-choice-label">Booked</span></span></label><label class="sdk-choice-row"><input type="checkbox" disabled><span class="sdk-choice-text"><span class="sdk-choice-label">Locked</span></span></label></div>', target: 'label:nth-child(2)', states: ['hover'] },
      { n: 'One of a few (radio rows)', ctx: 'host', sel: '.sdk-choice-row', html: '<div class="sdk-choice-list" role="radiogroup" aria-label="Show"><label class="sdk-choice-row"><input type="radio" name="c1" checked><span class="sdk-choice-text"><span class="sdk-choice-label">Day</span></span></label><label class="sdk-choice-row"><input type="radio" name="c1"><span class="sdk-choice-text"><span class="sdk-choice-label">Week</span></span></label><label class="sdk-choice-row"><input type="radio" name="c1"><span class="sdk-choice-text"><span class="sdk-choice-label">Month</span></span></label></div>' },
      { n: 'With a description', ctx: 'host', sel: '.sdk-choice-desc', html: '<div class="sdk-choice-list"><label class="sdk-choice-row"><input type="checkbox" checked><span class="sdk-choice-text"><span class="sdk-choice-label">Send a reminder</span><span class="sdk-choice-desc">A day before, to everyone in the space.</span></span></label></div>' },
      { n: 'Switch rows', ctx: 'app', sel: 'input.sdk-switch', note: 'Space settings, Manage, the module list.', html: '<div class="sdk-choice-list"><label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">Published calendar</span></span><input type="checkbox" class="sdk-switch" role="switch" checked></label><label class="sdk-choice-row"><span class="sdk-choice-text"><span class="sdk-choice-label">Chat</span><span class="sdk-choice-desc">always on</span></span><input type="checkbox" class="sdk-switch" role="switch" checked disabled></label></div>', target: 'input', states: ['focus'] },
      { n: 'Boxed rows .sdk-choice-boxed', ctx: 'host', sel: '.sdk-choice-boxed', html: '<div class="sdk-choice-list"><label class="sdk-choice-row sdk-choice-boxed"><input type="radio" name="c2" checked><span class="sdk-choice-text"><span class="sdk-choice-label">Everyone</span><span class="sdk-choice-desc">Every member of the space</span></span></label><label class="sdk-choice-row sdk-choice-boxed"><input type="radio" name="c2"><span class="sdk-choice-text"><span class="sdk-choice-label">Only me</span><span class="sdk-choice-desc">Nobody else sees it</span></span></label></div>' },
      { n: 'The bare controls', ctx: 'host', sel: ':where(input[type="checkbox"], input[type="radio"])', html: row('<input type="checkbox" aria-label="One"><input type="checkbox" checked aria-label="Two"><input type="radio" name="c3" aria-label="Three"><input type="radio" name="c3" checked aria-label="Four"><input type="checkbox" class="sdk-switch" role="switch" aria-label="Five"><input type="checkbox" class="sdk-switch" role="switch" checked aria-label="Six">', 14), target: 'input', states: ['focus', 'disabled'] },
    ],
  });

  // ---- Pickers ----
  const dpDays = () => {
    const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    let s = names.map((n) => `<div class="sdk-dp-dow">${n}</div>`).join('');
    const days = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1];
    days.forEach((d, i) => {
      const other = (i < 3 || i > 33) ? ' other' : '';
      const cls = d === 14 && !other ? ' today' : d === 18 && !other ? ' sel' : d >= 19 && d <= 21 && !other ? ' inrange' : '';
      s += `<button type="button" class="sdk-dp-day${other}${cls}">${d}</button>`;
    });
    return s;
  };
  // The colour picker (host.ui.colorPicker, host.ui.colorField), drawn as the SDK draws it. A page can read the default palette
  // (window.hostColour.palette), but this catalogue is static markup built before any page global is there, so the three groups are
  // written here as in public/sdk/host.js (COLOUR_PALETTE): change both together. The colours in it are data, set as custom properties (--sw, --cp-*), as host.js sets them.
  const CP_PALETTE = [
    ['Light', [['White', '#ffffff'], ['Cream', '#f5eedb'], ['Light grey', '#e4e6ea'], ['Light blue', '#dce9f6'], ['Light green', '#ddeedd'], ['Light yellow', '#fbf4c8'], ['Light pink', '#f8e0e9'], ['Light purple', '#e8e0f5']]],
    ['Dark', [['Black', '#000000'], ['Slate', '#2b3440'], ['Dark grey', '#34373c'], ['Navy', '#14274b'], ['Forest', '#163a2b'], ['Wine', '#4a1b2b'], ['Plum', '#2f2050'], ['Brown', '#3d2b1f']]],
    ['Strong', [['Red', '#c0392b'], ['Orange', '#b8560f'], ['Gold', '#8a6a00'], ['Green', '#2e7d32'], ['Teal', '#00796b'], ['Blue', '#2f6cbf'], ['Purple', '#7c55c8'], ['Pink', '#b23f7f']]],
  ];
  // The same colour maths as host.js (colourToHsv, colourFromHsv), to place the handle and the thumbs for the colour shown.
  const cpHsv = (c) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const d = max - Math.min(r, g, b);
    let hh = 0;
    if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (hh * 60 + 360) % 360, s: max ? (d / max) * 100 : 0, v: max * 100 };
  };
  const cpHex = (h, s, v) => {
    const f = (k) => { const x = (k + h / 60) % 6; return v / 100 - (v / 100) * (s / 100) * Math.max(0, Math.min(x, 4 - x, 1)); };
    return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  };
  const CP_AREA = `linear-gradient(to top, ${cpHex(0, 0, 0)}, transparent), linear-gradient(to right, ${cpHex(0, 0, 100)}, transparent)`;
  const CP_HUES = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((x) => cpHex(x % 360, 100, 100)).join(', ')})`;
  // host.js's own icons (COLOUR_ICONS): the check on a chosen swatch, Pick from the screen and the trigger's chevron.
  const CP_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.4 7.8l1.4-1.4 2.4 2.4 6-6 1.4 1.4z"/></svg>';
  const CP_DROPPER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 1.3a2 2 0 0 0-2.8 0L8.9 3l-.7-.7-1.4 1.4.7.7-5.2 5.2a1 1 0 0 0-.3.7V13h2.7a1 1 0 0 0 .7-.3l5.2-5.2.7.7 1.4-1.4-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM4.3 11.5h-.8v-.8l5.1-5.1.8.8z"/></svg>';
  const CP_CHEVRON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M2.3 5.3 8 11l5.7-5.7-1.4-1.4L8 8.2 3.7 3.9z"/></svg>';
  const cpSwatch = (name, c, on, faint) => `<button type="button" class="sdk-swatch${faint ? ' sdk-cp-faint' : ''}" tabindex="${on ? 0 : -1}" role="radio" aria-checked="${on}" aria-label="${name || c}" data-tip="${name ? name + ', ' : ''}${c}" style="--sw:${c}"><i aria-hidden="true">${CP_CHECK}</i></button>`;
  // A group of swatches (the palette, or Recent): one radio group, a heading over each row of eight. faint: the names with the stronger edge.
  const cpSwatches = (label, groups, chosen, faint = []) => `<div class="sdk-cp-swatches" role="radiogroup" aria-label="${label}">` + groups.map(([head, list]) => `<div class="sdk-cp-head" aria-hidden="true">${head}</div><div class="sdk-swatch-grid" role="presentation">${list.map(([n, c]) => cpSwatch(n, c, c === chosen, faint.includes(n || c))).join('')}</div>`).join('') + '</div>';
  // The hex row: the colour as it is, Hex, and Pick from the screen (hidden where the browser has no eyedropper).
  const cpRow = (c, o = {}) => `<div class="sdk-cp-row"><span class="sdk-cp-current" aria-hidden="true"></span><label class="sdk-cp-hex"><span class="sdk-cp-hex-word">Hex</span><input class="sdk-cp-hexin" type="text" autocomplete="off" spellcheck="false" maxlength="9" autocapitalize="off" value="${o.typed || c}"${o.bad ? ' aria-invalid="true" aria-describedby="cp-err"' : ''}></label><button type="button" class="sdk-icon-btn btn-small btn-quiet sdk-cp-dropper" aria-label="Pick from the screen" data-tip="Pick from the screen"${o.noDropper ? ' hidden' : ''}>${CP_DROPPER}</button></div><p class="sdk-error sdk-cp-error" id="cp-err" aria-live="polite">${o.bad ? 'Type six hex digits, like #2f6cbf' : ''}</p>`;
  // The popover around its parts, with the colour's custom properties as host.js sets them. width: a part drawn alone keeps the picker's width.
  const cpPop = (c, alpha, inner, width, solid) => {
    const { h, s, v } = cpHsv(c);
    return `<div class="sdk-popover sdk-popover-dense sdk-picker-pop sdk-cp${solid ? ' sdk-cp-solid' : ''}" role="dialog" aria-label="Colour" style="--cp-area:${CP_AREA};--cp-hue-track:${CP_HUES};--cp-hue:${cpHex(h, 100, 100)};--cp-color:${c};--cp-alpha:${alpha}%;--cp-x:${s / 100};--cp-y:${1 - v / 100}${width ? ';width:' + width + 'px' : ''}">${inner}</div>`;
  };
  const cpSlider = (cls, name, max, now, text) => `<div class="sdk-cp-slider ${cls}" tabindex="0" role="slider" aria-label="${name}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}" aria-valuetext="${text}" aria-orientation="horizontal" style="--cp-at:${now / max}"><span class="sdk-cp-track"></span><span class="sdk-cp-thumb"></span></div>`;
  // The whole picker: the area, Hue, Opacity (left out where the opacity is not kept), the hex row, the palette and Recent.
  const cpPicker = (c, alpha, o = {}) => {
    const { h, s, v } = cpHsv(c);
    const r = Math.round;
    const off = o.opacity === false;
    const a = off ? 100 : alpha;
    const named = new Map(CP_PALETTE.flatMap(([, list]) => list.map(([n, x]) => [x, n])));
    const recent = (o.recent || []).map((x) => [named.get(x) || '', x]);
    const inner = `<div class="sdk-cp-area" tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r(s)}" aria-valuetext="Saturation ${r(s)} percent, brightness ${r(v)} percent"><span class="sdk-cp-handle"></span></div>`
      + cpSlider('sdk-cp-hue', 'Hue', 359, Math.min(359, r(h)), `Hue ${Math.min(359, r(h))} degrees`)
      + (off ? '' : cpSlider('sdk-cp-alpha', 'Opacity', 100, a, `Opacity ${a} percent`))
      + cpRow(c, o)
      + cpSwatches('Colours', CP_PALETTE, c, o.faint)
      + (recent.length ? cpSwatches('Recent', [['Recent', recent]], c, o.faint) : '')
      + '<div class="sdk-cp-live" aria-live="polite"></div>';
    return cpPop(c, a, inner, undefined, off);
  };
  const CP_RECENT = ['#00796b', '#d4572a', '#fbf4c8'];
  const CP_LIGHT = CP_PALETTE[0][1].map(([n]) => n);
  F.push({
    id: 'pickers', group: 'Controls', name: 'Pickers: date, kind, colour',
    desc: 'The SDK\'s own pickers: the date picker\'s month (<code>.sdk-dp</code>, from host.ui.datePicker), the kind picker\'s field (<code>.sdk-kind-field</code>, host.ui.kindPicker; its list is under Menus) and the colour picker (<code>.sdk-cp</code>, a dense popover). <code>host.ui.colorPicker({ anchor | at, value, opacity, palette, recent, label, onInput })</code> opens the picker and answers <code>{ color, opacity }</code>, or null when the person cancels; <code>host.ui.colorField(input, options)</code> puts a trigger (<code>.sdk-picker</code>) on an input in a form and opens the picker under it. The colours inside are data (<code>--sw</code>, <code>--cp-*</code>); the picker itself is theme tokens. Live ones are under Live SDK pieces.',
    variants: [
      { n: 'Date picker month .sdk-dp', ctx: 'host', sel: '.sdk-dp', static: true, note: 'Today is a fill; the chosen day is the accent; a range is a tint. The real one is placed under its field.', html: '<div class="sdk-dp"><div class="sdk-dp-head"><button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="Earlier">' + fa('chevron-left') + '</button><strong class="sdk-dp-title">October 2026</strong><button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="Later">' + fa('chevron-right') + '</button></div><div class="sdk-dp-grid">' + dpDays() + '</div><div class="sdk-dp-foot"><button type="button" class="btn btn-small btn-quiet">Today</button><button type="button" class="btn btn-small btn-quiet">Clear</button></div></div>' },
      { n: 'Kind picker field .sdk-kind-field', ctx: 'host', sel: '.sdk-kind-field', html: '<div class="sdk-kind" style="max-width:280px"><div class="sdk-kind-field"><span class="sdk-kind-chip" style="--kind-color:#c47a2c">' + fa('landmark') + '</span><input class="sdk-kind-input" value="Sight" aria-label="What is it"><span class="sdk-kind-chevron">' + fa('chevron-down') + '</span></div></div>', target: '.sdk-kind-field', states: [{ n: 'Focus', force: 'focus' }, { n: 'Open', html: '<div class="sdk-kind open" style="max-width:280px"><div class="sdk-kind-field"><span class="sdk-kind-chip" style="--kind-color:#c47a2c">' + fa('landmark') + '</span><input class="sdk-kind-input" value="Sight" aria-label="What is it"><span class="sdk-kind-chevron">' + fa('chevron-down') + '</span></div></div>' }] },
      { n: 'Colour field trigger .sdk-picker', ctx: 'host', sel: '.sdk-picker', note: 'host.ui.colorField: the swatch, the hex and a chevron, on an input that stays hidden and holds the colour. Pressed, it opens the picker under it.', html: '<button type="button" class="sdk-picker" aria-haspopup="dialog" aria-expanded="false" aria-label="Colour, Blue, #2f6cbf. Change it"><span class="sdk-picker-sw" aria-hidden="true" style="--sw:#2f6cbf"></span><span class="sdk-picker-value"><span class="sdk-hex">#2f6cbf</span></span><span class="sdk-picker-icon" aria-hidden="true">' + CP_CHEVRON + '</span></button>', states: ['hover', 'focus', { n: 'Open', attrs: { 'aria-expanded': 'true' } }, 'disabled'] },
      { n: 'Colour picker .sdk-cp', ctx: 'host', sel: '.sdk-cp', static: true, wide: true, target: '.sdk-cp-area', note: 'host.ui.colorPicker, from top to bottom: the area (saturation across, brightness up), Hue, Opacity over a checked ground, the hex row, the palette\'s three groups (Light, Dark, Strong) and Recent. The chosen colour has the check. Where the colour is kept without its opacity (opacity: false), there is no Opacity slider and the colour as it is has no checked half. The Light group has the stronger edge, as the real picker draws it on a light menu (on a dark menu it is the Dark group, worked out when it opens).',
        html: cpPicker('#2f6cbf', 80, { recent: CP_RECENT, faint: CP_LIGHT }),
        states: [{ n: 'Focus on the area', force: 'focus' }, { n: 'Opacity not kept', html: cpPicker('#2f6cbf', 100, { opacity: false, recent: CP_RECENT, faint: CP_LIGHT }) }] },
      { n: 'The hex row .sdk-cp-row', ctx: 'host', sel: '.sdk-cp-row', static: true, note: 'A bad hex keeps the colour as it was and gets the line under it. Pick from the screen shows only where the browser has an eyedropper that works there (not in Safari or Firefox).',
        html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf'), 240),
        states: [{ n: 'A bad hex', html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf', { typed: '#2f6cb', bad: true }), 240) }, { n: 'No eyedropper', html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf', { noDropper: true }), 240) }] },
      { n: 'Pale swatches .sdk-cp-faint', ctx: 'host', sel: '.sdk-swatch.sdk-cp-faint', static: true, note: 'A swatch with under 3:1 against the menu\'s surface gets a stronger edge, worked out when the picker opens: the Light group on a light menu, the Dark group on a dark one. Here the Light group has it, whatever the mode.',
        html: cpPop('#ffffff', 100, cpSwatches('Colours', [CP_PALETTE[0]], '#ffffff')),
        states: [{ n: 'Stronger edge', html: cpPop('#ffffff', 100, cpSwatches('Colours', [CP_PALETTE[0]], '#ffffff', CP_LIGHT)) }, { n: 'Focus on a swatch', html: cpPop('#ffffff', 100, cpSwatches('Colours', [CP_PALETTE[0]], '#ffffff', CP_LIGHT).replace('class="sdk-swatch sdk-cp-faint" tabindex="-1"', 'class="sdk-swatch sdk-cp-faint ds-force-focus" tabindex="-1"')) }] },
    ],
    notMounted: 'the kind picker\'s phone sheet (fixed to the screen), the date picker\'s and the colour picker\'s placement under their field, and the eyedropper itself.',
  });

  // ---- Links (public/style.css) ----
  F.push({
    id: 'links', group: 'Controls', name: 'Links',
    desc: 'Text that goes somewhere. Not a system.css family: the plain link and these looks are public/style.css\'s.',
    variants: [
      { n: 'Link, app', ctx: 'app', sel: 'a', html: '<a href="#">Forgot the password</a>', states: ['hover', 'focus'] },
      { n: 'Link, module', ctx: 'host', sel: 'a', html: '<a href="#">Open in the map</a>', states: ['hover', 'focus'] },
      { n: 'Link-like button .linklike', ctx: 'app', sel: '.linklike', html: '<button type="button" class="linklike">Show the key</button>', states: ['hover', 'focus'] },
      { n: 'Setup link .setup-link', ctx: 'app', sel: '.setup-link', html: '<a class="setup-link" href="#">' + fa('arrow-up-right-from-square') + ' Open the page</a>', states: ['hover', 'focus'] },
      { n: 'Crumb .crumb (the top bar\'s left)', ctx: 'app', sel: '.crumb', html: '<div class="topbar" style="position:static;min-height:0;padding:4px 8px"><span class="crumb"><a class="crumb-link nav-text" href="#">Lisbon</a><span class="crumb-sep">/</span><span class="crumb-here nav-text">Plan</span></span></div>' },
    ],
  });

  // ---- Call buttons (public/style.css) ----
  F.push({
    id: 'call-controls', group: 'Controls', name: 'Call buttons',
    desc: 'The call\'s round buttons (<code>.fbtn</code>) and the top bar\'s icon links (<code>.icon-link</code>). Not a system.css family: public/style.css draws them. A real call needs LiveKit, which this page does not have.',
    variants: [
      { n: 'Call button .fbtn', ctx: 'app', sel: '.fbtn', html: '<div class="fbtn-wrap"><button class="fbtn" type="button" aria-label="Microphone"><span class="glyph"><i class="fa-solid fa-microphone fa-fw icon-on" aria-hidden="true"></i><i class="fa-solid fa-microphone-slash fa-fw icon-off" aria-hidden="true"></i></span></button><button class="fbtn-caret" type="button" aria-label="Microphone settings">' + fa('chevron-down') + '</button></div>', target: '.fbtn', states: ['hover', 'focus', 'active', { n: 'Off (muted)', cls: 'off' }] },
      { n: 'The row', ctx: 'app', sel: '.fbtn', html: row(['microphone', 'volume-high', 'video'].map((n) => `<button class="fbtn" type="button" aria-label="${n}"><span class="glyph">${fa(n, 'fa-fw')}</span></button>`).join('') + '<button class="fbtn" type="button" aria-label="Leave the call"><span class="glyph">' + fa('phone', 'fa-fw') + '</span></button>') },
      { n: 'Top bar icon link .icon-link', ctx: 'app', sel: '.icon-link', html: '<div class="topbar" style="position:static;min-height:0;padding:4px 8px"><button type="button" class="icon-link" aria-label="Notifications">' + fa('bell', 'fa-fw') + '</button><button type="button" class="icon-link on" aria-label="Chat">' + fa('comments', 'fa-fw') + '</button></div>', target: '.icon-link', states: ['hover', 'focus'] },
    ],
  });
})();
