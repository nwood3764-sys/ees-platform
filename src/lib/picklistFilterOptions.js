// ---------------------------------------------------------------------------
// Which picklist values a FILTER may offer.
//
// Deactivating a picklist value means "nobody may choose this on a new
// record". It has never meant "nobody may find the records that already carry
// it" — but that is what it did: every picklist dropdown in LEAP is fed by
// getPicklistOptions(), which filters to picklist_is_active, and the list-view
// filter used the same list as the editors. So the Technicians tab showed
// seven contacts reading "Technician" in the Contact Record Type column while
// the filter for that very column offered five values, none of them Technician
// (Nicholas, 2026-09-02). Retiring a value silently hid its records from
// search.
//
// It is the same conflation already recorded for picklist_show_in_path, where
// one flag governs both "hide from the status path" and "cannot be chosen":
// a value's availability for CHOOSING and its availability for FINDING are two
// different questions and must not share one answer.
//
// So the two lists are now built by two rules. Editors keep the active list —
// nothing here makes a retired value assignable. A filter gets the active
// values PLUS the retired ones that records actually carry, marked so the
// dropdown can say why they look different. A retired value nothing carries is
// dropped: it can only ever match zero rows, and a filter that returns nothing
// reads as broken.
// ---------------------------------------------------------------------------

/**
 * Merge a picklist's full value list with the ids records actually carry.
 *
 * @param values  [{ id, label, value, sortOrder, isActive }] in display order
 * @param inUseIds ids present in the object's own column (from the
 *                 picklist_values_in_use RPC). A null/undefined list means the
 *                 in-use lookup did not answer — the safe fall back is the
 *                 active list alone, which is exactly today's behaviour.
 * @returns [{ id, label, value, sortOrder, retired }]
 */
export function mergeFilterOptions(values, inUseIds) {
  const all = Array.isArray(values) ? values : []
  const inUse = new Set((inUseIds || []).map(String))
  const lookupAnswered = Array.isArray(inUseIds)

  const active = []
  const retired = []
  // A filter matches on the LABEL, not the id, so two values sharing a label
  // are one choice here — offering it twice asks the user to pick between two
  // identical things. The active spelling always wins the label.
  const claimed = new Set()

  for (const v of all) {
    if (!v || !v.label) continue
    if (v.isActive) {
      if (claimed.has(v.label)) continue
      claimed.add(v.label)
      active.push({ ...v, retired: false })
    }
  }

  if (lookupAnswered) {
    for (const v of all) {
      if (!v || !v.label || v.isActive) continue
      if (!inUse.has(String(v.id))) continue
      if (claimed.has(v.label)) continue
      claimed.add(v.label)
      retired.push({ ...v, retired: true })
    }
  }

  // Live choices first, retired below them: the ordinary case stays the top of
  // the list, and the exceptions are visibly exceptions.
  return [...active, ...retired]
}
