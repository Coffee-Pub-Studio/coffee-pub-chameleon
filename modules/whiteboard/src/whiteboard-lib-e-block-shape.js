  // ---- whiteboard-lib-e-block-shape.js: the closed shapes, flowchart ones too --------------------------------------------
  // { ...block, w, h, text, stroke, fill, ink, weight, size, align }: an outline (stroke, weight wide, or none) round a
  // light fill (or none) with words (ink) in the middle, markup in a size and an alignment (centred at first; lib-a). Double-click to change the words. Every shape is its own block type, made by the
  // one definition below; another closed shape is one more entry in SHAPES: its type, its label, its usual size (w, h) and
  // smallest size (min, so its words still fit), draw(w, h, i) -> the SVG element of its outline, inset(w, h) -> where its
  // words sit ([top, right, bottom, left] in from the box), and, when a side's middle is not on the outline, anchorIn(w, h)
  // -> how far in a connector's end goes on that side ({ left, right, top, bottom }). Each is drawn inside its box: the
  // outline's middle is i (half its width) in from the edge.
  // radius (a shape with `radius: true`: the Rectangle and the Rounded box; board units, 0 for square corners, kept to what fits)
  // and shadow ('contact': tight, under the bottom edge; 'soft', shown as Drop shadow: all round) are how it is drawn; a shape
  // with no radius has its own usual corners. draw(w, h, i, radius) takes the radius, undefined for the usual.
  {
    const box = (w, h, i, rx) => wb.svg('rect', { x: i, y: i, width: Math.max(1, w - i * 2), height: Math.max(1, h - i * 2), rx: Math.max(0, Math.min(rx, (w - i * 2) / 2, (h - i * 2) / 2)) });
    // The outline of a drawn shape (its rect, ellipse or polygon) as a path, for the shadow's cut-out (shapeOutline).
    function outlineOf(el) {
      const get = (k) => Number(el.getAttribute(k));
      const tag = el.localName || el.tag;
      if (tag === 'rect') {
        const x = get('x'); const y = get('y'); const w = get('width'); const h = get('height'); const r = Math.min(get('rx') || 0, w / 2, h / 2);
        return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
      }
      if (tag === 'ellipse') {
        const cx = get('cx'); const cy = get('cy'); const rx = get('rx'); const ry = get('ry');
        return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
      }
      const pts = String(el.getAttribute('points') || '').trim().split(/\s+/).map((p) => p.split(','));
      return pts.length ? `M${pts.map((p) => p.join(' ')).join('L')}Z` : '';
    }
    // A shape's shadow, as a layer of its own under it: the shape's OUTER outline (the outside of its border) drawn several times,
    // moved down and blurred (the layers add up to a darker one), and cut out where the shape is, so it shows only outside the
    // border and never through a fill that lets the board show. The cut-out is the clip of the layer (an even-odd path: a huge box
    // with the outline in it). Contact is tight and low, Drop shadow wide.
    const SHADOWS = {
      contact: [{ dy: 1, blur: 0.5 }, { dy: 2, blur: 1 }, { dy: 2, blur: 1 }, { dy: 3, blur: 1.5 }, { dy: 4, blur: 2 }, { dy: 6, blur: 3 }, { dy: 7, blur: 3.5 }],
      soft: [{ dy: 1, blur: 1 }, { dy: 2, blur: 3 }, { dy: 3, blur: 5 }, { dy: 5, blur: 8 }, { dy: 7, blur: 11 }, { dy: 10, blur: 14 }],
    };
    function shadowOf(shape, b, i, kind) {
      const svg = wb.svg('svg', { class: 'wb-svg wb-shape-shadow', width: b.w, height: b.h, viewBox: `0 0 ${b.w} ${b.h}`, 'aria-hidden': 'true' });
      // The cut-out is the outer outline, a hair in (TUCK), so the shadow runs just under the border, which hides it: cut exactly at the
      // border's edge, the antialiasing leaves a light line between the two.
      const TUCK = 1;
      const outer = shape.draw(b.w, b.h, TUCK, shape.radius ? b.radius : undefined);
      svg.style.clipPath = `path(evenodd, 'M-4000 -4000H8000V8000H-4000Z${outlineOf(outer)}')`;
      for (const l of SHADOWS[kind]) {
        const g = wb.svg('g', { transform: `translate(0 ${l.dy})` });
        const body = shape.draw(b.w, b.h, 0, shape.radius ? b.radius : undefined);
        body.setAttribute('class', 'wb-shadow-body');
        body.style.filter = `blur(${l.blur}px)`;
        g.append(body);
        svg.append(g);
      }
      return svg;
    }
    const polygon = (pts) => wb.svg('polygon', { points: pts.map((p) => p.join(',')).join(' ') });
    // The parallelogram's slant: how far its top edge is pushed right of its bottom edge.
    const slant = (w, h) => Math.min(h * 0.35, w * 0.25);
    const SHAPES = [
      { type: 'rect', label: 'Rectangle', radius: true, w: 160, h: 100, min: { w: 16, h: 16 }, draw: (w, h, i, r) => box(w, h, i, r === undefined ? 4 : r) },
      { type: 'ellipse', label: 'Ellipse', w: 160, h: 100, min: { w: 16, h: 16 }, draw: (w, h, i) => wb.svg('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(1, w / 2 - i), ry: Math.max(1, h / 2 - i) }) },
      // Flowchart shapes: a step (rounded box), a choice (diamond), a start or an end (pill), what goes in or out (parallelogram).
      { type: 'rounded', label: 'Rounded box', radius: true, w: 160, h: 100, min: { w: 40, h: 28 }, draw: (w, h, i, r) => box(w, h, i, r === undefined ? Math.min(16, w / 4, h / 4) : r) },
      {
        type: 'diamond',
        label: 'Diamond',
        w: 160,
        h: 120,
        min: { w: 64, h: 48 },
        draw: (w, h, i) => polygon([[w / 2, i], [w - i, h / 2], [w / 2, h - i], [i, h / 2]]),
        inset: (w, h) => [h / 4, w / 4, h / 4, w / 4], // the largest box inside a diamond is half as wide and half as high
      },
      {
        type: 'pill',
        label: 'Pill',
        w: 160,
        h: 64,
        min: { w: 56, h: 28 },
        draw: (w, h, i) => box(w, h, i, Math.min(w, h) / 2 - i),
        inset: (w, h) => [6, Math.min(w, h) * 0.3 + 4, 6, Math.min(w, h) * 0.3 + 4],
      },
      {
        type: 'parallelogram',
        label: 'Parallelogram',
        w: 180,
        h: 100,
        min: { w: 64, h: 32 },
        draw: (w, h, i) => { const s = slant(w, h); return polygon([[s + i, i], [w - i, i], [w - s - i, h - i], [i, h - i]]); },
        inset: (w, h) => { const s = slant(w, h) * 0.6 + 8; return [8, s, 8, s]; },
        anchorIn: (w, h) => { const s = slant(w, h) / 2; return { left: s, right: s }; },
      },
    ];
    for (const shape of SHAPES) {
      blockTypes.register({
        type: shape.type,
        label: shape.label,
        edit: 'text',
        markup: true,
        valign: 'middle', // the usual: the words are in the middle
        paint: { stroke: { extra: ['none'] }, fill: { extra: ['none'] }, ink: {} },
        weight: true,
        create: () => ({ w: shape.w, h: shape.h, text: '', stroke: 'ink', fill: 'ink', ink: 'ink', weight: 3, size: 'medium', align: 'center' }),
        mark: true, // travels with the picture it is put on (lib-u)
        radius: Boolean(shape.radius),
        shadow: true,
        clean(raw) {
          const out = { w: wb.size(raw.w, shape.min.w, shape.w), h: wb.size(raw.h, shape.min.h, shape.h), text: wb.text(raw.text) };
          if (shape.radius && typeof raw.radius === 'number' && Number.isFinite(raw.radius) && raw.radius >= 0) out.radius = Math.round(Math.min(999, raw.radius));
          if (raw.shadow === 'contact' || raw.shadow === 'soft') out.shadow = raw.shadow;
          return out;
        },
        box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
        resize: { handles: 'corners', min: shape.min },
        linked: [['x', 'y', 'w', 'h']], // its box
        ...(shape.anchorIn ? { anchorIn: (b) => shape.anchorIn(b.w, b.h) } : {}),
        render(b, el) {
          el.classList.add('wb-shape');
          if (b.shadow) el.dataset.shadow = b.shadow; else delete el.dataset.shadow;
          const svg = wb.svg('svg', { class: 'wb-svg', width: b.w, height: b.h, viewBox: `0 0 ${b.w} ${b.h}`, 'aria-hidden': 'true' });
          const body = shape.draw(b.w, b.h, b.stroke === 'none' ? 0.5 : b.weight / 2, shape.radius ? b.radius : undefined);
          body.setAttribute('class', 'wb-hit wb-shape-body');
          svg.append(body);
          const words = document.createElement('div');
          words.className = 'wb-words';
          wbShowWords(words, b.text);
          const inset = shape.inset ? shape.inset(b.w, b.h) : [8, 8, 8, 8];
          el.style.setProperty('--wb-inset', inset.map((n) => `${Math.round(n)}px`).join(' '));
          const shadow = b.shadow && SHADOWS[b.shadow] ? shadowOf(shape, b, b.stroke === 'none' ? 0.5 : b.weight / 2, b.shadow) : null;
          el.replaceChildren(...(shadow ? [shadow] : []), svg, words);
        },
        textOf: (el) => el.querySelector('.wb-words'),
        describe: (b) => { const t = wbPlain(b.text); return t ? `${shape.label}: ${t.slice(0, 80)}` : shape.label; },
      });
    }
  }
