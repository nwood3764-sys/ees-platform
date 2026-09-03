// ---------------------------------------------------------------------------
// Field group layout — the ONE definition of where a field sits in a section
// ---------------------------------------------------------------------------
// Nicholas, 2026-09-03, on an account's Service Provider Information section:
// "We shouldn't have staggered rows on page layouts. If something's like two or
// three lines, the other ones just need to adjust... There's only one field on
// each side, but they're staggered. This can't happen."
//
// He was looking at ONE section, but the stagger was structural and platform
// wide. A field group's position was stored as TWO facts that nothing kept in
// agreement:
//
//   * its INDEX in widget_config.fields — the order it is read in, and
//   * a `column` number — which slot of the row it was pinned to.
//
// The page-layout EDITOR wrote `column` as a column-FILL model (three drop
// zones, each an independent stack) while the record PAGE read it as a
// row-MAJOR grid (`gridColumnStart`). When the two disagreed — a field pinned
// to column 2 sitting ahead of a field pinned to column 1, which is exactly
// what the editor's round-robin produced — CSS grid could not place the second
// field in a cell the cursor had already passed, so it dropped it to the next
// row and left the slot beside it EMPTY. That empty slot is the stagger. The
// live case read ["Tax Identification FEIN" column 2, "Tax Classification"
// column 1] and painted one field top-right, the other below-left, with two
// blank quarters between them.
//
// Two facts cannot describe one position. There is now ONE: a field's index.
// The column it lands in is DERIVED here and stored nowhere, so it can never
// disagree with the reading order again. `column` is no longer read, no longer
// written, and was stripped from all 1,078 stored field groups.
//
// The second half of "staggered" is the horizontal rules. Every field cell
// carried its own bottom border, and the cells were top-aligned, so a value
// that wrapped to two lines pushed its own rule below its neighbour's and the
// section read as a broken ladder. Rows are therefore real rows here: a row is
// a list of cells that always sums to exactly `columns`, the ROW carries the
// rule, and the cells stretch to the row's height. "The other ones just need to
// adjust" is that stretch.
//
// Pure — no imports, no DOM — so scripts/field-group-layout-fixture.mjs can
// replay it (and the pre-fix placement beside it) in plain Node.
// ---------------------------------------------------------------------------

/** Column count a section falls back to when it declares none. */
export const FIELD_GROUP_DEFAULT_COLUMNS = 2

/** Upper bound on columns. The layout editor offers 1–3; clamp defensively. */
export const FIELD_GROUP_MAX_COLUMNS = 4

/**
 * Narrowest a field column may get before the section drops a column. A label
 * over a value needs roughly this much before picklist badges and lookup links
 * start wrapping mid-word. This is what makes one rule serve the 480px right
 * rail, the main flow and a phone without a second layout model.
 *
 * 230, not a round 240, and measured rather than guessed: the right rail is
 * exactly 480px and the section card inside it has a 1px border on each side,
 * so a 240 threshold missed two columns there by 2px and collapsed every rail
 * section to one. A phone's ~350px still resolves to one column.
 */
export const FIELD_GROUP_MIN_COLUMN_WIDTH = 230

/**
 * How many columns a field group actually renders in.
 *
 * The DECLARED count (page_layout_sections.section_columns) is a ceiling, not a
 * promise: the same section renders in the main flow, in the 480px right rail
 * and on a phone. Fitting is measured from the container, so a 3-column section
 * in the rail becomes 2 and on a phone becomes 1 — it never renders 3 columns
 * 90px wide. Before the container has been measured (first paint, or a test
 * environment with no layout) `containerWidth` is null and the declared count
 * is used as-is: over-claiming for one frame is better than flashing a
 * one-column section and reflowing.
 *
 * @param {object}  opts
 * @param {number?} opts.declared        section_columns
 * @param {number?} opts.containerWidth  measured px width, or null if unknown
 * @param {number?} opts.minColumnWidth  override for the fitting width
 * @returns {number} columns, at least 1
 */
export function resolveFieldGroupColumns({ declared, containerWidth, minColumnWidth } = {}) {
  const ceiling = clampColumns(declared)
  if (containerWidth == null || !Number.isFinite(containerWidth) || containerWidth <= 0) return ceiling
  const min = Number.isFinite(minColumnWidth) && minColumnWidth > 0 ? minColumnWidth : FIELD_GROUP_MIN_COLUMN_WIDTH
  const fits = Math.floor(containerWidth / min)
  return Math.max(1, Math.min(ceiling, fits))
}

