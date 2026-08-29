// ---------------------------------------------------------------------------
// columnWidths — the one definition of "drag the edge of a column header".
//
// The gesture is the same wherever a table is resizable (list views, reports),
// and the repo has already paid for what happens when a recipe is written out
// more than once (see src/lib/pinnedTableHeader.js). What differs between
// surfaces is only WHERE the width is kept — a browser's localStorage, a saved
// list view, a report definition — so this owns the drag and nothing else: the
// caller supplies `setWidth` (called continuously while dragging) and
// `onCommit` (called once on release, with the final width).
//
// Pointer events, not mouse: trackpads and touch-capable laptops emit pointer
// events, and a drag that starts on a 5px grip and moves fast will leave the
// <th> long before it ends — so the listeners go on window, in the CAPTURE
// phase, or the gesture is dropped mid-drag.
// ---------------------------------------------------------------------------

import { useRef } from 'react'

// A column narrower than this cannot show a value; wider than this and one
// column pushes every other off the screen. 64px is the floor the list views
// have shipped with — kept, so folding the two definitions together changes
// nothing about a list that already has widths saved.
export const COL_MIN_WIDTH = 64
export const COL_MAX_WIDTH = 900

export function clampWidth(px) {
  return Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.round(px)))
}

/**
 * The drag itself.
 *
 * @param setWidth   (field, px) => void — called on every pointer move.
 * @param onCommit   (field, px) => void — called once, on release. This is
 *                   where a surface persists; persisting on every move would
 *                   write dozens of times per drag.
 * @returns onResizeStart(field, event, currentWidth)
 */
export function useColumnResize({ setWidth, onCommit }) {
  const dragRef = useRef(null)   // { field, startX, startWidth, width }

  return function onResizeStart(field, e, currentWidth) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { field, startX: e.clientX, startWidth: currentWidth, width: currentWidth }

    const onMove = (ev) => {
      const d = dragRef.current
      if (!d) return
      const next = clampWidth(d.startWidth + (ev.clientX - d.startX))
      if (next === d.width) return
      d.width = next
      setWidth(d.field, next)
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (d && onCommit) onCommit(d.field, d.width)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    // The cursor and the text-selection block belong to the whole drag, not to
    // the grip: without them a fast drag selects the table's text instead.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
}

// The grip itself: a narrow strip on the right edge of a header cell. It sits
// ABOVE the header's own sticky z-index so it stays grabbable, and carries
// `touchAction: 'none'` so a touch drag resizes instead of scrolling the page.
//
// It sits fully INSIDE the cell (right: 0, not a negative offset): a header
// that clips its own label with an ellipsis clips anything hanging past its
// edge too, and a grip that has been clipped away cannot be grabbed.
export function resizeGripStyle({ zIndex = 6 } = {}) {
  return {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 7,
    height: '100%',
    cursor: 'col-resize',
    zIndex,
    touchAction: 'none',
    userSelect: 'none',
    display: 'flex',
    justifyContent: 'center',
  }
}
