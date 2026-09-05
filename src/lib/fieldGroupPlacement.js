// ---------------------------------------------------------------------------
// Field group placement — a section is COLUMNS, and a field never changes one
// ---------------------------------------------------------------------------
// Nicholas, 2026-09-05, after three cuts of this: "I can't move one field and
// have five other fields move around. I just don't understand how that's
// logical. For a UI." Earlier the same day: "If I move something over, it goes
// in between the two existing fields. That's it, and then you readjust to make
// sure the rows are horizontally aligned," and "I don't want fields to trade
// places ever."
//
// Every one of those reports is the same defect, and it is NOT the drop target:
// it is the MODEL. A field's position is its index in one array, and the
// renderer packs that array into rows left-to-right (src/lib/fieldGroupLayout.js
// — one fact, deliberately). In a flow like that, taking a field out of the
// middle shifts every field after it by one, which in a two-column section
// FLIPS THE COLUMN OF EVERY ONE OF THEM. Moving Building one place rewrote five
// fields onto the other side of the card. No drop-target fix helps: the ripple
// is what a flow IS.
//
// So the section is read as what it looks like — a grid of COLUMNS:
//
//   * each column is its own ordered stack of cells;
//   * dropping a field on a cell inserts it at that position IN THAT COLUMN,
//     pushing that column down from there;
//   * the column it came from closes up;
//   * NOTHING ELSE MOVES, and no field ever changes column unless the admin
//     drags it to another column.
//
// That is the Salesforce page-layout model, which is what the platform defaults
// to, and it is why nobody is ever surprised by it: a field slides within the
// list it is in, and never jumps to the other side of the card.
//
// The ARRAY does not change shape — the columns are interleaved back into it
// row by row, with a `spacer` wherever a column runs short, so the record page
// and the layout editor still render from the one stored fact and nothing
// downstream had to learn a new format.
//
// A `full_width` field belongs to no column: it is a row of its own, and it
// splits the section into BANDS of columns above and below it. Columns are
// resolved within a band, which is why this is not simply "cols independent
// lists".
//
// Pure — no imports beyond the packing rule, no DOM, no React — so
// scripts/field-group-placement-fixture.mjs replays the real production field
// arrays, and the pre-fix flow placement beside them as a control that must
// still scatter the section.
// ---------------------------------------------------------------------------

import { packFieldGroupRows } from './fieldGroupLayout.js'

/** Drag id of a cell that holds a field or a spacer. */
export const FIELD_CELL_PREFIX = 'fld::'
/**
 * Drop id of a BLANK cell — the padding the renderer draws where a column has
 * run short. It is not in the array (only its position is), so it carries its
 * ROW and COLUMN rather than an index.
 */
export const FIELD_BLANK_PREFIX = 'fldpad::'
/** Drop id of the strip under a column: "put it at the bottom of this one". */
export const FIELD_COLUMN_END_PREFIX = 'colend::'
/** Drop id suffix of a whole field group (an empty section, or a stray drop). */
export const FIELD_ZONE_SUFFIX = '::fields'

/** A blank slot placed by the layout, as stored. */
export const SPACER = { type: 'spacer' }

export const isSpacer = (f) => f?.type === 'spacer'

export function fieldCellDragId(sectionKey, index) {
  return `${FIELD_CELL_PREFIX}${sectionKey}::${index}`
}
export function fieldBlankDropId(sectionKey, row, col) {
  return `${FIELD_BLANK_PREFIX}${sectionKey}::${row}::${col}`
}
export function fieldColumnEndDropId(sectionKey, band, col) {
  return `${FIELD_COLUMN_END_PREFIX}${sectionKey}::${band}::${col}`
}
export function fieldZoneDropId(sectionKey) {
  return `${sectionKey}${FIELD_ZONE_SUFFIX}`
}

/**
 * Read a drag/drop id back into what it points at.
 *
 * Section keys never contain "::" — the whole id scheme in the canvas editor
 * rests on that — so the trailing numbers are unambiguous.
 */
