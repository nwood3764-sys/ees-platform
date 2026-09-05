// ---------------------------------------------------------------------------
// Field group placement — what a DRAG does to a section's field array
// ---------------------------------------------------------------------------
// Nicholas, 2026-09-05, on the assessments WI-IRA-MF-HOMES-AUDIT layout:
// "It's not even allowing me to move it. I just moved the building over to the
// right, and it moved the property, the building, and the project back to the
// left."
//
// Both halves of that sentence were true, and they are two different defects.
//
// 1. THE MOVE WAS A NO-OP. The editor resolved a drop as "insert before the
//    tile you landed on", and it computed that insertion index in the array
//    with the dragged field ALREADY REMOVED. Dragging a field one slot FORWARD
//    therefore inserted it back exactly where it started: for
//    [Name, Opportunity, Building, Project, ...], dropping Building on Project
//    removes Building, finds Project at index 2, and inserts Building at 2 —
//    the array it started with. Every forward drag of one slot did nothing at
//    all, and every longer forward drag landed one cell short of the tile the
//    admin dropped on. The classic remove-then-index-the-remainder off-by-one.
//
// 2. THE REST OF THE SECTION RESHUFFLED. A field's position is its INDEX
//    (src/lib/fieldGroupLayout.js — one fact, deliberately), so the section is
//    a reading-order flow: pull one field out of the middle and every field
//    after it shifts by one, which in a 2-column section FLIPS THE COLUMN of
//    every one of them. That is exactly "it moved the property, the building,
//    and the project back to the left". No amount of fixing the off-by-one
//    helps here: in a flow, insertion always ripples.
//
// So a drag has to be able to say WHICH CELL, not just "somewhere around
// here". There are two intents and the editor now offers a target for each:
//
//   * SWAP — drop onto a cell. The dragged field takes that cell and whatever
//     was there takes the dragged field's cell. Nothing else moves, ever. This
//     is "move the building over to the right".
//   * INSERT — drop onto the line between two cells. The field moves to that
//     position and the flow re-wraps, which is the right behaviour when the
//     intent is reordering.
//
// An empty cell is a first-class slot in both: a `spacer` is a real array
// entry, and the blank pad at the end of a short row is materialised into one
// the moment something is dropped on it. That is what makes "put this field in
// the right-hand column and leave the left one empty" expressible at all —
// before this it was not, on any layout, by any gesture.
//
// Pure — no imports, no DOM, no React — so scripts/field-group-placement-
// fixture.mjs can replay the real production field arrays (and the pre-fix
// insert math beside them, as a control that must come back a no-op).
// ---------------------------------------------------------------------------

/** Drag id of a cell that holds a field or a spacer. */
export const FIELD_CELL_PREFIX = 'fld::'
/** Drop id of an insertion line between two cells. */
export const FIELD_INSERT_PREFIX = 'ins::'
/**
 * Drop id of a BLANK cell — the padding the renderer draws to finish a short
 * row. It is not in the array (only its position is), which is why it needs an
 * id of its own: a blank at index 3 of a 3-entry array and a field at index 3
 * would otherwise be the same id and mean opposite things.
 */
export const FIELD_BLANK_PREFIX = 'fldpad::'
/** Drop id suffix of a whole field group (the space below the last row). */
export const FIELD_ZONE_SUFFIX = '::fields'

/** A blank slot placed by the layout, as stored. */
export const SPACER = { type: 'spacer' }

export const isSpacer = (f) => f?.type === 'spacer'

export function fieldCellDragId(sectionKey, index) {
  return `${FIELD_CELL_PREFIX}${sectionKey}::${index}`
}
export function fieldInsertDropId(sectionKey, slot) {
  return `${FIELD_INSERT_PREFIX}${sectionKey}::${slot}`
}
export function fieldBlankDropId(sectionKey, slot) {
  return `${FIELD_BLANK_PREFIX}${sectionKey}::${slot}`
}
export function fieldZoneDropId(sectionKey) {
  return `${sectionKey}${FIELD_ZONE_SUFFIX}`
}

/**
 * Read a drag/drop id back into what it points at.
 *
 * Section keys never contain "::" (the whole id scheme in the canvas editor
 * rests on that), so the trailing number is unambiguous.
 *
 * @returns {{kind:'cell'|'insert'|'zone', sectionKey:string, index:number}|null}
 */
export function parseFieldDropId(id) {
  const s = String(id || '')
  if (s.endsWith(FIELD_ZONE_SUFFIX)) {
    return { kind: 'zone', sectionKey: s.slice(0, -FIELD_ZONE_SUFFIX.length), index: -1 }
  }
  for (const [prefix, kind] of [
    [FIELD_CELL_PREFIX, 'cell'],
    [FIELD_INSERT_PREFIX, 'insert'],
    [FIELD_BLANK_PREFIX, 'blank'],
  ]) {
    if (!s.startsWith(prefix)) continue
    const rest = s.slice(prefix.length)
    const cut = rest.lastIndexOf('::')
    if (cut < 0) return null
    const index = Number(rest.slice(cut + 2))
    if (!Number.isInteger(index) || index < 0) return null
    return { kind, sectionKey: rest.slice(0, cut), index }
  }
  return null
}

/**
 * Trailing spacers say nothing: the record page pads a short row with a blank
 * cell of its own, so a spacer sitting in that same blank is invisible and
 * only makes the array longer. Dropped after every operation so repeated
 * drags cannot accumulate them.
 */
export function trimTrailingSpacers(fields) {
  const arr = [...(fields || [])]
  while (arr.length && isSpacer(arr[arr.length - 1])) arr.pop()
  return arr
}

