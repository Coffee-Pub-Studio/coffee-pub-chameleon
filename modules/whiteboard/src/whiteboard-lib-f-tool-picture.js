  // ---- whiteboard-lib-f-tool-picture.js: crop a picture, blur a part of it ------------------------------------------------
  // The Picture tool in the tool switch: two kinds (the first group on the colour strip), Crop (X) and Blur (J).
  //   Crop  Press a picture to pick it. The whole picture shows, the part outside the crop dimmed, with a frame, a thirds grid
  //         and a grip on each corner and edge (the page draws them: whiteboard.js, syncCropper). Drag a grip to move that edge
  //         or corner, in or out (the picture is never wider than the whole of it); drag inside the frame to slide the picture
  //         under it. The cropped part keeps its scale and stays where it is: only the frame moves. One drag is one undo step.
  //   Blur  Drag a box over a picture to blur that part. Click a blurred box to take it away. At most 12 to a picture.
  // Nothing changes the file: a crop and its blur boxes are fields of the picture block (lib-e-block-image), fractions of
  // the whole picture; Reset picture (the picture's own menu) brings all of it back. The tool stays on (Escape goes back to
  // Select). The picture is the topmost one under the pointer, so a mark drawn over it does not stand in the way.
  //
  // The rules are plain functions, tested on their own (check-whiteboard-picture-edit.mjs). A "part" is { x, y, w, h } in fractions
  // of the WHOLE picture; a point of "the part shown" is a fraction (0 to 1) of what the block shows.
  //   wbPictureCropTo(b, part) -> { crop, x, y, w, h }: the patch that makes `part` the crop, the picture keeping its scale and
  //     the part in place; null when it is too small (2% of the picture, or 24 board units).
  //   wbPictureGripAt(b, p, tol) -> 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw'|null: the grip of the block's box at the board point p
  //     (within tol board units of an edge or corner).
  //   wbPictureGripRect(b, which, p) -> the part when the grip `which` is dragged to the board point p.
  //   wbPicturePan(b, dx, dy) -> the part when the picture is slid by (dx, dy) board units under the frame.
  //   wbPictureBlur(b, a, z) -> the blur list with the box from a to z added, or null; wbPictureUnblur(b, f) -> the list without
  //     the topmost box holding the point f, or null when none holds it.
  const WB_PICTURE_PART = 0.02; // the least part of a picture a crop or a blur box can be, each way
  const WB_PICTURE_BLOCK = 24; // the least a picture block is, in board units
  const wbPictureWhole = { x: 0, y: 0, w: 1, h: 1 };
  const wbPictureShown = (b) => (blockTypes.get('image').cropOf ? blockTypes.get('image').cropOf(b) : wbPictureWhole);
  const wbClamp01 = (v) => Math.max(0, Math.min(1, v));
  const wbPictureRound4 = (n) => Math.round(n * 10000) / 10000;
  const wbPictureRound1 = (n) => Math.round(n * 10) / 10;
  function wbPictureCropTo(b, part) {
    const c = wbPictureShown(b);
    if (!part || part.w < WB_PICTURE_PART || part.h < WB_PICTURE_PART) return null;
    // The picture keeps its scale on the board: so many board units for the whole picture's width and height.
    const sw = b.w / c.w;
    const sh = b.h / c.h;
    const w = wbPictureRound1(part.w * sw);
    const h = wbPictureRound1(part.h * sh);
    if (w < WB_PICTURE_BLOCK || h < WB_PICTURE_BLOCK) return null;
    return { crop: part, x: wbPictureRound1(b.x + (part.x - c.x) * sw), y: wbPictureRound1(b.y + (part.y - c.y) * sh), w, h };
  }
  function wbPictureGripAt(b, p, tol) {
    if (p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) return null;
    const v = Math.abs(p.y - b.y) <= tol ? 'n' : Math.abs(p.y - (b.y + b.h)) <= tol ? 's' : '';
    const h = Math.abs(p.x - b.x) <= tol ? 'w' : Math.abs(p.x - (b.x + b.w)) <= tol ? 'e' : '';
    return v + h || null;
  }
  function wbPictureGripRect(b, which, p) {
    const c = wbPictureShown(b);
    const sw = b.w / c.w;
    const sh = b.h / c.h;
    const fx = c.x + (p.x - b.x) / sw;
    const fy = c.y + (p.y - b.y) / sh;
    const minW = Math.max(WB_PICTURE_PART, WB_PICTURE_BLOCK / sw);
    const minH = Math.max(WB_PICTURE_PART, WB_PICTURE_BLOCK / sh);
    let left = c.x;
    let right = c.x + c.w;
    let top = c.y;
    let bottom = c.y + c.h;
    if (which.includes('w')) left = Math.max(0, Math.min(fx, right - minW));
    if (which.includes('e')) right = Math.min(1, Math.max(fx, left + minW));
    if (which.includes('n')) top = Math.max(0, Math.min(fy, bottom - minH));
    if (which.includes('s')) bottom = Math.min(1, Math.max(fy, top + minH));
    return { x: wbPictureRound4(left), y: wbPictureRound4(top), w: wbPictureRound4(right - left), h: wbPictureRound4(bottom - top) };
  }
  function wbPicturePan(b, dx, dy) {
    const c = wbPictureShown(b);
    // The picture goes with the pointer, so the frame goes the other way over it.
    const x = Math.max(0, Math.min(1 - c.w, c.x - dx / (b.w / c.w)));
    const y = Math.max(0, Math.min(1 - c.h, c.y - dy / (b.h / c.h)));
    return { x: wbPictureRound4(x), y: wbPictureRound4(y), w: c.w, h: c.h };
  }
  // A box of fractions of the whole picture, from two points given as fractions of the part shown.
  const wbPictureBox = (b, a, z) => {
    const c = wbPictureShown(b);
    const x0 = c.x + Math.min(a.x, z.x) * c.w;
    const y0 = c.y + Math.min(a.y, z.y) * c.h;
    const x1 = c.x + Math.max(a.x, z.x) * c.w;
    const y1 = c.y + Math.max(a.y, z.y) * c.h;
    return { x: wbPictureRound4(x0), y: wbPictureRound4(y0), w: wbPictureRound4(x1 - x0), h: wbPictureRound4(y1 - y0) };
  };
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
    const GRIP = 10; // screen pixels from an edge or corner that is its grip (the page draws them 10 across)
    const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
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
    // The one picture that is picked, if it is one.
    const pickedPicture = (ctx) => { const id = ctx.selected(); const b = id ? ctx.get(id) : null; return b && b.type === 'image' ? b : null; };
    const inside = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

    // ---- Crop ----
    let hold = null; // { id, mode: 'grip' | 'pan', which, x, y }
    tools.register({
      id: 'crop',
      label: 'Crop',
      icon: 'crop',
      key: 'x',
      order: 98,
      edits: true,
      cursor: 'default',
      hover(p, ctx) {
        if (!p) { ctx.mark(null); ctx.cursor(null); return; }
        const pic = pickedPicture(ctx);
        if (pic) {
          const g = wbPictureGripAt(pic, p, GRIP / ctx.scale());
          if (g) { ctx.mark(null); ctx.cursor(CURSORS[g]); return; }
          if (inside(pic, p)) { ctx.mark(null); ctx.cursor('move'); return; }
        }
        const hit = pictureAt(p, ctx);
        ctx.mark(hit ? hit.b.id : null, 'ok');
        ctx.cursor(hit ? 'pointer' : null);
      },
      down(p, ctx) {
        const pic = pickedPicture(ctx);
        hold = null;
        if (pic) {
          const g = wbPictureGripAt(pic, p, GRIP / ctx.scale());
          if (g) { hold = { id: pic.id, mode: 'grip', which: g }; return; }
          if (inside(pic, p)) { hold = { id: pic.id, mode: 'pan', x: p.x, y: p.y }; return; }
        }
        const hit = pictureAt(p, ctx);
        ctx.mark(null);
        ctx.select(hit ? hit.b.id : null);
      },
      move(p, ctx) {
        if (!hold) return;
        const b = ctx.get(hold.id);
        if (!b) return;
        if (hold.mode === 'grip') {
          const patch = wbPictureCropTo(b, wbPictureGripRect(b, hold.which, p));
          if (patch) ctx.change(b.id, patch, { save: false });
        } else {
          const part = wbPicturePan(b, p.x - hold.x, p.y - hold.y);
          hold.x = p.x;
          hold.y = p.y;
          ctx.change(b.id, { crop: part }, { save: false });
        }
      },
      up(p, ctx) {
        const was = hold;
        hold = null;
        if (was) ctx.save(was.id); // one save, one undo step, nothing when it was left as it was
      },
      cancel(ctx) { hold = null; ctx.mark(null); ctx.cursor(null); },
      deactivate(ctx) { this.cancel(ctx); },
    });

    // ---- Blur ----
    let drag = null; // { id, a: { x, y } (fractions of the part shown), sx, sy, moved }
    tools.register({
      id: 'blur',
      label: 'Blur',
      icon: 'droplet',
      key: 'j',
      order: 99,
      edits: true,
      cursor: 'crosshair',
      hover(p, ctx) {
        if (!p) { ctx.mark(null); return; }
        const hit = pictureAt(p, ctx);
        ctx.mark(hit ? hit.b.id : null, 'ok');
      },
      down(p, ctx) {
        const hit = pictureAt(p, ctx);
        if (!hit) { ctx.refuseWith('Blur works on a picture. Drag over one.'); drag = null; return; }
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
          // A click: the box under it is taken away.
          const left = wbPictureUnblur(b, z);
          if (left) ctx.change(b.id, { blur: left }, { save: 'now' });
          return;
        }
        const list = wbPictureBlur(b, was.a, z);
        if (list) ctx.change(b.id, { blur: list }, { save: 'now' });
        else ctx.refuseWith(`A picture takes at most ${blockTypes.get('image').MAX_BLUR} blurred parts, and each needs a little room.`);
      },
      cancel(ctx) { drag = null; ctx.marquee(null); ctx.mark(null); },
      deactivate(ctx) { this.cancel(ctx); },
    });
  }