export function parseFieldDropId(id) {
  const s = String(id || '')
  if (s.endsWith(FIELD_ZONE_SUFFIX)) {
    return { kind: 'zone', sectionKey: s.slice(0, -FIELD_ZONE_SUFFIX.length) }
  }
  if (s.startsWith(FIELD_CELL_PREFIX)) {
    const rest = s.slice(FIELD_CELL_PREFIX.length)
    const cut = rest.lastIndexOf('::')
    if (cut < 0) return null
    const index = Number(rest.slice(cut + 2))
    if (!Number.isInteger(index) || index < 0) return null
    return { kind: 'cell', sectionKey: rest.slice(0, cut), index }
  }
  for (const [prefix, kind, aName, bName] of [
    [FIELD_BLANK_PREFIX, 'blank', 'row', 'col'],
    [FIELD_COLUMN_END_PREFIX, 'columnEnd', 'band', 'col'],
  ]) {
    if (!s.startsWith(prefix)) continue
    const rest = s.slice(prefix.length)
    const cutB = rest.lastIndexOf('::')
    if (cutB < 0) return null
    const cutA = rest.lastIndexOf('::', cutB - 1)
    if (cutA < 0) return null
    const a = Number(rest.slice(cutA + 2, cutB))
    const b = Number(rest.slice(cutB + 2))
    if (!Number.isInteger(a) || a < 0 || !Number.isInteger(b) || b < 0) return null
    return { kind, sectionKey: rest.slice(0, cutA), [aName]: a, [bName]: b }
  }
  return null
}

const clampCols = (n) => Math.max(1, Math.floor(Number(n)) || 1)

/**
 * Trailing spacers say nothing: the record page pads a short row with a blank
 * cell of its own, so a spacer sitting in that same blank is invisible and only
 * makes the array longer.
 */
export function trimTrailingSpacers(fields) {
  const arr = [...(fields || [])]
  while (arr.length && isSpacer(arr[arr.length - 1])) arr.pop()
  return arr
}

// ── The array, read as columns ──────────────────────────────────────────────

/**
 * Split a field array into BANDS.
 *
 * A `grid` band is a run of ordinary rows read as `cols` column stacks; a
 * `full` band is one full-width field, which belongs to no column. Column
 * stacks are dense — a column only ever runs short at the END of its band,
 * because the renderer pads a row only when the array runs out or a full-width
 * field forces the row closed, and either case ends the band.
 *
 * Each entry keeps the array index it came from, which is how a drag names its
 * source without a second lookup.
 */
export function toColumnBands(fields, columns) {
  const cols = clampCols(columns)
  const rows = packFieldGroupRows(fields, cols)
  const bands = []
  let cur = null
  const close = () => { if (cur) { bands.push(cur); cur = null } }
  rows.forEach((row, rowIndex) => {
    const first = row.cells[0]
    const isFull = cols > 1 && !first.blank && first.span === cols
    if (isFull) {
      close()
      bands.push({ type: 'full', rows: [rowIndex], entry: { field: first.field, index: first.index } })
      return
    }
    if (!cur) cur = { type: 'grid', rows: [], stacks: Array.from({ length: cols }, () => []) }
    cur.rows.push(rowIndex)
    let c = 0
    for (const cell of row.cells) {
      if (!cell.blank) cur.stacks[c].push({ field: cell.field, index: cell.index })
      c += cell.span
    }
  })
  close()
  return bands
}

/**
 * Interleave the column stacks back into one row-major array.
 *
 * Every row of a band except its LAST must carry a cell for each column, or the
 * next row would not start in column 1 — that is what the spacers are for. The
 * last row may be short, because the renderer pads it itself.
 */
