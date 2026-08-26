// The one definition of a table header that stays put while its rows scroll.
//
// This recipe was written out by hand in four different files, and every time
// this defect came back it came back because one copy was subtly not like the
// others. Nicholas, 2026-08-26: "You fixed this like four or five times now."
// Four copies of a rule is four chances to get it wrong; this is one.
//
// Three things have to be true together, and each of them has drawn blood:
//
//   1. `border-collapse: separate`. A COLLAPSED table owns its rows' and row
//      groups' backgrounds and borders, so a sticky header is painted with the
//      table and gets left behind as the rows scroll — and Chrome repaints a
//      scrolling collapsed table with sticky cells in it incompletely, leaving
//      ghost rows drawn on top of each other. With `separate` + zero spacing
//      the geometry is identical and the sticky cells composite on their own.
//
//   2. Every rule sits on the CELLS. A border on a <tr> is not painted in
//      `separate` mode. This is the half of the change people forget, and it
//      shows up as a table that silently loses its row lines.
//
//   3. The background is an OPAQUE colour that actually exists. `background:
//      undefined` is not an error in React — the declaration is dropped and the
//      header paints nothing, which is exactly what happened when 34 files
//      referenced a `C.cardSecondary` the palette had never defined. The rows
//      then scroll straight THROUGH the header. scripts/pinned-header-fixture.mjs
//      fails the build on a pinned style whose background is not opaque, and
//      `npm run verify:pinned-headers` photographs the header band in a real
//      browser and requires the pixels not to change as the rows move.
//
// Use PINNED_TABLE on the <table>, pinnedHeaderCell() on every <th>, and
// ROW_RULE on the cells of every row that used to carry a border on its <tr>.

import { C } from '../data/constants'

// On the <table>. Never `collapse` — see (1) above.
export const PINNED_TABLE = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
}

// The row rule, carried by each CELL — see (2) above.
export const ROW_RULE = { borderTop: `1px solid ${C.border}` }

// A heavier rule for a totals row, also on the cells.
export const TOTAL_RULE = { borderTop: `2px solid ${C.borderDark}` }

// On every <th>. `level` stacks nested header rows (a matrix report has one
// row per column-grouping level); `rowHeight` is both the declared height of a
// header row and the step used to stack them, so the two can never drift apart.
// The bottom rule is an inset SHADOW, not a border: a collapsed border on a
// sticky cell scrolls away with the table.
export function pinnedHeaderCell({ level = 0, rowHeight = null, background = C.cardSecondary, zIndex = 2 } = {}) {
  return {
    position: 'sticky',
    top: rowHeight ? level * rowHeight : 0,
    zIndex,
    background,
    boxShadow: `inset 0 -1px 0 ${C.border}`,
    ...(rowHeight ? { height: rowHeight, boxSizing: 'border-box' } : null),
  }
}

// A totals row pinned to the BOTTOM of the same scroll box.
export function pinnedFooterCell({ background = C.cardSecondary, zIndex = 2 } = {}) {
  return {
    position: 'sticky',
    bottom: 0,
    zIndex,
    background,
    boxShadow: `inset 0 2px 0 ${C.borderDark}`,
  }
}

// A column pinned to the LEFT, for a table that also scrolls sideways. Only one
// column can be pinned this way without knowing its predecessors' widths, and a
// width that is guessed rather than measured truncates the first long value it
// meets — so this pins at 0 and nothing else.
export function pinnedFirstColumn({ background = C.cardSecondary, zIndex = 1 } = {}) {
  return { position: 'sticky', left: 0, zIndex, background }
}
