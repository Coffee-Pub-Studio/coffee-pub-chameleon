#!/usr/bin/env node
/*
 * check-whiteboard-picture-edit.mjs -- the Picture tool's Crop and Blur (whiteboard-lib-e-block-image.js, the picture block's
 * crop and blur fields, and whiteboard-lib-f-tool-picture.js).
 * Guards: the block keeps a valid crop and valid blur boxes and drops the rest (outside the picture, too small, not numbers,
 * more than 12); a crop's patch keeps the picture's scale and the cropped part where it was, a second crop works on the part
 * shown, and a crop too small is refused; a blur box is stored as fractions of the WHOLE picture, so a crop does not move
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
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { blockTypes, tools, wbPictureCrop, wbPictureBlur, wbPictureUnblur };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}

if (lib) {
  const { blockTypes, tools, wbPictureCrop, wbPictureBlur, wbPictureUnblur } = lib;
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

  // A crop.
  const pic = { ...base, ...clean({}) };
  const a = { x: 0.25, y: 0.25 };
  const z = { x: 0.75, y: 0.75 };
  const patch = wbPictureCrop(pic, a, z);
  check(patch && same(patch.crop, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }), 'a crop of the middle half is the middle half');
  check(patch && patch.w === 200 && patch.h === 100, 'the cropped part keeps the picture\'s scale (400 by 200 shows a 200 by 100 half)');
  check(patch && patch.x === 200 && patch.y === 100, 'the cropped part stays where it was (100 + 0.25 * 400, 50 + 0.25 * 200)');
  check(same(wbPictureCrop(pic, z, a).crop, patch.crop), 'a box dragged the other way is the same crop');
  check(wbPictureCrop(pic, { x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 }) === null, 'a crop too narrow is refused');
  check(wbPictureCrop(clean({ w: 30, h: 30 }), { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) === null, 'a crop smaller than the least block (24) is refused');
  const cropped = { ...clean({ ...patch }), x: patch.x, y: patch.y }; // what the page holds: the block's own fields and its place
  const second = wbPictureCrop({ ...base, ...cropped }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
  check(second && same(second.crop, { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }), 'a second crop works on the part shown, in the whole picture\'s fractions');
  check(second && second.w === 100 && second.h === 50 && second.x === 200 && second.y === 100, 'a second crop keeps the scale and its place');

  // Blur.
  const shownPic = { ...base, ...cropped };
  const withBlur = wbPictureBlur(shownPic, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
  check(withBlur && same(withBlur[0], { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }), 'a blur box in a cropped picture is stored as fractions of the whole picture');
  check(wbPictureBlur(pic, { x: 0, y: 0 }, { x: 0.001, y: 0.5 }) === null, 'a blur box too narrow is refused');
  check(wbPictureBlur({ ...pic, blur: boxes.slice(0, 12) }, { x: 0, y: 0 }, { x: 0.5, y: 0.5 }) === null, 'a thirteenth blur box is refused');
  const two = { ...pic, blur: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }] };
  check(same(wbPictureUnblur(two, { x: 0.4, y: 0.4 }), [two.blur[0]]), 'a click where two boxes overlap takes the topmost (the last) away');
  check(same(wbPictureUnblur(two, { x: 0.15, y: 0.15 }), [two.blur[1]]), 'a click in one box takes that one away');
  check(wbPictureUnblur(two, { x: 0.9, y: 0.9 }) === null, 'a click outside every box takes nothing away');
  check(wbPictureUnblur({ ...base, ...cropped, blur: [{ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }] }, { x: 0.2, y: 0.2 }) !== null, 'a click in a cropped picture is a point of the part shown, not of the whole');

  // Reset picture.
  const reset = image.actions({ ...base, ...cropped });
  check(reset.length === 1 && reset[0].id === 'reset-picture', 'a cropped picture offers Reset picture');
  const f = reset[0] && reset[0].fields;
  check(f && f.crop === null && f.blur === null && f.w === 400 && f.h === 200 && f.x === 100 && f.y === 50, 'Reset picture puts the whole picture back at its scale, the shown part in place');
  check(image.actions(pic).length === 0, 'a picture with nothing done to it offers no Reset picture');
  check(image.actions({ ...pic, blur: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }).length === 1, 'a blurred picture offers Reset picture');

  // The tools.
  const byId = (id) => tools.get(id);
  check(byId('crop') && byId('crop').key === 'x' && byId('crop').edits === true, 'Crop is a tool on X that edits');
  check(byId('blur') && byId('blur').key === 'j' && byId('blur').edits === true, 'Blur is a tool on J that edits');
}

if (fails.length) {
  console.error(`check-whiteboard-picture-edit: ${fails.length} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-picture-edit: OK, ${passed} cases`);
