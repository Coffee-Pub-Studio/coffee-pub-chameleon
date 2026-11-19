#!/usr/bin/env node
/*
 * check-whiteboard-marks.mjs -- marks that travel with a picture (whiteboard-lib-u-marks.js, and what it hooks into: the block's
 * `on` field in wbClean, wbFrameFollow, wbCopies, wbDeleteSet).
 * Guards: only the mark types (drawing, highlight, line, shape, note, text) hold `on`, and a picture or a table never does; a mark is
 * on the picture its middle is in (the one it is on already while it stays in it, else the topmost), and none when it is mostly off;
 * a picture that moves takes its marks (and a locked picture, or a locked mark, takes none), and not those already moving; a resize
 * scales each mark's place and size by the picture's change and leaves line widths and words' sizes alone, for drawings, lines, notes
 * with a pointer, shapes and text; a copy of a picture and its marks puts the copies' marks on the copy, and a copy of a mark alone is on
 * none; deleting a picture deletes its marks. No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-marks.mjs [path to the module's src folder]. Exits 1 on any failure.
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
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { blockTypes, wbClean, wbIsMark, wbAttachment, wbScaleMark, wbFrameFollow, wbCopies, wbDeleteSet, wbRect };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}

if (lib) {
  const { blockTypes, wbClean, wbIsMark, wbAttachment, wbScaleMark, wbFrameFollow, wbCopies, wbDeleteSet } = lib;
  const up = 'a'.repeat(24);
  const pic = (o = {}) => ({ id: 'pic', type: 'image', x: 100, y: 100, z: 1, w: 400, h: 200, upload: up, ...o });
  const rect = (o = {}) => ({ id: 'r1', type: 'rect', x: 150, y: 150, z: 5, w: 100, h: 50, text: '', stroke: 'ink', fill: 'gold', ink: 'ink', weight: 3, size: 'medium', align: 'center', ...o });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // Which blocks are marks, and the `on` field.
  for (const t of ['stroke', 'highlight', 'line', 'note', 'text', 'rect', 'ellipse', 'rounded', 'diamond', 'pill', 'parallelogram']) check(blockTypes.get(t).mark === true, `${t} is a mark`);
  for (const t of ['image', 'table', 'frame', 'connector', 'timer']) check(!blockTypes.get(t).mark, `${t} is not a mark`);
  check(wbClean(rect({ on: 'pic' })).on === 'pic', 'a mark keeps the picture it is on');
  check(wbClean(rect()).on === undefined && wbClean(rect({ on: 5 })).on === undefined && wbClean(rect({ on: 'a b' })).on === undefined, 'a mark with no picture, or a bad id, has none');
  check(wbClean(rect({ id: 'r1', on: 'r1' })).on === undefined, 'a mark is never on itself');
  check(wbClean(pic({ on: 'x' })).on === undefined, 'a picture is on nothing');
  check(wbIsMark(rect()) && !wbIsMark(pic()) && !wbIsMark(null), 'wbIsMark says which are marks');

  // Which picture a mark is on.
  const A = pic({ id: 'A', x: 0, y: 0, z: 1, w: 400, h: 300 });
  const B = pic({ id: 'B', x: 100, y: 100, z: 3, w: 400, h: 300 }); // on top of A, overlapping it
  check(wbAttachment(rect({ x: 20, y: 20 }), [A]) === 'A', 'a mark inside a picture is on it');
  check(wbAttachment(rect({ x: 1000, y: 1000 }), [A]) === null, 'a mark off every picture is on none');
  check(wbAttachment(rect({ x: 380, y: 100, w: 100, h: 50 }), [A]) === null, 'a mark whose middle is off the picture is on none');
  check(wbAttachment(rect({ x: 300, y: 100, w: 140, h: 50 }), [A]) === 'A', 'a mark across the edge with its middle inside and most of it on the picture is on it');
  check(wbAttachment(rect({ x: 360, y: 100, w: 100, h: 50 }), [A]) === null, 'a mark across the edge with its middle outside is on none');
  check(wbAttachment(rect({ x: 150, y: 150 }), [A, B]) === 'B', 'where two pictures overlap a mark is on the topmost');
  check(wbAttachment(rect({ x: 150, y: 150, on: 'A' }), [A, B]) === 'A', 'a mark stays on the picture it is on while its middle is still in it');
  check(wbAttachment(rect({ x: 450, y: 350, on: 'A' }), [A, B]) === 'B', 'a mark moved out of its picture and onto another is on the other');
  const stroke = { id: 's1', type: 'stroke', x: 50, y: 50, z: 6, points: [0, 0, 100, 0], brush: 'pen', stroke: 'ink', weight: 3 };
  check(wbAttachment(stroke, [A]) === 'A', 'a drawing on a picture is on it');
  check(wbAttachment({ ...stroke, x: 2000 }, [A]) === null, 'a drawing off it is on none');

  // A picture that moves takes its marks.
  const blocks = [pic(), rect({ on: 'pic' }), rect({ id: 'r2', x: 900, y: 900 }), rect({ id: 'r3', on: 'pic', locked: true })];
  const f = wbFrameFollow([{ id: 'pic', dx: 10, dy: 20 }], blocks);
  check(f.moves.length === 1 && f.moves[0].id === 'r1' && f.moves[0].dx === 10 && f.moves[0].dy === 20, 'a picture that moves takes the marks on it, by its amount');
  check(f.locked === 1, 'a locked mark on it stays, and is counted');
  check(wbFrameFollow([{ id: 'pic', dx: 1, dy: 1 }, { id: 'r1', dx: 1, dy: 1 }], blocks).moves.every((m) => m.id !== 'r1'), 'a mark that is moving anyway is not taken twice');
  check(wbFrameFollow([{ id: 'pic', dx: 1, dy: 1 }], [pic({ locked: true }), rect({ on: 'pic' })]).moves.length === 0, 'a locked picture takes none');
  check(wbFrameFollow([{ id: 'pic', dx: 1, dy: 1 }], [pic({ locked: true }), rect({ on: 'pic' })], { keepLocked: true }).moves.length === 1, 'a copy takes the marks of a locked picture too');
  check(wbFrameFollow([{ id: 'r1', dx: 5, dy: 5 }], blocks).moves.length === 0, 'a mark that moves alone takes nothing');

  // A resize scales the marks.
  const fac = { ox: 100, oy: 100, sx: 2, sy: 0.5, nx: 100, ny: 100 };
  const r = wbScaleMark(rect({ on: 'pic' }), fac);
  check(r.x === 100 + 50 * 2 && r.y === 100 + 50 * 0.5 && r.w === 200 && r.h === 25, 'a shape\'s place and size scale about the picture\'s corner');
  const moved = wbScaleMark(rect({ on: 'pic' }), { ox: 100, oy: 100, sx: 1, sy: 1, nx: 300, ny: 40 });
  check(moved.x === 350 && moved.y === 90 && moved.w === 100 && moved.h === 50, 'with no change of size, only the place follows the picture\'s corner');
  const s = wbScaleMark({ ...stroke, x: 150, y: 150 }, fac);
  check(s.x === 200 && s.y === 125 && same(s.points, [0, 0, 200, 0]), 'a drawing\'s place and points scale, and its width is not in what changes');
  check(!('weight' in s) && !('weight' in r), 'a line\'s width is left alone');
  const line = wbScaleMark({ id: 'l', type: 'line', x: 150, y: 150, dx: 100, dy: 40, weight: 3, stroke: 'ink', arrow: true }, fac);
  check(line.x === 200 && line.y === 125 && line.dx === 200 && line.dy === 20, 'a line\'s start and its vector scale');
  const note = wbScaleMark({ id: 'n', type: 'note', x: 150, y: 150, w: 180, h: 100, pointer: { dx: 60, dy: 80 }, size: 'large' }, fac);
  check(note.w === 360 && note.h === 50 && note.pointer.dx === 120 && note.pointer.dy === 40 && !('size' in note), 'a note\'s box and its pointer scale, and the size of its words does not');
  const text = wbScaleMark({ id: 't', type: 'text', x: 150, y: 150, w: 100 }, fac);
  check(text.w === 200 && !('h' in text), 'a text block\'s width scales (its height is its words\')');
  check(wbClean(rect({ ...wbScaleMark(rect({ on: 'pic' }), { ox: 100, oy: 100, sx: 0.01, sy: 0.01, nx: 100, ny: 100 }) })).w >= 16, 'a mark scaled very small keeps its least size');

  // Copies.
  const copies = wbCopies([pic(), rect({ on: 'pic' })], { newId: (() => { let n = 0; return () => `c${(n += 1)}`; })() });
  const copyOfPic = copies.find((c) => c.type === 'image');
  const copyOfMark = copies.find((c) => c.type === 'rect');
  check(copyOfMark.on === copyOfPic.id && copyOfPic.id !== 'pic', 'a copy of a picture and its marks has the marks on the copy');
  check(wbCopies([rect({ on: 'pic' })], { newId: () => 'c9' })[0].on === undefined, 'a copy of a mark without its picture is on none');

  // Delete.
  const refsOf = (b) => { const d = blockTypes.get(b.type); const own = d && d.refs ? d.refs(b) : []; return b.on ? [...own, b.on] : own; };
  const gone = wbDeleteSet(['pic'], [pic(), rect({ on: 'pic' }), rect({ id: 'r2', x: 900, y: 900 })], { refsOf });
  check(gone.ids.length === 2 && gone.ids.includes('pic') && gone.ids.includes('r1') && !gone.ids.includes('r2'), 'deleting a picture deletes its marks and no other');
  check(wbDeleteSet(['r1'], [pic(), rect({ on: 'pic' })], { refsOf }).ids.join() === 'r1', 'deleting a mark leaves its picture');
}

if (fails.length) {
  console.error(`check-whiteboard-marks: ${fails.length} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-marks: OK, ${passed} cases`);
