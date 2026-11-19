  // ---- whiteboard-lib-e-block-image.js: a picture ------------------------------------------------------------------------
  // { ...block, upload, w, h, alt, stroke, weight }: a picture from the person's computer, kept as one of the module's
  // uploads (upload: its id; the bytes are never in the block), drawn w by h board units, with a few words that say what it
  // shows (alt: what a screen reader reads, and the tooltip) and a border only when one is picked (stroke 'none' at first).
  // Crop and Blur (the Picture tool, lib-f-tool-picture) change what is shown and never the file: crop { x, y, w, h } is the
  // part of the picture shown and blur [{ x, y, w, h }] the boxes drawn blurred, both as fractions of the WHOLE picture
  // (0 to 1), so a crop does not move a blur box. w and h are the size of the part shown (it keeps the picture's scale: the
  // cropped part stays where it was); Reset picture (the block's menu) brings the rest back.
  // cut [{ x, y, w, h }] are the holes Cut (the Picture tool's Select area) leaves: boxes of the whole picture, drawn see-through. Like
  // a crop or a blur they hide and never remove: the file still has those pixels, and Reset picture brings them back.
  // radius (board units, 0 for square corners; 999 rounds it all the way) and shadow ('none', 'contact': a tight shadow under the
  // bottom edge only, like the picture resting on the board, or 'soft', shown as Drop shadow: the all-round one) are how the picture is drawn.
  // A corner changes its size and always keeps its shape. Double-click (or Enter) to describe it. Copies share the upload,
  // and deleting the block leaves the upload where it is, so an undo brings the same picture back (lib-i, and the page).
  //
  // Where a picture is read from is the page's: it sets source(upload, thumb) -> a promise of the address. The thumbnail
  // (about 400 px) is shown while the block is small enough for it (its longest side, in the screen's pixels at 100%, fits
  // 400), else the whole picture, and the whole picture when there is no thumbnail. A picture that is not there any more
  // (its upload was removed) shows "Picture not found" in its place.
  {
    const THUMB = 400;
    const UPLOAD = /^[a-f0-9]{24}$/;
    const addresses = new Map(); // `${upload}:${thumb}` -> a promise of the address
    const noThumb = new Set(); // uploads whose thumbnail could not be read: the whole picture from then on
    // The words that describe a picture: one line, at most 300 characters.
    const altOf = (v) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, 300) : '');
    const MIN_PART = 0.02; // the least part of the picture a crop or a blur box can be, in each direction
    const MAX_BLUR = 12;
    const MAX_CUT = 24;
    // A box of fractions of the whole picture, or null: finite numbers, inside the picture, at least MIN_PART each way.
    function partOf(v) {
      if (!v || typeof v !== 'object') return null;
      const n = (k) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? Math.round(v[k] * 10000) / 10000 : NaN);
      const x = n('x'); const y = n('y'); const w = n('w'); const h = n('h');
      if (![x, y, w, h].every((q) => q >= 0 && q <= 1) || w < MIN_PART || h < MIN_PART || x + w > 1.0001 || y + h > 1.0001) return null;
      return { x, y, w, h };
    }
    const WHOLE = { x: 0, y: 0, w: 1, h: 1 };
    const SHADOWS = ['none', 'contact', 'soft'];
    const MAX_RADIUS = 999;
    const cropOf = (b) => partOf(b && b.crop) || WHOLE;
    // The outline of a picture with a hole at its edge: where a cut reaches the picture's edge (or another such cut), the border follows
    // the cut instead of running on across it. A cut inside the picture has no border (it is just see-through). null when there is nothing to
    // do: no border, no cuts, or only cuts inside. Pure: the block and the part shown in, { t, W, H, r, rects } out (all in board units
    // of the block's own box: the border's width, the box, its corner radius, and each such cut as a rectangle, run out to the box's edge
    // on any side it reaches).
    function outlineOf(b, c) {
      const t = b.stroke === 'none' ? 0 : Math.max(0, b.weight || 0);
      if (!t || !Array.isArray(b.cut) || !b.cut.length) return null;
      const W = b.w; const H = b.h; const cw = W - 2 * t; const ch = H - 2 * t;
      if (cw <= 0 || ch <= 0) return null;
      const eps = 0.0005;
      const holes = [];
      for (const q of b.cut) {
        const x0 = Math.max(0, (q.x - c.x) / c.w); const y0 = Math.max(0, (q.y - c.y) / c.h);
        const x1 = Math.min(1, (q.x + q.w - c.x) / c.w); const y1 = Math.min(1, (q.y + q.h - c.y) / c.h);
        if (x1 > x0 && y1 > y0) holes.push({ x0, y0, x1, y1 });
      }
      const touches = (h) => h.x0 <= eps || h.y0 <= eps || h.x1 >= 1 - eps || h.y1 >= 1 - eps;
      const meet = (p, q) => p.x0 <= q.x1 + eps && q.x0 <= p.x1 + eps && p.y0 <= q.y1 + eps && q.y0 <= p.y1 + eps;
      const outer = new Set();
      holes.forEach((h, i) => { if (touches(h)) outer.add(i); });
      for (let again = true; again;) {
        again = false;
        holes.forEach((h, i) => { if (!outer.has(i) && [...outer].some((j) => meet(h, holes[j]))) { outer.add(i); again = true; } });
      }
      if (!outer.size) return null;
      const r = Math.min(b.radius || 0, W / 2, H / 2);
      const rects = [...outer].map((i) => {
        const h = holes[i];
        return { x0: h.x0 <= eps ? 0 : t + h.x0 * cw, y0: h.y0 <= eps ? 0 : t + h.y0 * ch, x1: h.x1 >= 1 - eps ? W : t + h.x1 * cw, y1: h.y1 >= 1 - eps ? H : t + h.y1 * ch };
      });
      return { t, W, H, r, rects };
    }
    // The overlay that draws it: a band along the box's edge and along each such cut, drawn only where the picture is (a mask of the box
    // less those cuts), so the band follows the cut. The block's own border goes transparent while it is there (it is the same width, so
    // nothing moves).
    function syncOutline(el, b, c) {
      const o = outlineOf(b, c);
      let svg = el.querySelector('.wb-outline');
      if (!o) { if (svg) svg.remove(); delete el.dataset.outline; return; }
      el.dataset.outline = 'true';
      if (!svg) {
        svg = wb.svg('svg', { class: 'wb-outline', 'aria-hidden': 'true' });
        el.insertBefore(svg, el.querySelector('.wb-missing'));
      }
      svg.setAttribute('width', o.W);
      svg.setAttribute('height', o.H);
      svg.setAttribute('viewBox', `0 0 ${o.W} ${o.H}`);
      const band = [wb.svg('rect', { x: o.t / 2, y: o.t / 2, width: Math.max(1, o.W - o.t), height: Math.max(1, o.H - o.t), rx: Math.max(0, o.r - o.t / 2), 'stroke-width': o.t })];
      for (const q of o.rects) band.push(wb.svg('rect', { x: q.x0, y: q.y0, width: q.x1 - q.x0, height: q.y1 - q.y0, 'stroke-width': o.t * 2 }));
      svg.replaceChildren(...band);
      // The mask: the box (its corners) less each cut, by alpha, as the holes in the picture are made (no colour in it).
      const shape = (q, rx) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${o.W} ${o.H}' preserveAspectRatio='none'><rect x='${q.x0}' y='${q.y0}' width='${q.x1 - q.x0}' height='${q.y1 - q.y0}' rx='${rx}'/></svg>`)}")`;
      const layers = [shape({ x0: 0, y0: 0, x1: o.W, y1: o.H }, o.r), ...o.rects.map((q) => shape(q, 0))];
      const mask = { image: layers.join(', '), composite: layers.map((_, i) => (i === 0 ? 'subtract' : 'add')).join(', '), size: layers.map(() => '100% 100%').join(', ') };
      setMask(svg, mask);
    }
    // The mask that makes the holes see-through, with no colour in it: the whole picture's box, then each hole's box, each as an SVG of
    // that shape, combined by their alpha: the whole box less every hole (mask-composite subtract, then add for the holes among
    // themselves, so holes that overlap are still just holes). null for no holes.
    const boxSvg = (q) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><rect x='${q.x}' y='${q.y}' width='${q.w}' height='${q.h}'/></svg>`)}")`;
    function holeMask(cut) {
      if (!Array.isArray(cut) || !cut.length) return null;
      const layers = [boxSvg(WHOLE), ...cut.map(boxSvg)];
      return { image: layers.join(', '), composite: layers.map((_, i) => (i === 0 ? 'subtract' : 'add')).join(', '), size: layers.map(() => '100% 100%').join(', ') };
    }
    function setMask(img, mask) {
      if (!mask) { for (const k of ['mask-image', '-webkit-mask-image', 'mask-composite', 'mask-size', '-webkit-mask-size']) img.style.removeProperty(k); return; }
      img.style.setProperty('mask-image', mask.image);
      img.style.setProperty('-webkit-mask-image', mask.image);
      img.style.setProperty('mask-composite', mask.composite);
      img.style.setProperty('mask-size', mask.size);
      img.style.setProperty('-webkit-mask-size', mask.size);
    }
    // Draw the whole picture inside an element that shows only `part` of it (fractions of the whole): nothing set for all of it.
    function place(img, part) {
      if (part.x === 0 && part.y === 0 && part.w === 1 && part.h === 1 && !img.classList.contains('wb-blur-img')) {
        for (const k of ['position', 'left', 'top', 'width', 'height', 'maxWidth']) img.style[k] = '';
        return;
      }
      img.style.position = 'absolute';
      img.style.maxWidth = 'none';
      img.style.width = `${100 / part.w}%`;
      img.style.height = `${100 / part.h}%`;
      img.style.left = `${-(part.x / part.w) * 100}%`;
      img.style.top = `${-(part.y / part.h) * 100}%`;
    }

    function show(def, el, img, upload, thumb) {
      const t = thumb && !noThumb.has(upload);
      const want = `${upload}:${t ? 1 : 0}`;
      if (img.dataset.want === want) return;
      img.dataset.want = want;
      delete el.dataset.missing;
      if (!def.source) return;
      let address = addresses.get(want);
      if (!address) { address = Promise.resolve(def.source(upload, t)); addresses.set(want, address); }
      address.then((src) => { if (img.dataset.want === want) img.src = src; }, () => { addresses.delete(want); el.dataset.missing = 'true'; });
    }

    blockTypes.register({
      type: 'image',
      label: 'Picture',
      noun: () => 'picture',
      edit: 'text',
      // The words edited are the description: one short line under the picture.
      textField: 'alt',
      textLine: true,
      textLabel: 'Describe the picture',
      textMax: 300,
      editLabel: 'Describe',
      paint: { stroke: { extra: ['none'] } },
      weight: true,
      create: () => ({ upload: '', w: 320, h: 240, alt: '', stroke: 'none', weight: 2 }),
      clean(raw) {
        // A picture with no upload is not a block: nothing is ever saved that points at a file that is not there yet.
        if (typeof raw.upload !== 'string' || !UPLOAD.test(raw.upload)) return null;
        const out = { upload: raw.upload, w: wb.size(raw.w, 24, 320), h: wb.size(raw.h, 24, 240), alt: altOf(raw.alt) };
        const crop = partOf(raw.crop);
        // A crop of the whole picture is no crop.
        if (crop && !(crop.x === 0 && crop.y === 0 && crop.w >= 0.9999 && crop.h >= 0.9999)) out.crop = crop;
        const radius = typeof raw.radius === 'number' && Number.isFinite(raw.radius) ? Math.round(Math.max(0, Math.min(MAX_RADIUS, raw.radius))) : 0;
        if (radius > 0) out.radius = radius;
        if (SHADOWS.includes(raw.shadow) && raw.shadow !== 'none') out.shadow = raw.shadow;
        const blur = Array.isArray(raw.blur) ? raw.blur.map(partOf).filter(Boolean).slice(0, MAX_BLUR) : [];
        if (blur.length) out.blur = blur;
        const cut = Array.isArray(raw.cut) ? raw.cut.map(partOf).filter(Boolean).slice(0, MAX_CUT) : [];
        if (cut.length) out.cut = cut;
        return out;
      },
      altOf,
      radius: true,
      shadow: true,
      cropOf,
      outlineOf,
      MAX_BLUR,
      MAX_CUT,
      SHADOWS,
      MAX_RADIUS,
      // The block's own menu entry (a block type's `actions`): Reset picture, only while it is cropped or blurred. It puts the
      // whole picture back at the scale it has now, the part that was shown staying where it is.
      actions(b) {
        if (!b.crop && !(b.blur && b.blur.length) && !(b.cut && b.cut.length)) return [];
        const c = cropOf(b);
        const w = Math.min(b.w / c.w, 6000);
        const h = Math.min(b.h / c.h, 6000);
        return [{ id: 'reset-picture', label: 'Reset picture', icon: 'rotate-left', fields: { crop: null, blur: null, cut: null, x: Math.round((b.x - c.x * w) * 10) / 10, y: Math.round((b.y - c.y * h) * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 } }];
      },
      box: (b) => ({ x: 0, y: 0, w: b.w, h: b.h }),
      // keep: a corner always keeps the picture's shape (Shift is not needed).
      resize: { handles: 'corners', min: { w: 24, h: 24 }, keep: true },
      linked: [['x', 'y', 'w', 'h']], // its box
      source: null,
      render(b, el) {
        let img = el.querySelector('.wb-picture');
        if (!img) {
          img = document.createElement('img');
          img.className = 'wb-picture';
          img.alt = ''; // the block itself carries the description (its aria-label)
          img.draggable = false;
          img.decoding = 'async';
          img.addEventListener('error', () => {
            const [upload, t] = (img.dataset.want || ':').split(':');
            if (t === '1') { noThumb.add(upload); show(this, el, img, upload, false); } else el.dataset.missing = 'true';
          });
          const missing = document.createElement('div');
          missing.className = 'wb-missing';
          missing.setAttribute('aria-hidden', 'true');
          missing.textContent = 'Picture not found';
          const alt = document.createElement('div');
          alt.className = 'wb-alt';
          alt.setAttribute('aria-hidden', 'true');
          // The picture, its faint whole (while cropping) and its blurred boxes live in a wrapper that clips them to the picture's box
          // and its corners, so the block itself can draw outside its box (the outline of a picture with a hole at its edge).
          const pic = document.createElement('div');
          pic.className = 'wb-pic';
          pic.appendChild(img);
          el.replaceChildren(pic, missing, alt);
        }
        const pic = el.querySelector('.wb-pic');
        if (b.alt) el.title = b.alt; else el.removeAttribute('title');
        el.style.borderRadius = b.radius ? `${b.radius}px` : '';
        // The wrapper's corners are the block's inside its border (its border is as wide as the line weight, or none).
        const edge = b.stroke === 'none' ? 0 : Math.max(0, b.weight || 0);
        pic.style.borderRadius = b.radius ? `${Math.max(0, b.radius - edge)}px` : '';
        syncOutline(el, b, cropOf(b));
        if (b.shadow) el.dataset.shadow = b.shadow; else delete el.dataset.shadow;
        // A picture with holes casts its shadow from what is shown (a filter, so a hole is lit like a cut-out); one without, from its box.
        if (b.cut && b.cut.length) el.dataset.holes = 'true'; else delete el.dataset.holes;
        const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // The picture is placed through its crop: the whole picture is drawn 1/w by 1/h as big as the block and moved so the
        // part shown fills the block. What is shown is smaller than the picture, so the thumbnail is used only while the
        // WHOLE picture, at this scale, still fits it.
        const c = cropOf(b);
        const thumb = Math.max(b.w / c.w, b.h / c.h) * ratio <= THUMB;
        place(img, c, WHOLE);
        // The picture is shown through the crop (and clipped to it, so the page can let the rest show while it is cropped).
        img.style.clipPath = b.crop ? `inset(${c.y * 100}% ${(1 - c.x - c.w) * 100}% ${(1 - c.y - c.h) * 100}% ${c.x * 100}%)` : '';
        show(this, el, img, b.upload, thumb);
        // While the Crop tool has it picked (el.dataset.cropping), the whole picture shows faintly round the part kept: a copy
        // of it behind, hidden the rest of the time.
        let ghost = el.querySelector('.wb-crop-ghost');
        if (b.crop && !ghost) {
          ghost = document.createElement('img');
          ghost.className = 'wb-crop-ghost';
          ghost.alt = '';
          ghost.draggable = false;
          ghost.decoding = 'async';
          ghost.setAttribute('aria-hidden', 'true');
          pic.insertBefore(ghost, img);
        } else if (!b.crop && ghost) { ghost.remove(); ghost = null; }
        if (ghost) { place(ghost, c, WHOLE); show(this, el, ghost, b.upload, thumb); }
        // The holes (Cut): the picture and its blurred copies are drawn through a mask that is see-through in each hole (the masks
        // are of the whole picture, and each of those images is the whole picture, only placed differently).
        const hole = holeMask(b.cut);
        setMask(img, hole);
        // The blur boxes: each its own copy of the picture, blurred, clipped to its box (so nothing but the picture's own
        // pixels, drawn the same way in the saved image: lib-l draws this element, and a backdrop filter would not carry over).
        const boxes = Array.isArray(b.blur) ? b.blur.filter((q) => q.x < c.x + c.w && q.x + q.w > c.x && q.y < c.y + c.h && q.y + q.h > c.y) : [];
        const have = el.querySelectorAll('.wb-blur');
        for (let i = have.length; i > boxes.length; i -= 1) have[i - 1].remove();
        boxes.forEach((q, i) => {
          let box = have[i];
          if (!box) {
            box = document.createElement('div');
            box.className = 'wb-blur';
            box.setAttribute('aria-hidden', 'true');
            const copy = document.createElement('img');
            copy.className = 'wb-picture wb-blur-img';
            copy.alt = '';
            copy.draggable = false;
            copy.decoding = 'async';
            box.appendChild(copy);
            pic.appendChild(box);
          }
          const copy = box.firstChild;
          box.style.left = `${((q.x - c.x) / c.w) * 100}%`;
          box.style.top = `${((q.y - c.y) / c.h) * 100}%`;
          box.style.width = `${(q.w / c.w) * 100}%`;
          box.style.height = `${(q.h / c.h) * 100}%`;
          place(copy, q, WHOLE);
          // The blur is a share of the box's least side in the screen's pixels (a small box a little, a big one a lot).
          const side = Math.min((q.w / c.w) * b.w, (q.h / c.h) * b.h);
          copy.style.filter = `blur(${Math.max(8, Math.min(32, Math.round(side * 0.2)))}px)`;
          setMask(copy, hole);
          show(this, el, copy, b.upload, thumb);
        });
      },
      textOf: (el) => el.querySelector('.wb-alt'),
      // Saved as a picture (lib-l): the upload put in as a data URL (the thumbnail while it is big enough for the picture's
      // pixels), so the picture holds it; one that cannot be read is drawn as "Picture not found". Printed, as it is shown.
      async exported(b, el, ctx) {
        if (ctx.live) return;
        // The faint whole picture of a crop being adjusted is never part of a picture.
        delete el.dataset.cropping;
        // Flat (Flatten): the picture alone, as it is drawn inside its border: no border colour (its width stays, so the picture is where it
        // was), no corners, no shadow and no outline; the page's Flatten saves what is drawn as the new picture, and the block keeps its own look.
        if (ctx.flat) {
          for (const k of ['shadow', 'holes', 'outline']) delete el.dataset[k];
          el.style.borderColor = 'transparent';
          el.style.removeProperty('border-radius');
          const wrap = el.querySelector('.wb-pic');
          if (wrap) wrap.style.removeProperty('border-radius');
          for (const n of el.querySelectorAll('.wb-outline')) n.remove();
        }
        const img = el.querySelector('.wb-picture');
        if (!img) return;
        const c = cropOf(b);
        const src = await ctx.picture(b.upload, Math.max(b.w / c.w, b.h / c.h) * ctx.scale <= THUMB);
        // The blurred copies hold the picture too (the same address as the picture itself).
        for (const one of el.querySelectorAll('.wb-picture')) {
          one.removeAttribute('decoding');
          if (src) one.setAttribute('src', src); else one.removeAttribute('src');
        }
        if (src) delete el.dataset.missing; else el.dataset.missing = 'true';
      },
      describe: (b) => (b.alt ? `Picture: ${b.alt.slice(0, 120)}` : 'Picture'),
    });
  }
