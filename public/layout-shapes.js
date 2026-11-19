// The layout shapes, the page's copy of server/layout-shapes.js (documentation/plans/plan-layout-picker.md, step 1).
// Each shape is { id, areas, columns, stacked }: `columns` are the widths of the columns beside the chat and call
// column, left to right, as percentages of the view on the grid of full, halves and thirds; `stacked` lists the area
// numbers (from 1) that share one column, each half its height. The shares are fixed here (no width is ever stored).
// tools/check-layout-shapes.mjs fails when this list and the server's differ.
const THIRD = 100 / 3;
const TWO_THIRDS = 200 / 3;

export const SHAPES = Object.freeze([
  Object.freeze({ id: 'one', areas: 1, columns: Object.freeze([100]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'two-equal', areas: 2, columns: Object.freeze([50, 50]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'wide-narrow', areas: 2, columns: Object.freeze([TWO_THIRDS, THIRD]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'three-equal', areas: 3, columns: Object.freeze([THIRD, THIRD, THIRD]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'tall-split', areas: 3, columns: Object.freeze([50, 50]), stacked: Object.freeze([2, 3]) }),
  Object.freeze({ id: 'wide-split', areas: 3, columns: Object.freeze([TWO_THIRDS, THIRD]), stacked: Object.freeze([2, 3]) }),
]);

export const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;
