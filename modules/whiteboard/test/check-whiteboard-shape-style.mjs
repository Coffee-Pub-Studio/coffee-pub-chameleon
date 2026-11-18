#!/usr/bin/env node
/*
 * check-whiteboard-shape-style.mjs -- a closed shape's corner radius and shadow (whiteboard-lib-e-block-shape.js).
 * Guards: only the Rectangle and the Rounded box take a radius (the ellipse, diamond, pill and parallelogram drop it); every closed
 * shape takes a Contact or Drop shadow ('soft') and drops any other word; a radius is a whole number from 0, kept to 999; a
 * shape with no radius is drawn with its own usual corners (4 for a Rectangle, up to 16 for a Rounded box), one with a radius with
 * that radius kept to what fits in the box; the block types say which of them have a radius and a shadow (the strip reads that).
 * No browser, no network.
 * Usage: node modules/whiteboard/test/check-whiteboard-shape-style.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

// A stand-in for the page's document, enough for a shape's render: elements that keep their attributes and children.
const make = (tag) => {
  const e = { tag, attrs: {}, children: [], dataset: {}, style: { setProperty() {} }, className: '', textContent: '', innerHTML: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false } };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.getAttribute = (k) => e.attrs[k];
  e.append = (...c) => { e.children.push(...c); };
  e.appendChild = (c) => { e.children.push(c); };
  e.replaceChildren = (...c) => { e.children = c; };
  return e;
};
const fake = () => ({ createElementNS: (_ns, tag) => make(tag), createElement: make, createTextNode: (t) => ({ text: t }) });

let lib;
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { blockTypes };`)({ devicePixelRatio: 1 }, fake());
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}

if (lib) {
  const { blockTypes } = lib;
  const raw = (o) => ({ id: 's', type: 'rect', w: 160, h: 100, text: '', ...o });
  const clean = (type, o) => blockTypes.get(type).clean(raw({ type, ...o }));
  for (const t of ['rect', 'rounded']) {
    check(blockTypes.get(t).radius === true, `${t} has a corner radius`);
    check(clean(t, { radius: 12 }).radius === 12, `${t} keeps a radius`);
    check(clean(t, { radius: 0 }).radius === 0, `${t} keeps a radius of 0 (square corners, not its usual)`);
    check(clean(t, { radius: 12.6 }).radius === 13 && clean(t, { radius: 5000 }).radius === 999, `${t} rounds a radius to a whole number and holds it to 999`);
    check(clean(t, { radius: -4 }).radius === undefined && clean(t, { radius: 'big' }).radius === undefined && clean(t, {}).radius === undefined, `${t} drops a radius that is not one`);
  }
  for (const t of ['ellipse', 'diamond', 'pill', 'parallelogram']) {
    check(!blockTypes.get(t).radius, `${t} has no corner radius`);
    check(clean(t, { radius: 12 }).radius === undefined, `${t} drops a radius`);
  }
  for (const t of ['rect', 'ellipse', 'rounded', 'diamond', 'pill', 'parallelogram']) {
    check(blockTypes.get(t).shadow === true, `${t} has a shadow`);
    check(clean(t, { shadow: 'contact' }).shadow === 'contact' && clean(t, { shadow: 'soft' }).shadow === 'soft', `${t} keeps Contact and Drop shadow`);
    check(clean(t, { shadow: 'none' }).shadow === undefined && clean(t, { shadow: 'glow' }).shadow === undefined && clean(t, {}).shadow === undefined, `${t} keeps no other shadow`);
  }
  // Drawing: the corner radius the outline gets (the `rx` of the rectangle drawn).
  const drawn = (type, o) => {
    const el = make('div');
    blockTypes.get(type).render({ id: 's', type, w: 160, h: 100, text: '', stroke: 'ink', weight: 4, ...o }, el);
    // The children: the shadow layer first when there is one, then the shape's own drawing, then its words.
    const svgs = el.children.filter((c) => c.tag === 'svg');
    const shadow = svgs.find((c) => /wb-shape-shadow/.test(c.attrs.class || '')) || null;
    const svg = svgs.find((c) => !/wb-shape-shadow/.test(c.attrs.class || ''));
    const body = svg && svg.children[0];
    return { el, body, shadow };
  };
  const rxOf = (type, o) => { const { body } = drawn(type, o); return body ? Number(body.attrs.rx) : undefined; };
  check(rxOf('rect', {}) === 4, 'a Rectangle with no radius has its usual corners (4)');
  check(rxOf('rect', { radius: 0 }) === 0, 'a Rectangle with a radius of 0 has square corners');
  check(rxOf('rect', { radius: 20 }) === 20, 'a Rectangle with a radius of 20 is drawn with it');
  check(rxOf('rect', { radius: 999 }) === (100 - 4) / 2, 'a radius that is too big is kept to what fits (half the shorter side, less the outline)');
  check(rxOf('rounded', {}) === 16, 'a Rounded box with no radius has its usual corners (16)');
  check(rxOf('rounded', { w: 40, h: 28 }) === 7, 'a small Rounded box has its usual corners kept to its size (a quarter of the shorter side)');
  check(rxOf('rounded', { radius: 8 }) === 8, 'a Rounded box with a radius of 8 is drawn with it');
  check(drawn('ellipse', { radius: 30 }).body.tag === 'ellipse' && drawn('ellipse', { radius: 30 }).body.attrs.rx !== 30, 'an Ellipse ignores a radius');
  check(drawn('rect', { shadow: 'soft' }).el.dataset.shadow === 'soft' && drawn('rect', {}).el.dataset.shadow === undefined, 'a shape with a shadow says so on its element, and one without says nothing');
  // The shadow: a layer of its own, under the shape, cut out where the shape is (so a fill that lets the board show shows no shadow).
  check(drawn('rect', {}).shadow === null && drawn('rect', { shadow: 'bogus' }).shadow === null, 'a shape with no shadow has no shadow layer');
  for (const kind of ['contact', 'soft']) {
    const d = drawn('rect', { shadow: kind, radius: 20, weight: 8 });
    check(d.shadow && d.el.children[0] === d.shadow, `a ${kind} shadow is a layer under the shape (first in its element)`);
    check(d.shadow && d.shadow.children.length === 7 && d.shadow.children.every((g) => /^translate\(0 \d+\)$/.test(g.attrs.transform)), `a ${kind} shadow is seven layers, each moved down`);
    check(d.shadow && /^path\(evenodd, 'M-4000 -4000H8000V8000H-4000Z/.test(d.shadow.style.clipPath), `a ${kind} shadow is cut out (an even-odd path with a huge box and the outline)`);
  }
  // The cut-out is the OUTER outline, a pixel in (so the shadow runs just under the border and no light line shows between them).
  const cutOf = (type, o) => drawn(type, { shadow: 'soft', weight: 8, ...o }).shadow.style.clipPath;
  check(/M21 1H139A20 20 0 0 1 159 21V79A20 20 0 0 1 139 99H21A20 20 0 0 1 1 79V21A20 20 0 0 1 21 1Z'/.test(cutOf('rect', { radius: 20 })), 'a rounded rectangle\'s shadow is cut out along its box, a pixel in, corners and all (the outside of its border)');
  check(/M1 50A79 49 0 1 0 159 50A79 49 0 1 0 1 50Z'/.test(cutOf('ellipse', {})), 'an ellipse\'s shadow is cut out along its box, a pixel in');
  check(/M80 1L159 60L80 119L1 60Z'/.test(cutOf('diamond', { w: 160, h: 120 })), 'a diamond\'s shadow is cut out along its corners, a pixel in');
  check(/M1 50A79 49/.test(cutOf('ellipse', { stroke: 'none', weight: 0 })), 'with no border the cut-out is the same');
}

if (fails.length) {
  console.error(`check-whiteboard-shape-style: ${fails.length} failed`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-whiteboard-shape-style: OK, ${passed} cases`);