export function fromColumnBands(bands, columns) {
  const cols = clampCols(columns)
  const out = []
  for (const band of bands) {
    if (band.type === 'full') { out.push(band.entry.field); continue }
    const height = band.stacks.reduce((m, s) => Math.max(m, s.length), 0)
    for (let r = 0; r < height; r++) {
      const cells = band.stacks.map(s => (s[r] ? s[r].field : null))
      let upto = cols - 1
      if (r === height - 1) {
        while (upto >= 0 && (cells[upto] == null || isSpacer(cells[upto]))) upto -= 1
      }
      for (let c = 0; c <= upto; c++) out.push(cells[c] || { ...SPACER })
    }
  }
  return trimTrailingSpacers(out)
}

function findEntry(bands, index) {
  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi]
    if (band.type === 'full') {
      if (band.entry.index === index) return { bi, full: true }
      continue
    }
    for (let c = 0; c < band.stacks.length; c++) {
      const r = band.stacks[c].findIndex(e => e.index === index)
      if (r >= 0) return { bi, c, r }
    }
  }
  return null
}

function bandForRow(bands, row) {
  for (let bi = 0; bi < bands.length; bi++) {
    const at = bands[bi].rows.indexOf(row)
    if (at >= 0) return { bi, localRow: at }
  }
  return null
}

/** The first cell with nothing in it, read left to right, top to bottom. */
function nextFreeCell(band, cols) {
  const height = band.stacks.reduce((m, s) => Math.max(m, s.length), 0)
  for (let c = 0; c < cols; c++) {
    if (band.stacks[c].length < height) return { c, r: band.stacks[c].length }
  }
  return { c: 0, r: height }
}

/**
 * Where a drop lands, as a position in a column.
 *
 * @returns {{bi:number, c:number, r:number}|null}
 */
function resolveTarget(bands, cols, target, src) {
  if (!target) return null
  if (target.kind === 'cell') {
    const at = findEntry(bands, target.index)
    return at && !at.full ? at : null
  }
  if (target.kind === 'blank') {
    const band = bandForRow(bands, target.row)
    if (!band || bands[band.bi].type !== 'grid') return null
    return { bi: band.bi, c: Math.min(Math.max(0, target.col), cols - 1), r: band.localRow }
  }
  if (target.kind === 'columnEnd') {
    const band = bands[target.band]
    if (!band || band.type !== 'grid') return null
    const c = Math.min(Math.max(0, target.col), cols - 1)
    return { bi: target.band, c, r: band.stacks[c].length }
  }
  if (target.kind === 'zone') {
    // A stray drop states no column, so it does not change one: the field goes
    // to the BOTTOM OF THE COLUMN IT IS ALREADY IN. Anything else would move a
    // field sideways on a near miss, which is the whole thing this model
    // exists to stop. A field arriving from another section has no column of
    // its own, so it takes the next free cell.
    if (src && !src.full) return { bi: src.bi, c: src.c, r: bands[src.bi].stacks[src.c].length }
    for (let bi = bands.length - 1; bi >= 0; bi--) {
      if (bands[bi].type !== 'grid') continue
      const free = nextFreeCell(bands[bi], cols)
      return { bi, c: free.c, r: free.r }
    }
    return null
  }
  return null
}

function placeInStack(stack, r, entry) {
  // A blank is a slot waiting for a field, so a field dropped on one TAKES it
  // and nothing in the column moves at all. Anything else is an insertion:
  // that cell and the ones under it slide down one, within this column only.
  if (r < stack.length && isSpacer(stack[r].field)) { stack[r] = entry; return }
  while (stack.length < r) stack.push({ field: { ...SPACER }, index: -1 })
  stack.splice(Math.min(r, stack.length), 0, entry)
}

/**
 * Apply a drop that started and ended in the SAME field group.
 *
 * @param {Array<object>} fields
 * @param {number} columns          the section's declared column count
 * @param {number} fromIndex        array index of the cell being dragged
 * @param {object} target           parsed drop id
 * @returns {Array<object>} the new field array
 */
