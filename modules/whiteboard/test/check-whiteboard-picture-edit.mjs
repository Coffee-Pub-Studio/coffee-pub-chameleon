#!/usr/bin/env node
/*
 * check-whiteboard-picture-edit.mjs -- the Picture tool's Crop and Blur (whiteboard-lib-e-block-image.js, the picture block's
 * crop and blur fields, and whiteboard-lib-f-tool-picture.js).
 * Guards: the block keeps a valid crop, valid blur boxes, a corner radius and a shadow, and drops the rest (outside the picture, too
 * small, not numbers, more than 12); a crop's patch keeps the picture's scale and the cropped part where it was; the grips (where
 * they are, what dragging each does: in or out, never past the picture, never under 24 units) and sliding the picture under the frame; a blur box is stored as fractions of the WHOLE picture, so a crop does not move
 * it; a click inside a box takes the topmost one away; Reset picture puts the whole picture back at the same scale with the
 * shown part in place; Crop (X) and Blur (J) are registered. No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-picture-edit.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib;
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { blockTypes, tools, wbPictureCropTo, wbPictureGripAt, wbPictureGripRect, wbPicturePan, wbPictureArea, wbPictureCut, wbPictureRegion, wbPictureBlur, wbPictureUnblur };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}

if (lib) {
  const { blockTypes, tools, wbPictureCropTo, wbPictureGripAt, wbPictureGripRect, wbPicturePan, wbPictureArea, wbPictureCut, wbPictureRegion, wbPictureBlur, wbPictureUnblur } = lib;
  const image = blockTypes.get('image');
  const up = 'a'.repeat(24);
  const base = { id: 'p', type: 'image', x: 100, y: 50, w: 400, h: 200, upload: up };
  const clean = (o) => image.clean({ ...base, ...o });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // The block's own fields.
  check(clean({}).crop === undefined && clean({}).blur === undefined, 'a picture with no crop or blur has neither field');
  check(same(clean({ crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } }).crop, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }), 'a valid crop is kept');
  for (const [what, crop] of [['past the edge', { x: 0.6, y: 0, w: 0.6, h: 1 }], ['too small', { x: 0, y: 0, w: 0.01, h: 0.5 }], ['negative', { x: -0.1, y: 0, w: 0.5, h: 0.5 }], ['not numbers', { x: 'a', y: 0, w: 1, h: 1 }], ['not an object', 5], ['not finite', { x: 0, y: 0, w: NaN, h: 1 }]]) {
    check(clean({ crop }).crop === undefined, `a crop ${what} is dropped`);
  }
  const boxes = Array.from({ length: 15 }, (_, i) => ({ x: 0.01 * i, y: 0.1, w: 0.1, h: 0.1 }));
  check(clean({ blur: boxes }).blur.length === 12, 'at most 12 blur boxes are kept');
  check(clean({ blur: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 2, y: 0, w: 0.5, h: 0.5 }, 'x'] }).blur.length === 1, 'blur boxes that are not valid are dropped one by one');
  check(clean({ blur: 'nope' }).blur === undefined, 'blur that is not a list is dropped');

  // The radius and the shadow.
  check(clean({}).radius === undefined && clean({}).shadow === undefined, 'a picture with square corners and no shadow has neither field');
  check(clean({ radius: 16 }).radius === 16 && clean({ radius: 16.4 }).radius === 16, 'a corner radius is kept, rounded to a whole number');
  check(clean({ radius: 5000 }).radius === 999 && clean({ radius: -3 }).radius === undefined && clean({ radius: 'big' }).radius === undefined, 'a radius is held to 0 to 999 and anything else is none');
  check(clean({ shadow: 'contact' }).shadow === 'contact' && clean({ shadow: 'soft' }).shadow === 'soft', 'Contact and Soft shadows are kept');
  check(clean({ shadow: 'none' }).shadow === undefined && clean({ shadow: 'glow' }).shadow === undefined, 'no shadow, and a shadow that is not one, are not kept');
  check(clean({ crop: { x: 0, y: 0, w: 1, h: 1 } }).crop === undefined, 'a crop of the whole picture is no crop');

  // A crop to a part.
  const pic = { ...base, ...clean({}) };
  const patch = wbPictureCropTo(pic, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  check(patch && same(patch.crop, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }), 'a crop to the middle half is the middle half');
  check(patch && patch.w === 200 && patch.h === 100, 'the cropped part keeps the picture\'s scale (400 by 200 shows a 200 by 100 half)');
  check(patch && patch.x === 200 && patch.y === 100, 'the cropped part stays where it was (100 + 0.25 * 400, 50 + 0.25 * 200)');
  check(wbPictureCropTo(pic, { x: 0.5, y: 0.5, w: 0.01, h: 0.4 }) === null, 'a crop too narrow is refused');
  check(wbPictureCropTo({ ...pic, w: 30, h: 30 }, { x: 0, y: 0, w: 0.5, h: 0.5 }) === null, 'a crop smaller than the least block (24) is refused');
  const cropped = { ...clean({ ...patch }), x: patch.x, y: patch.y }; // what the page holds: the block's own fields and its place
  const shownPic = { ...base, ...cropped };

  // The grips: where they are, and what dragging each does.
  const box = { x: 0, y: 0, w: 100, h: 60 };
  check(wbPictureGripAt(box, { x: 0, y: 0 }, 5) === 'nw' && wbPictureGripAt(box, { x: 100, y: 60 }, 5) === 'se', 'the corners are the corner grips');
  check(wbPictureGripAt(box, { x: 50, y: 2 }, 5) === 'n' && wbPictureGripAt(box, { x: 98, y: 30 }, 5) === 'e' && wbPictureGripAt(box, { x: 3, y: 30 }, 5) === 'w' && wbPictureGripAt(box, { x: 50, y: 59 }, 5) === 's', 'the edges are the edge grips');
  check(wbPictureGripAt(box, { x: 50, y: 30 }, 5) === null && wbPictureGripAt(box, { x: 200, y: 30 }, 5) === null, 'the middle of the picture, and a point far off, are no grip');
  const g1 = wbPictureGripRect(shownPic, 'e', { x: 450, y: 150 }); // the right edge (at 400 on the board) dragged out to 450
  check(g1.x === 0.25 && g1.y === 0.25 && g1.h === 0.5 && Math.abs(g1.w - 0.625) < 1e-9, 'dragging the right edge out widens the crop (and only its width)');
  const g2 = wbPictureGripRect(shownPic, 'w', { x: 0, y: 150 }); // the left edge dragged far out: the picture ends at 0
  check(g2.x === 0 && Math.abs(g2.w - 0.75) < 1e-9, 'dragging the left edge past the picture\'s edge stops at the edge');
  const g3 = wbPictureGripRect(shownPic, 'nw', { x: 1000, y: 1000 }); // dragged far in: the least part is left
  check(g3.w >= 0.06 - 1e-9 && g3.h >= 0.12 - 1e-9 && g3.x + g3.w <= 0.75 + 1e-9 && g3.y + g3.h <= 0.75 + 1e-9, 'dragging a corner far in leaves the least part (24 board units), and never crosses the far edge');
  const g4 = wbPictureGripRect(shownPic, 's', { x: 300, y: 10000 });
  check(g4.y === 0.25 && g4.x === 0.25 && g4.w === 0.5 && Math.abs(g4.h - 0.75) < 1e-9, 'dragging the bottom edge far out stops at the picture\'s edge');
  const wide = wbPictureCropTo(shownPic, g1);
  check(wide && wide.w === 250 && wide.h === 100 && wide.x === 200 && wide.y === 100, 'widening keeps the scale and the left edge in place');

  // Sliding the picture under the frame.
  const slid = wbPicturePan(shownPic, 80, -40); // the picture moves right 80 and up 40: the frame moves left 0.2 and down 0.2
  check(Math.abs(slid.x - 0.05) < 1e-9 && Math.abs(slid.y - 0.45) < 1e-9 && slid.w === 0.5 && slid.h === 0.5, 'sliding the picture right and up moves the frame left and down over it, its size kept');
  const edge = wbPicturePan(shownPic, 10000, 10000);
  check(edge.x === 0 && edge.y === 0, 'sliding the picture far stops with the frame at its edge');

  // Blur.
  const withBlur = wbPictureBlur(shownPic, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
  check(withBlur && same(withBlur[0], { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }), 'a blur box in a cropped picture is stored as fractions of the whole picture');
  check(wbPictureBlur(pic, { x: 0, y: 0 }, { x: 0.001, y: 0.5 }) === null, 'a blur box too narrow is refused');
  check(wbPictureBlur({ ...pic, blur: boxes.slice(0, 12) }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) === null, 'a thirteenth blur box is refused');
  const two = { ...pic, blur: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }] };
  check(same(wbPictureUnblur(two, { x: 0.4, y: 0.4 }), [two.blur[0]]), 'a click where two boxes overlap takes the topmost (the last) away');
  check(same(wbPictureUnblur(two, { x: 0.15, y: 0.15 }), [two.blur[1]]), 'a click in one box takes that one away');
  check(wbPictureUnblur(two, { x: 0.9, y: 0.9 }) === null, 'a click outside every box takes nothing away');
  check(wbPictureUnblur({ ...shownPic, blur: [{ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }] }, { x: 0.2, y: 0.2 }) !== null, 'a click in a cropped picture is a point of the part shown, not of the whole');

  // The holes a cut leaves, and the area copied.
  const hole = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  check(clean({}).cut === undefined && same(clean({ cut: [hole] }).cut, [hole]), 'a picture keeps its holes, and has none unless it was cut');
  check(clean({ cut: [hole, { x: 2, y: 0, w: 0.5, h: 0.5 }, 'x'] }).cut.length === 1 && clean({ cut: 'no' }).cut === undefined, 'holes that are not valid are dropped one by one');
  check(clean({ cut: Array.from({ length: 30 }, (_, i) => ({ x: 0.01 * i, y: 0.1, w: 0.1, h: 0.1 })) }).cut.length === 24, 'at most 24 holes are kept');
  const area = wbPictureArea(shownPic, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
  check(area && same(area, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }), 'an area dragged in a cropped picture is a part of the whole picture');
  check(same(wbPictureArea(shownPic, { x: 0.5, y: 0.5 }, { x: 0, y: 0 }), area), 'an area dragged the other way is the same area');
  check(wbPictureArea(shownPic, { x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }) === null, 'an area too small is no area');
  check(same(wbPictureCut(pic, hole), [hole]) && same(wbPictureCut({ ...pic, cut: [hole] }, area), [hole, area]), 'a cut adds a hole to the list');
  check(wbPictureCut({ ...pic, cut: Array.from({ length: 24 }, () => hole) }, area) === null, 'a twenty-fifth hole is refused');
  const px = wbPictureRegion(1000, 640, { x: 0.25, y: 0.5, w: 0.5, h: 0.25 });
  check(px.sx === 250 && px.sy === 320 && px.sw === 500 && px.sh === 160, 'an area is the same part of the picture\'s own pixels');
  const tiny = wbPictureRegion(100, 100, { x: 0.999, y: 0.999, w: 0.02, h: 0.02 });
  check(tiny.sw >= 1 && tiny.sh >= 1 && tiny.sx + tiny.sw <= 100 && tiny.sy + tiny.sh <= 100, 'an area at the corner is at least a pixel and inside the picture');
  check(image.actions({ ...pic, cut: [hole] }).length === 1 && image.actions({ ...pic, cut: [hole] })[0].fields.cut === null, 'a picture with a hole offers Reset picture, which fills it');

  // The outline of a picture with a hole at its edge.
  const framed = { ...pic, w: 300, h: 200, stroke: 'ink', weight: 10, radius: 16 };
  const outline = (cut, o = {}) => image.outlineOf({ ...framed, ...o, cut }, o.shown || { x: 0, y: 0, w: 1, h: 1 });
  check(outline(undefined) === null && outline([]) === null, 'a picture with no holes has no outline to follow');
  check(outline([{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }]) === null, 'a hole inside the picture has no border of its own (it is just see-through)');
  check(outline([{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }], { stroke: 'none' }) === null && outline([{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }], { stroke: 'none' }) === null, 'a picture with no border has no outline');
  const corner = outline([{ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }]);
  check(corner && corner.t === 10 && corner.W === 300 && corner.H === 200 && corner.r === 16 && corner.rects.length === 1, 'a hole at the corner has an outline');
  check(corner && same(corner.rects[0], { x0: 10 + 0.5 * 280, y0: 10 + 0.5 * 180, x1: 300, y1: 200 }), 'the hole runs out to the box\'s edge on the sides it reaches, and stays on the picture on the others');
  const side = outline([{ x: 0, y: 0.3, w: 0.2, h: 0.2 }]);
  check(side && side.rects[0].x0 === 0 && side.rects[0].x1 === 10 + 0.2 * 280 && side.rects[0].y0 === 10 + 0.3 * 180 && side.rects[0].y1 === 10 + 0.5 * 180, 'a hole at the left edge runs out to the left only');
  const chain = outline([{ x: 0.1, y: 0.4, w: 0.2, h: 0.2 }, { x: 0.25, y: 0.4, w: 0.3, h: 0.2 }, { x: 0.5, y: 0.4, w: 0.5, h: 0.2 }]);
  check(chain && chain.rects.length === 3, 'holes that touch one that reaches the edge are part of the outline too (all three)');
  const mixed = outline([{ x: 0.7, y: 0.1, w: 0.3, h: 0.2 }, { x: 0.2, y: 0.5, w: 0.2, h: 0.2 }]);
  check(mixed && mixed.rects.length === 1, 'a hole inside the picture is left out when another reaches the edge');
  const shownPart = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const cropped2 = outline([{ x: 0.25, y: 0.25, w: 0.2, h: 0.2 }], { shown: shownPart });
  check(cropped2 && cropped2.rects[0].x0 === 0 && cropped2.rects[0].y0 === 0, 'a hole at the edge of the part shown is at the edge, however much of the picture lies beyond it');
  check(outline([{ x: 0.0, y: 0.0, w: 0.2, h: 0.2 }], { shown: shownPart }) === null, 'a hole outside the part shown is not part of the outline');

  // Reset picture.
  const reset = image.actions({ ...base, ...cropped });
  check(reset.length === 1 && reset[0].id === 'reset-picture', 'a cropped picture offers Reset picture');
  const f = reset[0] && reset[0].fields;
  check(f && f.crop === null && f.blur === null && f.w === 400 && f.h === 200 && f.x === 100 && f.y === 50, 'Reset picture puts the whole picture back at its scale, the shown part in place');
  check(image.actions(pic).length === 0, 'a picture with nothing done to it offers no Reset picture');
  check(image.actions({ ...pic, blur: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }).length === 1, 'a blurred picture offers Reset picture');

  // The tools.
  const byId = (id) => tools.get(id);
  check(byId('crop') && byId('crop').key === 'x' && byId('crop').edits === true && byId('crop').cursor === 'default', 'Crop is a tool on X that edits');
  check(byId('area') && byId('area').key === 'k' && byId('area').edits === true && byId('area').cursor === 'crosshair', 'Select area is a tool on K that edits, with a cross');
  check(byId('blur') && byId('blur').key === 'j' && byId('blur').edits === true && byId('blur').cursor === 'crosshair', 'Blur is a tool on J that edits, with a cross');
}

if (fails.length) {
  console.error(`check-whiteboard-picture-edit: ${fails.length} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-picture-edit: OK, ${passed} cases`);