/**
 * Turn the blank pad at `slot` into a real spacer so it can be swapped with.
 *
 * A pad is drawn by the renderer but is not in the array — it is what is left
 * of a row after the last field on it. Making it real is what lets a field be
 * dropped into the empty half of a row and STAY there: without it the only
 * expressible answer is "append", which puts the field in the other column.
 */
function materializeBlank(fields, slot) {
  const arr = [...(fields || [])]
  arr.splice(Math.min(Math.max(0, slot), arr.length), 0, { ...SPACER })
  return arr
}

/**
 * Move `fromIndex` to sit at `slot` in the flow — the reordering gesture.
 *
 * `slot` is an index in the array AS PASSED IN (the field being moved is still
 * in it), and means "end up immediately before whatever is here now". That is
 * the whole of defect 1: indexing the remainder after the removal makes a
 * forward move land one cell short, and a one-slot forward move land nowhere.
 */
export function moveFieldToSlot(fields, fromIndex, slot) {
  const arr = [...(fields || [])]
  if (fromIndex < 0 || fromIndex >= arr.length) return arr
  const target = Math.min(Math.max(0, slot), arr.length)
  if (target === fromIndex || target === fromIndex + 1) return arr
  const [moved] = arr.splice(fromIndex, 1)
  arr.splice(target > fromIndex ? target - 1 : target, 0, moved)
  return trimTrailingSpacers(arr)
}

/**
 * Exchange two cells. The one operation that touches nothing else — which is
 * why it is the gesture for "put this field in that cell".
 */
export function swapFieldCells(fields, a, b) {
  const arr = [...(fields || [])]
  if (a === b) return arr
  if (a < 0 || b < 0 || a >= arr.length || b >= arr.length) return arr
  const t = arr[a]; arr[a] = arr[b]; arr[b] = t
  return trimTrailingSpacers(arr)
}

/**
 * Apply a drop that started and ended in the SAME field group.
 *
 * @param {Array<object>} fields
 * @param {number} fromIndex          the cell being dragged
 * @param {{kind:string,index:number,blankSpan?:number}} target
 * @returns {Array<object>} the new field array
 */
export function applyFieldDropWithinGroup(fields, fromIndex, target) {
  const arr = [...(fields || [])]
  if (!target || fromIndex < 0 || fromIndex >= arr.length) return arr
  if (target.kind === 'zone') return moveFieldToSlot(arr, fromIndex, arr.length)
  if (target.kind === 'insert') return moveFieldToSlot(arr, fromIndex, target.index)
  if (target.kind === 'blank') {
    // Materialise the blank, then swap into it. The vacated cell is left empty
    // rather than closed up, because the admin asked for a field to be in a
    // particular cell and pulling the flow up by one is what moves everything
    // else.
    const grown = materializeBlank(arr, target.index)
    const from  = fromIndex >= target.index ? fromIndex + 1 : fromIndex
    return swapFieldCells(grown, from, target.index)
  }
  if (target.kind !== 'cell') return arr
  if (target.index >= arr.length) return arr
  return swapFieldCells(arr, fromIndex, target.index)
}

/**
 * Take a field out of the group it is leaving. The flow closes up behind it —
 * a field that LEAVES a section should not punch a hole in it.
 */
export function removeFieldAt(fields, index) {
  const arr = [...(fields || [])]
  if (index < 0 || index >= arr.length) return { fields: arr, field: null }
  const [field] = arr.splice(index, 1)
  return { fields: trimTrailingSpacers(arr), field }
}

/**
 * Put an incoming field (from another section, or from the palette) into this
 * group at `target`.
 *
 * Dropping onto an EMPTY cell fills it rather than pushing it along: a blank
 * is a slot waiting for a field, and displacing it would be the one thing the
 * admin plainly did not ask for.
 */
export function insertFieldIntoGroup(fields, field, target) {
  const arr = [...(fields || [])]
  if (!field) return arr
  if (!target || target.kind === 'zone') return trimTrailingSpacers([...arr, field])
  if (target.kind === 'insert' || target.kind === 'blank') {
    // A blank is a slot waiting for a field, so the incoming field simply
    // takes it — which for an array that does not carry the blank is the same
    // as inserting at that position.
    const at = Math.min(Math.max(0, target.index), arr.length)
    arr.splice(at, 0, field)
    return trimTrailingSpacers(arr)
  }
  // cell
  if (target.index >= arr.length) return trimTrailingSpacers([...arr, field])
  if (isSpacer(arr[target.index])) {
    arr[target.index] = field
    return trimTrailingSpacers(arr)
  }
  arr.splice(target.index, 0, field)
  return trimTrailingSpacers(arr)
}

// ── The control, kept in the source it disproves ────────────────────────────
/**
 * The placement as it shipped before 2026-09-05: remove the dragged field,
 * then look the drop target up BY NAME in what is left and insert before it.
 *
 * Exported only so the fixture can replay it beside the real rule and require
 * it to come back wrong — a one-slot forward drag must return the array
 * unchanged, which is exactly what "it's not even allowing me to move it"
 * looked like from the outside.
 */
export function legacyInsertBeforeByName(fields, activeName, overName) {
  const arr = (fields || []).filter(f => f?.name !== activeName)
  const moved = (fields || []).find(f => f?.name === activeName)
  if (!moved) return [...(fields || [])]
  let insertAt = arr.length
  if (overName) {
    const at = arr.findIndex(f => f?.name === overName)
    if (at >= 0) insertAt = at
  }
  return [...arr.slice(0, insertAt), moved, ...arr.slice(insertAt)]
}