export function applyFieldDropWithinGroup(fields, columns, fromIndex, target) {
  const arr = [...(fields || [])]
  const cols = clampCols(columns)
  if (!target || fromIndex < 0 || fromIndex >= arr.length) return arr
  const bands = toColumnBands(arr, cols)
  const src = findEntry(bands, fromIndex)
  if (!src) return arr

  // A full-width field is a row, not a cell in a column, so it moves as a row:
  // it lands above whichever band it was dropped into. Rare, and deliberately
  // not folded into the column rules, where it has no meaning.
  if (src.full) {
    const tgtBand = resolveTarget(bands, cols, target, src)
    if (!tgtBand) return arr
    const [band] = bands.splice(src.bi, 1)
    bands.splice(tgtBand.bi > src.bi ? tgtBand.bi - 1 : tgtBand.bi, 0, band)
    return fromColumnBands(bands, cols)
  }

  const tgt = resolveTarget(bands, cols, target, src)
  if (!tgt) return arr
  if (tgt.bi === src.bi && tgt.c === src.c && (tgt.r === src.r || tgt.r === src.r + 1)) return arr

  const moved = arr[fromIndex]
  bands[src.bi].stacks[src.c].splice(src.r, 1)
  // Removing from the source closes that column up, so a target BELOW the
  // source in the SAME column has moved up one.
  const r = (tgt.bi === src.bi && tgt.c === src.c && src.r < tgt.r) ? tgt.r - 1 : tgt.r
  placeInStack(bands[tgt.bi].stacks[tgt.c], r, { field: moved, index: -1 })
  return fromColumnBands(bands, cols)
}

/**
 * Take a field out of the group it is leaving. Its column closes up — a field
 * that LEAVES a section should not punch a hole in it.
 */
export function removeFieldAt(fields, columns, index) {
  const arr = [...(fields || [])]
  if (index < 0 || index >= arr.length) return { fields: arr, field: null }
  const cols = clampCols(columns)
  const bands = toColumnBands(arr, cols)
  const at = findEntry(bands, index)
  const field = arr[index]
  if (!at) return { fields: arr, field: null }
  if (at.full) bands.splice(at.bi, 1)
  else bands[at.bi].stacks[at.c].splice(at.r, 1)
  return { fields: fromColumnBands(bands, cols), field }
}

/** Put an incoming field (from another section) into this group at `target`. */
export function insertFieldIntoGroup(fields, columns, field, target) {
  const arr = [...(fields || [])]
  if (!field) return arr
  const cols = clampCols(columns)
  const bands = toColumnBands(arr, cols)
  if (!bands.some(b => b.type === 'grid')) {
    bands.push({ type: 'grid', rows: [], stacks: Array.from({ length: cols }, () => []) })
  }
  const tgt = resolveTarget(bands, cols, target) || resolveTarget(bands, cols, { kind: 'zone' })
  if (!tgt) return trimTrailingSpacers([...arr, field])
  placeInStack(bands[tgt.bi].stacks[tgt.c], tgt.r, { field, index: -1 })
  return fromColumnBands(bands, cols)
}

// ── The control, kept in the source it disproves ────────────────────────────
/**
 * The placement as it shipped before the column model: one flat array, a drop
 * resolved as "insert at this index in the flow".
 *
 * Exported only so the fixture can replay it beside the real rule and require
 * it to come back wrong — a section where moving ONE field re-columns five
 * others is exactly what was being reported, and a check that cannot reproduce
 * that is measuring nothing.
 */
export function legacyFlowMove(fields, fromIndex, slot) {
  const arr = [...(fields || [])]
  if (fromIndex < 0 || fromIndex >= arr.length) return arr
  const target = Math.min(Math.max(0, slot), arr.length)
  if (target === fromIndex || target === fromIndex + 1) return arr
  const [moved] = arr.splice(fromIndex, 1)
  arr.splice(target > fromIndex ? target - 1 : target, 0, moved)
  return trimTrailingSpacers(arr)
}
