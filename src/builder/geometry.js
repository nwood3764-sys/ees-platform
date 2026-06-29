// =============================================================================
// src/builder/geometry.js
//
// The geometry contract for the LEAP Canvas (the unified WYSIWYG builder).
//
// Every builder surface — dashboards, home pages, record page layouts —
// describes widget placement the SAME way: an explicit grid rectangle
// { x, y, w, h } in grid units, plus per-breakpoint overrides for responsive
// layouts. This replaces the legacy "array order + dw_position_row/col + a
// column count" model the old DashboardEditor used, where position was
// implied by index and resize was impossible.
//
// react-grid-layout (the canvas grid library chosen in Phase 0) consumes
// exactly this { i, x, y, w, h } shape, so this module is the single place
// that knows how to:
//   • produce a fresh layout item for a newly-dropped component,
//   • find the next free slot so drops don't overlap,
//   • convert a saved LEGACY dashboard (row/col/width) into grid geometry,
//   • convert grid geometry BACK to the legacy columns the runner still reads.
//
// Phase 0 is additive: nothing here mutates the database or the runners. The
// conversion helpers exist so Phase 1 can read existing dashboards into the
// canvas and persist them without losing the records the runner depends on.
// =============================================================================

// The canvas is a 12-column grid (Salesforce Lightning App Builder / Bootstrap
// convention). Legacy dashboards stored 1–4 "columns"; we scale those onto 12
// so a 2-column dashboard's widgets each span 6, a 3-column's each span 4, etc.
export const GRID_COLS = 12

// Height of one grid row, in pixels. react-grid-layout multiplies h by this.
export const ROW_HEIGHT = 80

// Gutter between grid cells, in pixels [horizontal, vertical].
export const GRID_MARGIN = [16, 16]

// Responsive breakpoints (px) and the column count active at each. The canvas
// authors against `lg`; narrower breakpoints reflow. Kept here so every
// surface shares one responsive contract instead of retrofitting per builder.
export const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480 }
export const BREAKPOINT_COLS = { lg: GRID_COLS, md: GRID_COLS, sm: 6, xs: 2 }

// ─── New-item placement ────────────────────────────────────────────────────

// The lowest unoccupied y for a column band [x, x+w). Used so a freshly
// dropped/added component lands below whatever already occupies its columns
// instead of overlapping. react-grid-layout will still compact, but giving it
// a sane starting y avoids a visible jump on drop.
export function bottomOfBand(layout, x, w) {
  let maxY = 0
  for (const it of layout) {
    const overlaps = it.x < x + w && it.x + it.w > x
    if (overlaps) maxY = Math.max(maxY, it.y + it.h)
  }
  return maxY
}

// Build a layout item for a component being added to the canvas. Places it at
// the bottom of the leftmost band by default; honors the component's
// defaultSize / min / max from the registry.
export function newLayoutItem(id, registryEntry, layout = []) {
  const w = clamp(registryEntry?.defaultSize?.w ?? 4, registryEntry?.minSize?.w ?? 1, GRID_COLS)
  const h = registryEntry?.defaultSize?.h ?? 3
  return {
    i: id,
    x: 0,
    y: bottomOfBand(layout, 0, w),
    w,
    h,
    minW: registryEntry?.minSize?.w ?? 1,
    minH: registryEntry?.minSize?.h ?? 1,
    maxW: registryEntry?.maxSize?.w,
    maxH: registryEntry?.maxSize?.h,
  }
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

// ─── Legacy ⇄ grid conversion (dashboards) ───────────────────────────────────
//
// The legacy `dashboard_widgets` rows carry dw_position_row, dw_position_col,
// dw_width (a 1..dash_columns span) and dw_height. The runner places widgets
// in a CSS grid of `dash_columns` columns. To edit one of those dashboards in
// the new canvas we scale that small grid onto the 12-column canvas.

// scaleFactor maps a legacy column index/width onto the 12-col canvas.
function scaleFactor(dashColumns) {
  const cols = Math.max(1, Math.min(GRID_COLS, dashColumns || 3))
  return Math.floor(GRID_COLS / cols)
}

// Convert loaded legacy widgets → react-grid-layout items. `widgets` are rows
// as returned by loadDashboard (dw_* columns); they must already carry a
// stable string key in `i` (we use the widget row id).
export function legacyWidgetsToLayout(widgets = [], dashColumns = 3) {
  const f = scaleFactor(dashColumns)
  return widgets.map((w, idx) => {
    const col = Number.isFinite(w.dw_position_col) ? w.dw_position_col : (idx % (dashColumns || 3))
    const row = Number.isFinite(w.dw_position_row) ? w.dw_position_row : Math.floor(idx / (dashColumns || 3))
    const span = Math.max(1, w.dw_width || 1)
    return {
      i: String(w.id ?? idx),
      x: clamp(col * f, 0, GRID_COLS - 1),
      w: clamp(span * f, 1, GRID_COLS),
      y: row * 3,
      h: (w.dw_height && w.dw_height > 0) ? w.dw_height * 3 : 3,
    }
  })
}

// Convert a canvas layout item back to the legacy dw_* fields the runner reads,
// so existing dashboards keep rendering after a canvas edit (the one
// "additive, don't break" constraint that still applies in the rearchitecture).
export function layoutItemToLegacy(item, dashColumns = 3) {
  const f = scaleFactor(dashColumns)
  return {
    dw_position_col: Math.round(item.x / f),
    dw_position_row: Math.round(item.y / 3),
    dw_width:        Math.max(1, Math.round(item.w / f)),
    dw_height:       Math.max(1, Math.round(item.h / 3)),
  }
}
