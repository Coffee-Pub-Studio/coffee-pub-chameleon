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
  // The colour picker (host.ui.colorPicker, host.ui.colorField), drawn as the SDK draws it. A page can read the 24 starting colours
  // (window.hostColour.palette), but this catalogue is static markup built before any page global is there, so they are written here
  // as in public/sdk/host.js (COLOUR_GRID_START), in the grid's order: change both together. The colours in it are data, set as custom
  // properties (--sw, --cp-*), as host.js sets them.
  const CP_GRID = [
    ['White', '#ffffff'], ['Light grey', '#c0c0c0'], ['Grey', '#808080'], ['Dark grey', '#404040'],
    ['Black', '#000000'], ['Light red', '#f28b82'], ['Red', '#d62828'], ['Dark red', '#8b1a1a'],
    ['Light brown', '#d2b48c'], ['Orange', '#f28c28'], ['Brown', '#8b5a2b'], ['Yellow', '#ffe135'],
    ['Light green', '#90ee90'], ['Green', '#2e9e3e'], ['Dark green', '#1b5e20'], ['Cyan', '#00bcd4'],
    ['Teal', '#008080'], ['Light blue', '#87ceeb'], ['Blue', '#1e5fd0'], ['Dark blue', '#1a237e'],
    ['Light purple', '#c3a6e8'], ['Purple', '#7b3fb5'], ['Pink', '#f48fb1'], ['Magenta', '#d81b9c'],
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
  // host.js's own icons (COLOUR_ICONS): the check on a chosen swatch, Pick from the screen, the trigger's chevron and the grid's "+".
  const CP_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 11.6 2.4 7.8l1.4-1.4 2.4 2.4 6-6 1.4 1.4z"/></svg>';
  const CP_DROPPER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M13.4 1.3a2 2 0 0 0-2.8 0L8.9 3l-.7-.7-1.4 1.4.7.7-5.2 5.2a1 1 0 0 0-.3.7V13h2.7a1 1 0 0 0 .7-.3l5.2-5.2.7.7 1.4-1.4-.7-.7 1.7-1.7a2 2 0 0 0 0-2.8zM4.3 11.5h-.8v-.8l5.1-5.1.8.8z"/></svg>';
  const CP_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7 2h2v5h5v2H9v5H7V9H2V7h5z"/></svg>';
  // One swatch: [name, hex, opacity?]. A grid colour below opacity 100 is named by its hex and percent and drawn half over the checked ground.
  const cpSwatch = ([name, c, op], on, faint) => {
    const said = name || (op !== undefined && op < 100 ? `${c}, ${op} percent` : c);
    const see = op !== undefined && op < 100;
    return `<button type="button" class="sdk-swatch${faint ? ' sdk-cp-faint' : ''}${see ? ' sdk-cp-see' : ''}" tabindex="${on ? 0 : -1}" role="radio" aria-checked="${on}" aria-label="${said}" data-tip="${name ? name + ', ' + c : said}"${op !== undefined ? ` data-opacity="${op}"` : ''} style="--sw:${c}${see ? `;--cp-sw-alpha:${op}%` : ''}"><i aria-hidden="true">${CP_CHECK}</i></button>`;
  };
  const CP_ADD = `<button type="button" class="sdk-cp-add" aria-label="Add this colour" data-tip="Add this colour">${CP_PLUS}</button>`;
  // The person's grid: one radio group, no headings, rows of eight, "+" at its end where it can be edited. chosen: [hex, opacity].
  // faint: the names (or hexes) with the stronger edge.
  const cpGrid = (list, chosen, faint = [], o = {}) => `<div class="sdk-cp-swatches" role="radiogroup" aria-label="Colours"><div class="sdk-swatch-grid" role="presentation">${list.map(([n, c, op = 100]) => cpSwatch([n, c, op], c === chosen[0] && op === chosen[1], faint.includes(n || c))).join('')}${o.editable === false ? '' : CP_ADD}</div></div>${o.editable === false ? '' : '<p class="sdk-error sdk-cp-error sdk-cp-grid-error" aria-live="polite">' + (o.error || '') + '</p>'}`;
  // A group of swatches with a heading (Recent, or a module's own palette): one radio group, a heading over each row.
  const cpSwatches = (label, groups, chosen, faint = []) => `<div class="sdk-cp-swatches" role="radiogroup" aria-label="${label}">` + groups.map(([head, list]) => `<div class="sdk-cp-head" aria-hidden="true">${head}</div><div class="sdk-swatch-grid" role="presentation">${list.map(([n, c]) => cpSwatch([n, c], c === chosen, faint.includes(n || c))).join('')}</div>`).join('') + '</div>';
  // The hex row: the colour as it is, Hex, and Pick from the screen (hidden where the browser has no eyedropper).
  const cpRow = (c, o = {}) => `<div class="sdk-cp-row"><span class="sdk-cp-current" aria-hidden="true"${o.editable === false ? '' : ' draggable="true"'}></span><label class="sdk-cp-hex"><span class="sdk-cp-hex-word">Hex</span><input class="sdk-cp-hexin" type="text" autocomplete="off" spellcheck="false" maxlength="9" autocapitalize="off" value="${o.typed || c}"${o.bad ? ' aria-invalid="true" aria-describedby="cp-err"' : ''}></label><button type="button" class="sdk-icon-btn btn-small btn-quiet sdk-cp-dropper" aria-label="Pick from the screen" data-tip="Pick from the screen"${o.noDropper ? ' hidden' : ''}>${CP_DROPPER}</button></div><p class="sdk-error sdk-cp-error" id="cp-err" aria-live="polite">${o.bad ? 'Type six hex digits, like #2f6cbf' : ''}</p>`;
  // The popover around its parts, with the colour's custom properties as host.js sets them. width: a part drawn alone keeps the picker's width.
  const cpPop = (c, alpha, inner, width, solid) => {
    const { h, s, v } = cpHsv(c);
    return `<div class="sdk-popover sdk-popover-dense sdk-picker-pop sdk-cp${solid ? ' sdk-cp-solid' : ''}" role="dialog" aria-label="Colour" style="--cp-area:${CP_AREA};--cp-hue-track:${CP_HUES};--cp-hue:${cpHex(h, 100, 100)};--cp-color:${c};--cp-alpha:${alpha}%;--cp-x:${s / 100};--cp-y:${1 - v / 100}${width ? ';width:' + width + 'px' : ''}">${inner}</div>`;
  };
  const cpSlider = (cls, name, max, now, text) => `<div class="sdk-cp-slider ${cls}" tabindex="0" role="slider" aria-label="${name}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${now}" aria-valuetext="${text}" aria-orientation="horizontal" style="--cp-at:${now / max}"><span class="sdk-cp-track"></span><span class="sdk-cp-thumb"></span></div>`;
  // The whole picker: the area, Hue, Opacity (left out where the opacity is not kept), the hex row, the grid (or a module's palette) and Recent.
  const cpPicker = (c, alpha, o = {}) => {
    const { h, s, v } = cpHsv(c);
    const r = Math.round;
    const off = o.opacity === false;
    const a = off ? 100 : alpha;
    const named = new Map(CP_GRID.map(([n, x]) => [x, n]));
    const recent = (o.recent || []).map((x) => [named.get(x) || '', x]);
    const inner = `<div class="sdk-cp-area" tabindex="0" role="slider" aria-label="Saturation and brightness" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${r(s)}" aria-valuetext="Saturation ${r(s)} percent, brightness ${r(v)} percent"><span class="sdk-cp-handle"></span></div>`
      + cpSlider('sdk-cp-hue', 'Hue', 359, Math.min(359, r(h)), `Hue ${Math.min(359, r(h))} degrees`)
      + (off ? '' : cpSlider('sdk-cp-alpha', 'Opacity', 100, a, `Opacity ${a} percent`))
      + cpRow(c, o)
      + (o.palette ? cpSwatches('Colours', o.palette, c, o.faint) : cpGrid(o.grid || CP_GRID, [c, a], o.faint, o))
      + (recent.length ? cpSwatches('Recent', [['Recent', recent]], c, o.faint) : '')
      + '<div class="sdk-cp-live" aria-live="polite"></div>';
    return cpPop(c, a, inner, undefined, off);
  };
  const CP_RECENT = ['#008080', '#d4572a', '#ffe135'];
  // The swatches the real picker gives the stronger edge on a white menu (under 3:1 against it, the contrast helper's maths); on a dark
  // menu it is the dark ones, worked out when it opens.
  const cpLum = (c) => { const n = parseInt(c.slice(1), 16); const f = (x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
  const CP_LIGHT = CP_GRID.filter(([, c]) => 1.05 / (cpLum(c) + 0.05) < 3).map(([n]) => n);
  // The grid after a person added a colour at 60 percent (it takes its place by the grid's order, among the blues).
  const CP_ADDED = [...CP_GRID.slice(0, 18), ['', '#1e5fd0', 60], ...CP_GRID.slice(18)];
  const CP_MODULE = [['Inks', [['Ink', '#1a2b3c'], ['Paper', '#f5eedb'], ['Rust', '#b8560f']]]];
  F.push({
    id: 'pickers', group: 'Controls', name: 'Pickers: date, kind, colour',
    desc: 'The SDK\'s own pickers: the date picker\'s month (<code>.sdk-dp</code>, from host.ui.datePicker), the kind picker\'s field (<code>.sdk-kind-field</code>, host.ui.kindPicker; its list is under Menus) and the colour picker (<code>.sdk-cp</code>, a dense popover). <code>host.ui.colorPicker({ anchor | at, value, opacity, palette, recent, label, onInput })</code> opens the picker and answers <code>{ color, opacity }</code>, or null when the person cancels; <code>host.ui.colorField(input, options)</code> puts a colour chip (<code>.sdk-picker</code>, a square in the colour) on an input in a form and opens the picker under it. Its swatches are the person\'s own colours: one grid sorted by colour, kept on their account, that they add to with "+" or by dragging the colour showing onto it, and remove from with a right-click or Delete. A module\'s own <code>palette</code> shows instead and can\'t be edited. The colours inside are data (<code>--sw</code>, <code>--cp-*</code>); the picker itself is theme tokens. Live ones are under Live SDK pieces.',
    variants: [
      { n: 'Date picker month .sdk-dp', ctx: 'host', sel: '.sdk-dp', static: true, note: 'Today is a fill; the chosen day is the accent; a range is a tint. The real one is placed under its field.', html: '<div class="sdk-dp"><div class="sdk-dp-head"><button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="Earlier">' + fa('chevron-left') + '</button><strong class="sdk-dp-title">October 2026</strong><button type="button" class="sdk-icon-btn btn-quiet btn-small" aria-label="Later">' + fa('chevron-right') + '</button></div><div class="sdk-dp-grid">' + dpDays() + '</div><div class="sdk-dp-foot"><button type="button" class="btn btn-small btn-quiet">Today</button><button type="button" class="btn btn-small btn-quiet">Clear</button></div></div>' },
      { n: 'Kind picker field .sdk-kind-field', ctx: 'host', sel: '.sdk-kind-field', html: '<div class="sdk-kind" style="max-width:280px"><div class="sdk-kind-field"><span class="sdk-kind-chip" style="--kind-color:#c47a2c">' + fa('landmark') + '</span><input class="sdk-kind-input" value="Sight" aria-label="What is it"><span class="sdk-kind-chevron">' + fa('chevron-down') + '</span></div></div>', target: '.sdk-kind-field', states: [{ n: 'Focus', force: 'focus' }, { n: 'Open', html: '<div class="sdk-kind open" style="max-width:280px"><div class="sdk-kind-field"><span class="sdk-kind-chip" style="--kind-color:#c47a2c">' + fa('landmark') + '</span><input class="sdk-kind-input" value="Sight" aria-label="What is it"><span class="sdk-kind-chevron">' + fa('chevron-down') + '</span></div></div>' }] },
      { n: 'Colour field trigger .sdk-picker', ctx: 'host', sel: '.sdk-picker', note: 'host.ui.colorField: a colour chip, a square button filled with the colour (the hex is its tooltip and in its name), on an input that stays hidden and holds the colour. Pressed, it opens the picker under it.', html: '<button type="button" class="sdk-picker" aria-haspopup="dialog" aria-expanded="false" aria-label="Colour, Blue, #1e5fd0. Change it" title="#1e5fd0"><span class="sdk-picker-sw" aria-hidden="true" style="--sw:#1e5fd0"></span></button>', states: ['hover', 'focus', { n: 'Open', attrs: { 'aria-expanded': 'true' } }, 'disabled'] },
      { n: 'Colour picker .sdk-cp', ctx: 'host', sel: '.sdk-cp', static: true, wide: true, target: '.sdk-cp-area', note: 'host.ui.colorPicker, from top to bottom: the area (saturation across, brightness up), Hue, Opacity over a checked ground, the hex row, the person\'s grid (the 24 starting colours until they first edit it, sorted by colour, no headings, "+" at its end) and Recent. The chosen colour has the check. Drag the colour showing onto the grid, or press "+", to add it with its opacity; right-click a colour or press Delete on it to remove it. A colour below opacity 100 is drawn half over the checked ground. Where the colour is kept without its opacity (opacity: false), there is no Opacity slider. The pale ones have the stronger edge, as the real picker draws them on a light menu (on a dark menu it is the dark ones, worked out when it opens).',
        html: cpPicker('#1e5fd0', 100, { recent: CP_RECENT, faint: CP_LIGHT }),
        states: [{ n: 'Focus on the area', force: 'focus' }, { n: 'An added colour at 60 percent', html: cpPicker('#1e5fd0', 60, { grid: CP_ADDED, recent: CP_RECENT, faint: CP_LIGHT }) }, { n: 'Not editable (a guest, or no session)', html: cpPicker('#1e5fd0', 100, { editable: false, recent: CP_RECENT, faint: CP_LIGHT }) }, { n: 'A module\'s own palette', html: cpPicker('#1a2b3c', 100, { palette: CP_MODULE, editable: false }) }, { n: 'Opacity not kept', html: cpPicker('#1e5fd0', 100, { opacity: false, recent: CP_RECENT, faint: CP_LIGHT }) }, { n: 'A save refused', html: cpPicker('#1e5fd0', 100, { error: 'The grid holds at most 48 colours.', recent: CP_RECENT, faint: CP_LIGHT }) }] },
      { n: 'The hex row .sdk-cp-row', ctx: 'host', sel: '.sdk-cp-row', static: true, note: 'A bad hex keeps the colour as it was and gets the line under it. Pick from the screen shows only where the browser has an eyedropper that works there (not in Safari or Firefox).',
        html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf'), 240),
        states: [{ n: 'A bad hex', html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf', { typed: '#2f6cb', bad: true }), 240) }, { n: 'No eyedropper', html: cpPop('#2f6cbf', 100, cpRow('#2f6cbf', { noDropper: true }), 240) }] },
      { n: 'Pale swatches .sdk-cp-faint', ctx: 'host', sel: '.sdk-swatch.sdk-cp-faint', static: true, note: 'A swatch with under 3:1 against the menu\'s surface gets a stronger edge, worked out when the picker opens: the pale ones on a light menu, the dark ones on a dark menu. Here the ones under 3:1 against white have it, whatever the mode.',
        html: cpPop('#ffffff', 100, cpGrid(CP_GRID, ['#ffffff', 100], [], { editable: false }), 280),
        states: [{ n: 'Stronger edge', html: cpPop('#ffffff', 100, cpGrid(CP_GRID, ['#ffffff', 100], CP_LIGHT, { editable: false }), 280) }, { n: 'Focus on a swatch', html: cpPop('#ffffff', 100, cpGrid(CP_GRID, ['#ffffff', 100], CP_LIGHT, { editable: false }).replace('class="sdk-swatch sdk-cp-faint" tabindex="-1"', 'class="sdk-swatch sdk-cp-faint ds-force-focus" tabindex="-1"'), 280) }] },
      { n: 'Add a colour .sdk-cp-add', ctx: 'host', sel: '.sdk-cp-add', static: true, note: '"+" at the end of the person\'s grid adds the colour showing, with its opacity, and keeps the picker open. It is not there at 48 colours, where the grid can\'t be edited, or with a module\'s own palette. While the colour showing is dragged over the grid, the grid is outlined (.sdk-cp-drop).',
        html: cpPop('#1e5fd0', 100, cpGrid(CP_GRID.slice(16), ['#1e5fd0', 100]), 280), target: '.sdk-cp-add',
        states: ['hover', 'focus', { n: 'A drag over the grid', html: cpPop('#1e5fd0', 100, cpGrid(CP_GRID.slice(16), ['#1e5fd0', 100]).replace('class="sdk-cp-swatches" role="radiogroup" aria-label="Colours"', 'class="sdk-cp-swatches sdk-cp-drop" role="radiogroup" aria-label="Colours"'), 280) }] },
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