function clampColumns(n) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return FIELD_GROUP_DEFAULT_COLUMNS
  return Math.min(v, FIELD_GROUP_MAX_COLUMNS)
}

/**
 * Is this field one that takes the whole row? A field carrying `full_width`
 * says so outright (address blocks, radio groups, checkbox lists mirroring a
 * source form 1:1). Anything else takes one slot.
 */
export function fieldSpansRow(field) {
  return field?.full_width === true
}

/**
 * Pack a field group's fields into rows.
 *
 * Fields are consumed in array order — reading order IS the layout, which is
 * the whole point — and every row is filled to exactly `columns` slots. A row
 * that a full-width field cut short, and the final partial row, are completed
 * with a BLANK cell rather than left ragged: the blank holds the column width
 * so the fields above and below it stay in line, and the row still spans the
 * section so its rule runs edge to edge.
 *
 * Callers must pass only the fields they are going to RENDER. A field that
 * renders nothing (a system field on the create form, a related field whose
 * parent isn't chosen yet) must be filtered out BEFORE packing — packing it and
 * then rendering null is how a hole gets back in.
 *
 * @param {Array<object>} fields   layout fields, in order
 * @param {number}        columns  slots per row (>= 1)
 * @returns {Array<{cells: Array<{field: object|null, index: number, span: number, blank: boolean}>}>}
 */
export function packFieldGroupRows(fields, columns) {
  const cols = Math.max(1, Math.floor(Number(columns)) || 1)
  const rows = []
  let cells = []
  let remaining = cols

  const closeRow = () => {
    if (cells.length === 0) return
    // Pad to a full row so the row's rule spans the section and the columns
    // above stay aligned. One blank cell, spanning whatever is left.
    if (remaining > 0) cells.push({ field: null, index: -1, span: remaining, blank: true })
    rows.push({ cells })
    cells = []
    remaining = cols
  }

  ;(fields || []).forEach((field, index) => {
    const span = Math.min(fieldSpansRow(field) ? cols : 1, cols)
    // A full-width field cannot share the row it lands mid-way through, so the
    // row it interrupts is closed (and padded) and it starts a fresh one.
    if (span > remaining) closeRow()
    cells.push({ field, index, span, blank: false })
    remaining -= span
    if (remaining === 0) closeRow()
  })
  closeRow()
  return rows
}

/** A deliberate empty slot placed by the layout, not a field. */
export function isLayoutSpacer(field) {
  return field?.type === 'spacer'
}

/**
 * The fields a group should actually place, given how many columns it ended up
 * rendering in.
 *
 * A spacer holds a slot in the shape the section was DESIGNED at — the tail of
 * a shorter column in a column-fill layout. Once the section reflows to fewer
 * columns (the 480px right rail, a phone) that shape no longer exists, and the
 * spacers stop meaning anything: they push real fields around and, where two
 * land next to each other, produce a row with nothing in it at all. Measured in
 * Chromium at 480px, where a 3-column account section drew an empty band
 * between Billing State and Billing Zip.
 *
 * Dropping them is safe in the other direction too: the layout editor always
 * draws the declared count, so what an admin authored is what they see.
 */
export function fieldsForRenderedColumns(items, { columns, declaredColumns, fieldOf } = {}) {
  const declared = clampColumns(declaredColumns)
  const list = items || []
  if (columns >= declared) return list
  // `fieldOf` lets the record page pass its already-rendered {field, el} pairs
  // through unchanged, so the filtered list and the elements stay index-aligned
  // — dropping a spacer from one and not the other would render every field in
  // the wrong cell.
  const read = typeof fieldOf === 'function' ? fieldOf : (x) => x
  return list.filter(x => !isLayoutSpacer(read(x)))
}

/** A row worth drawing holds at least one real field. */
export function rowHasContent(row) {
  return (row?.cells || []).some(c => !c.blank && !isLayoutSpacer(c.field))
}

/**
 * The column (1-based) each field ends up in, keyed by its index in the input
 * array. Used by the layout editor to label a tile and by the audit/migration
 * to prove the derived answer reproduces what the section already showed.
 */
export function fieldColumnPositions(fields, columns) {
  const positions = new Map()
  packFieldGroupRows(fields, columns).forEach((row, rowIndex) => {
    let col = 1
    for (const cell of row.cells) {
      if (!cell.blank) positions.set(cell.index, { row: rowIndex + 1, column: col, span: cell.span })
      col += cell.span
    }
  })
  return positions
}
