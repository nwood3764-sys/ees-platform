// ---------------------------------------------------------------------------
// reportCalcFields — a calculated field is a label and a formula. A row with
// neither is not a field.
//
// Nicholas, 2026-08-29, on a column headed "(CALC) ƒ" showing an em dash on
// every row: "why did this calc field? Now how do I get rid of it?"
//
// "+ Add Calculated Field" appends an EMPTY row — blank label, blank formula —
// and nothing stopped that row from being saved. The viewer then had a column
// with no name (it printed the placeholder "(calc)") and no expression to
// evaluate (so every cell was "—"). Saving again re-created it, because it was
// still sitting in the editor. RPT-00045 accumulated twelve of them in one
// afternoon.
//
// The rule, and the reason it is not simply "drop anything incomplete":
//
//   * BOTH blank → the row was added and never filled in. Nothing was typed, so
//     nothing is lost by dropping it, and it is dropped silently.
//   * ONE of them filled → someone was part-way through authoring. Deleting
//     that silently would throw away their work, so the save is REFUSED and
//     says which row and which half is missing.
//   * Both filled → keep, with the label trimmed.
// ---------------------------------------------------------------------------

const text = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()))

/**
 * Split the editor's calculated fields into what to save and what to complain
 * about.
 *
 * @returns {{ keep: object[], dropped: object[], incomplete: {index:number, position:number, missing:'label'|'formula', label:string}[] }}
 *   `position` is 1-based, so a message can name the row the way the editor
 *   shows it.
 */
export function classifyCalcFields(calculatedFields) {
  const keep = [], dropped = [], incomplete = []
  const list = Array.isArray(calculatedFields) ? calculatedFields : []
  list.forEach((c, index) => {
    const label = text(c?.label)
    const expression = text(c?.expression)
    if (!label && !expression) { dropped.push(c); return }
    if (!label || !expression) {
      incomplete.push({
        index,
        position: index + 1,
        missing: label ? 'formula' : 'label',
        label: label || '',
      })
      return
    }
    keep.push({ ...c, label, expression })
  })
  return { keep, dropped, incomplete }
}

// The message shown when a save is refused. Names the row the editor's own way
// (its position, and its label when it has one) so the reader can find it.
export function describeIncompleteCalcFields(incomplete) {
  const rows = incomplete || []
  if (rows.length === 0) return null
  const one = (r) => {
    const which = r.label ? `"${r.label}"` : `calculated field ${r.position}`
    return r.missing === 'label'
      ? `${which} has a formula but no label`
      : `${which} has a label but no formula`
  }
  return rows.length === 1
    ? `${one(rows[0])}. Fill it in, or remove the row with ×, then save.`
    : `${rows.map(one).join('; ')}. Fill them in, or remove the rows with ×, then save.`
}
