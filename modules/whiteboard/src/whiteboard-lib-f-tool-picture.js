  // ---- whiteboard-lib-f-tool-picture.js: crop a picture, blur a part of it ------------------------------------------------
  // The Picture tool in the tool switch: two kinds (the first group on the colour strip), Crop (X) and Blur (J). Drag a box
  // over a picture:
  //   Crop  keeps only that part. The cropped part stays where it was, the rest is hidden, not deleted: Reset picture (the
  //         picture's own menu) brings it back. Drag again to crop further.
  //   Blur  blurs that part. Click a blurred box to take it away. At most 12 to a picture.
  // Nothing changes the file: a crop and its blur boxes are fields of the picture block (lib-e-block-image), fractions of
  // the whole picture, and one drag is one save and one undo step. The picture is the topmost one under the pointer, so a
  // mark drawn over it does not stand in the way. The tool stays on (Escape goes back to Select).
  //
  // wbPictureCrop(b, a, z) -> the patch a crop of the box from point a to point z (both fractions of the part shown, 0 to 1)
  // makes, or null when the box is too small, { crop, x, y, w, h }. wbPictureBlur(b, a, z) -> the blur list with that box
  // added, or null. wbPictureUnblur(b, f) -> the list without the topmost box holding the point f (a fraction of the part
  // shown), or null when none holds it.
  const WB_PICTURE_PART = 0.02; // the least part of a picture a crop or a blur box can be, each way
  const wbPictureWhole = { x: 0, y: 0, w: 1, h: 1 };
  const wbPictureShown = (b) => (blockTypes.get('image').cropOf ? blockTypes.get('image').cropOf(b) : wbPictureWhole);
  const wbClamp01 = (v) => Math.max(0, Math.min(1, v));
  // A box of fractions of the picture, from two points given as fractions of the part shown.
  const wbPictureBox = (b, a, z) => {
    const c = wbPictureShown(b);
    const x0 = c.x + Math.min(a.x, z.x) * c.w;
    const y0 = c.y + Math.min(a.y, z.y) * c.h;
    const x1 = c.x + Math.max(a.x, z.x) * c.w;
    const y1 = c.y + Math.max(a.y, z.y) * c.h;
    const r = (n) => Math.round(n * 10000) / 10000;
    return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
  };
  function wbPictureCrop(b, a, z) {
    const c = wbPictureShown(b);
    const box = wbPictureBox(b, a, z);
    if (box.w < WB_PICTURE_PART || box.h < WB_PICTURE_PART) return null;
    // The picture keeps its scale on the board: so many board units for the whole picture's width and height.
    const sw = b.w / c.w;
    const sh = b.h / c.h;
    const w = Math.round(box.w * sw * 10) / 10;
    const h = Math.round(box.h * sh * 10) / 10;
    if (w < 24 || h < 24) return null;
    return { crop: box, x: Math.round((b.x + (box.x - c.x) * sw) * 10) / 10, y: Math.round((b.y + (box.y - c.y) * sh) * 10) / 10, w, h };
  }
  function wbPictureBlur(b, a, z) {
    const box = wbPictureBox(b, a, z);
    const list = Array.isArray(b.blur) ? b.blur : [];
    if (box.w < WB_PICTURE_PART || box.h < WB_PICTURE_PART || list.length >= blockTypes.get('image').MAX_BLUR) return null;
    return [...list, box];
  }
  function wbPictureUnblur(b, f) {
    const c = wbPictureShown(b);
    const px = c.x + f.x * c.w;
    const py = c.y + f.y * c.h;
    const list = Array.isArray(b.blur) ? b.blur : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const q = list[i];
      if (px >= q.x && px <= q.x + q.w && py >= q.y && py <= q.y + q.h) return list.filter((_, k) => k !== i);
    }
    return null;
  }
  {
    const SLOP = 6; // screen pixels a press may wander and still be a click
    let drag = null; // { id, a: { x, y } (fractions of the part shown), sx, sy, moved }
    // The topmost picture whose box holds the board point, and the point as fractions of it.
    function pictureAt(p, ctx) {
      const list = ctx.blocks();
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const b = list[i];
        if (b.type !== 'image' || p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
        return { b, f: { x: wbClamp01((p.x - b.x) / b.w), y: wbClamp01((p.y - b.y) / b.h) } };
      }
      return null;
    }
    const fractionIn = (b, p) => ({ x: wbClamp01((p.x - b.x) / b.w), y: wbClamp01((p.y - b.y) / b.h) });
    const kind = (id, label, icon, key, order, words) => ({
      id,
      label,
      icon,
      key,
      order,
      edits: true,
      cursor: 'crosshair',
      hover(p, ctx) {
        if (!p) { ctx.mark(null); return; }
        const hit = pictureAt(p, ctx);
        ctx.mark(hit ? hit.b.id : null, 'ok');
      },
      down(p, ctx) {
        const hit = pictureAt(p, ctx);
        if (!hit) { ctx.refuseWith(`${words} works on a picture. Drag over one.`); drag = null; return; }
        drag = { id: hit.b.id, a: hit.f, sx: p.sx, sy: p.sy, moved: false };
        ctx.mark(hit.b.id, 'ok');
      },
      move(p, ctx) {
        if (!drag) return;
        if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < SLOP) return;
        drag.moved = true;
        const b = ctx.get(drag.id);
        if (!b) return;
        const z = fractionIn(b, p);
        ctx.marquee({ x0: b.x + drag.a.x * b.w, y0: b.y + drag.a.y * b.h, x1: b.x + z.x * b.w, y1: b.y + z.y * b.h });
      },
      up(p, ctx) {
        const was = drag;
        drag = null;
        ctx.marquee(null);
        if (!was) return;
        const b = ctx.get(was.id);
        if (!b) return;
        const z = fractionIn(b, p);
        if (!was.moved) {
          // A click: Blur takes away the box under it; Crop does nothing.
          if (id === 'blur') { const left = wbPictureUnblur(b, z); if (left) ctx.change(b.id, { blur: left }, { save: 'now' }); }
          return;
        }
        if (id === 'crop') {
          const patch = wbPictureCrop(b, was.a, z);
          if (patch) ctx.change(b.id, patch, { save: 'now' }); else ctx.refuseWith('That part is too small to keep.');
        } else {
          const list = wbPictureBlur(b, was.a, z);
          if (list) ctx.change(b.id, { blur: list }, { save: 'now' }); else ctx.refuseWith(`A picture takes at most ${blockTypes.get('image').MAX_BLUR} blurred parts, and each needs a little room.`);
        }
      },
      cancel(ctx) { drag = null; ctx.marquee(null); ctx.mark(null); },
      deactivate(ctx) { this.cancel(ctx); },
    });
    tools.register(kind('crop', 'Crop', 'crop', 'x', 98, 'Crop'));
    tools.register(kind('blur', 'Blur', 'droplet', 'j', 99, 'Blur'));
  }
