// ---------------------------------------------------------------------------
// Field group placement — what a DRAG does to a section's field array
// ---------------------------------------------------------------------------
// Nicholas, 2026-09-05, in the page-layout editor: "If I move something over,
// it goes in between the two existing fields. That's it, and then you readjust
// to make sure the rows are horizontally aligned." And, on the swap this
// briefly shipped with: "I don't want fields to trade places ever. That's never,
// ever a good functionality. There's no reason in the world we'd ever trade
// places."
//
// So there is ONE gesture: a drop INSERTS. The dragged field lands between the
// two fields it was dropped between, the section re-flows behind it, and the
// rows stay whole — which they do because a field's position is its INDEX
// (src/lib/fieldGroupLayout.js) and the renderer packs that index into rows.
// A field the admin did not drag never goes anywhere except along the flow.
//
// The defect this file was written for was the INDEX ARITHMETIC, not the
// gesture. The editor resolved a drop as "insert before the tile you landed
// on" and computed that index in the array with the dragged field ALREADY
// REMOVED. For [Name, Opportunity, Building, Project, ...], dropping Building
// on Project removes Building, finds Project at index 2, and inserts Building
// at 2 — the array it started with. Every one-slot forward drag was the
// identity function, and every longer forward drag landed one cell short of
// the tile it was dropped on. `legacyInsertBeforeByName` at the bottom of this
// file is that code, kept as a control the fixture must still see fail.
//
// The one target that does NOT push anything along is an EMPTY SLOT: a field
// dropped on a blank takes the blank, because there is nothing there to
// displace. That is what an empty slot is for.
//
// Pure — no imports, no DOM, no React — so scripts/field-group-placement-
// fixture.mjs can replay the real production field arrays (and the pre-fix
// insert math beside them, as a control that must come back a no-op).
// ---------------------------------------------------------------------------

/** Drag id of a cell that holds a field or a spacer. */
export const FIELD_CELL_PREFIX = 'fld::'
/** Drop id of the insertion line on a cell's LEADING edge. */
export const FIELD_INSERT_PREFIX = 'ins::'
/**
 * Drop id of the insertion line on the TRAILING edge of the last cell in a row.
 *
 * It names the same slot as the leading line of the next row's first cell — a
 * flow has one position between two fields, not two — but it needs an id of
 * its own because dnd-kit keys droppables by id and two boxes cannot share one.
 * It exists because "move the building over to the right" is a gesture aimed at
 * the right-hand end of a row, and without a target there the nearest thing to
 * drop on is the row below.
 */
export const FIELD_INSERT_AFTER_PREFIX = 'insafter::'
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
export function fieldInsertAfterDropId(sectionKey, slot) {
  return `${FIELD_INSERT_AFTER_PREFIX}${sectionKey}::${slot}`
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
    [FIELD_INSERT_AFTER_PREFIX, 'insert'],
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
  // An EMPTY SLOT is the one target that does not push anything: the field
  // takes the blank and the blank takes nothing, because there is nothing
  // there to displace. Everything before and after it stays exactly where it
  // is, which is the whole reason an admin places one.
  if (target.kind === 'cell' && isSpacer(arr[target.index])) {
    const at = fromIndex < target.index ? target.index - 1 : target.index
    const [moved] = arr.splice(fromIndex, 1)
    arr[at] = moved
    return trimTrailingSpacers(arr)
  }
  // Everything else is an insertion: the field goes BETWEEN the two fields it
  // was dropped between, and the section re-flows behind it so the rows stay
  // whole. Dropping on a tile means "in front of this one" — the tile you
  // dropped on moves along by one cell, it does not go anywhere else.
  if (target.kind === 'cell' || target.kind === 'insert' || target.kind === 'blank') {
    return moveFieldToSlot(arr, fromIndex, target.index)
  }
  return arr
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
