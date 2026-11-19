  // ---- whiteboard-lib-u-marks.js: marks that travel with a picture ---------------------------------------------------------
  // A mark is a drawing, a highlight, a line or arrow, a shape, a note or a text block (a block type marked `mark`). One drawn or
  // put on a picture belongs to it: its `on` field is that picture's id, set when it is saved (wbAttachment), so a mark moved off
  // the picture lets go of it and one moved onto a picture takes it. A picture's marks then go where it goes:
  //   move, copy, cut, duplicate, delete   the marks go with it (lib-e-block-frame, wbFrameFollow; the page's delete set; the
  //                                        copy remaps `on` to the copy's picture, lib-h)
  //   resize                               each mark's place and size scale with the picture (wbScaleMark, below); a line's width,
  //                                        a drawing's width and the size of words stay as they are: they are choices, not shape
  // A crop moves no marks (it hides part of the picture, and the picture keeps its scale).
  // Pure: blocks in, ids and fields out. The page does the saving.
  const wbIsMark = (b) => { const d = b && blockTypes.get(b.type); return Boolean(d && d.mark); };
  const wbIsPicture = (b) => Boolean(b && b.type === 'image');
  // Which picture a mark sits on, among `blocks`: the one it is on already while its middle is still inside it, else the topmost
  // picture (highest z) whose box has the mark's middle and which holds at least half of the mark's box (a line or a stroke
  // with no area counts by its middle). null: none. measure(block) -> the height as drawn, for words that grow (wbRect, lib-m).
  function wbAttachment(mark, blocks, measure = () => 0) {
    const r = wbRect(mark, measure);
    if (!r) return null;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const area = (r.x1 - r.x0) * (r.y1 - r.y0);
    const holds = (p) => {
      const q = wbRect(p, measure);
      if (!q || cx < q.x0 || cx > q.x1 || cy < q.y0 || cy > q.y1) return false;
      if (area <= 0) return true;
      const w = Math.max(0, Math.min(r.x1, q.x1) - Math.max(r.x0, q.x0));
      const h = Math.max(0, Math.min(r.y1, q.y1) - Math.max(r.y0, q.y0));
      return w * h >= area / 2;
    };
    const pictures = blocks.filter((p) => wbIsPicture(p) && p.id !== mark.id);
    const now = mark.on ? pictures.find((p) => p.id === mark.on) : null;
    if (now && holds(now)) return now.id;
    const sitting = pictures.filter(holds).sort((a, b) => b.z - a.z);
    return sitting.length ? sitting[0].id : null;
  }
  // The fields that put a mark where a resize of its picture puts it: f = { ox, oy, sx, sy, nx, ny }: the picture's old top left,
  // the factors by which its width and height changed, and its new top left. A point (x, y) goes to (nx + (x - ox) * sx,
  // ny + (y - oy) * sy); sizes scale by sx and sy (a drawing's points and a line's vector too), widths of lines and words'
  // sizes are left. The block's own clean (wbClean) keeps what it must (a note's least size).
  function wbScaleMark(b, f) {
    const x = f.nx + (b.x - f.ox) * f.sx;
    const y = f.ny + (b.y - f.oy) * f.sy;
    if (Array.isArray(b.points)) return { x, y, points: b.points.map((v, i) => v * (i % 2 ? f.sy : f.sx)) };
    if (typeof b.dx === 'number' && typeof b.dy === 'number') return { x, y, dx: b.dx * f.sx, dy: b.dy * f.sy };
    if (typeof b.w === 'number' && typeof b.h === 'number') {
      const out = { x, y, w: b.w * f.sx, h: b.h * f.sy };
      if (b.pointer && typeof b.pointer.dx === 'number') out.pointer = { ...b.pointer, dx: b.pointer.dx * f.sx, dy: b.pointer.dy * f.sy };
      return out;
    }
    if (typeof b.w === 'number') return { x, y, w: b.w * f.sx };
    return { x, y };
  }

  // What Flatten bakes into one picture (the Picture tool's Flatten): the picture as it is shown (its crop, its blurred boxes, its holes) and
  // its marks, drawn as one new picture, in place of the picture and the marks. Pure: the picture and the blocks in, the plan out:
  //   marks    the marks on it, bottom to top
  //   content  the part of the board its picture fills inside its border: { x, y, w, h }
  //   extent   what the new picture shows: that, and any part of a mark that hangs over its edge (so nothing is cut off)
  //   box      the new picture's block: the extent and the border's width round it, so a picture with nothing hanging over keeps its box
  // wbNeedsFlatten(pic, plan): whether there is anything to bake (a crop, a blur, a hole or a mark).
  function wbFlattenPlan(pic, blocks, measure = () => 0) {
    const t = pic.stroke === 'none' ? 0 : Math.max(0, pic.weight || 0);
    const marks = blocks.filter((m) => m.on === pic.id && wbIsMark(m)).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    const content = { x: pic.x + t, y: pic.y + t, w: Math.max(1, pic.w - 2 * t), h: Math.max(1, pic.h - 2 * t) };
    let x0 = content.x; let y0 = content.y; let x1 = content.x + content.w; let y1 = content.y + content.h;
    for (const m of marks) {
      const r = wbRect(m, measure);
      if (!r) continue;
      x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
    }
    const r1 = (n) => Math.round(n * 10) / 10;
    const extent = { x: r1(Math.floor(x0 * 10) / 10), y: r1(Math.floor(y0 * 10) / 10), w: 0, h: 0 };
    extent.w = r1(Math.ceil(x1 * 10) / 10 - extent.x);
    extent.h = r1(Math.ceil(y1 * 10) / 10 - extent.y);
    const box = { x: r1(extent.x - t), y: r1(extent.y - t), w: r1(extent.w + 2 * t), h: r1(extent.h + 2 * t) };
    return { t, marks, content, extent, box };
  }
  const wbNeedsFlatten = (pic, plan) => Boolean(pic.crop || (pic.blur && pic.blur.length) || (pic.cut && pic.cut.length) || (plan && plan.marks.length));
