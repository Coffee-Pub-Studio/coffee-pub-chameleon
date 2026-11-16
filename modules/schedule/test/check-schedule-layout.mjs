#!/usr/bin/env node
/*
 * The Planner fills its window and the Timeline is one scroll region (read as code; no browser):
 *   - the manifest asks for a flush slot, so there is no gutter around the plan;
 *   - the Timeline's frame fills the height it is given (flex, min-height 0) and scrolls both ways itself, so its sideways
 *     scrollbar is at the window's bottom and the outer body never scrolls for it;
 *   - the week header is sticky at the top of that frame, above the bars and the name column;
 *   - the List pads itself (the slot no longer does).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const css = fs.readFileSync(path.join(DIR, 'src', 'schedule.css'), 'utf8');
const rule = (selector) => {
  const at = css.split('\n').find((l) => l.startsWith(`${selector} {`));
  assert.ok(at, `a rule for ${selector}`);
  return at;
};

assert.equal(manifest.content, 'flush', 'the manifest says "content": "flush"');

const frame = rule('.tl-frame');
assert.match(frame, /flex: 1 1 auto/, 'the frame takes the height the window gives it');
assert.match(frame, /min-height: 0/, 'the frame may be shorter than its rows');
assert.match(frame, /overflow: auto/, 'the frame scrolls both ways');
assert.doesNotMatch(frame, /overflow-y: hidden/, 'the frame does not hide its vertical scroll');
assert.doesNotMatch(frame, /\bborder(-radius)?:/, 'no edge or corner around the frame (no gutter)');

const view = rule('#view-timeline');
assert.match(view, /flex: 1 1 auto/);
assert.match(view, /min-height: 0/);

const head = rule('.tl-head');
assert.match(head, /position: sticky/, 'the week header is sticky');
assert.match(head, /top: 0/);
assert.match(head, /z-index: 3/, 'the week header sits above the bars (1) and the name column (2)');

assert.match(rule('.tl-grid'), /min-width: 100%/, 'the grid reaches the frame\'s edge');
assert.match(rule('#view-list'), /padding: var\(--mf-inset\)/, 'the List pads itself');

console.log('check-schedule-layout: ok');
