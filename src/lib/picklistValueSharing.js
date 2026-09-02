// ---------------------------------------------------------------------------
// picklistValueSharing — may a picklist value belong to more than one record
// type, and therefore should the Object Manager offer it?
//
// Nicholas (2026-09-02), unable to configure enrollment_status on
// WI-IRA-MF-HOMES-Project-Reservation: "Put the stages correct, and there are
// no stages... when I go to the setup, there's none. What is going on here?"
//
// The screen showed Available Values 0, "Every value is in Selected", and
// Selected empty -- both panes claiming the other had them. Nothing was
// draggable, so the record type could never be configured.
//
// THE CAUSE. FieldPicklistEditor hid every value already assigned to a
// DIFFERENT record type. That rule is right for opportunity stages, where
// LEAP's hard rule is that each record type owns its own never-shared stage
// set, so another record type's stage appearing in your list is a fake
// duplicate. It is wrong for a SHARED lifecycle: an enrollment is prepared,
// verified, submitted, approved or denied whatever programme it belongs to, and
// those same eight values already served seven record types. Hiding "assigned
// elsewhere" hid all eight, leaving nothing to select.
//
// THE RULE, DERIVED FROM THE DATA RATHER THAN CONFIGURED OR HARDCODED. Look at
// how the field's values are ALREADY assigned:
//
//   every value belongs to at most ONE record type  -> exclusive. Hide other
//                                                      record types' copies.
//                                                      (opportunity_stage)
//   any value belongs to TWO OR MORE                -> shared. Hide nothing.
//                                                      (enrollment_status)
//
// No field-name list to keep in sync, and no new configuration to author before
// a screen works. A field nobody has scoped yet has no evidence of sharing, so
// it is treated as exclusive -- which changes nothing, because with no
// assignments there is nothing to hide.
//
// Pure -- see scripts/picklist-value-sharing-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * Are this field's values shared across record types?
 *
 * @param assignments {Object} recordTypeId -> Set|Array of picklist value ids,
 *   exactly the shape FieldPicklistEditor holds.
 * @returns {boolean} true when at least one value is assigned to two or more
 *   record types.
 */
export function fieldValuesAreShared(assignments) {
  const seen = new Map()
  for (const [rtId, ids] of Object.entries(assignments || {})) {
    if (!rtId || !ids) continue
    for (const valueId of ids) {
      const count = (seen.get(valueId) || 0) + 1
      if (count > 1) return true
      seen.set(valueId, count)
    }
  }
  return false
}

/**
 * The value ids to hide from the Available list for `activeRtId`.
 *
 * Empty for a shared field -- every value stays offerable to every record type.
 * For an exclusive field, the values other record types have claimed.
 */
export function valuesScopedElsewhere(assignments, activeRtId) {
  const hidden = new Set()
  if (fieldValuesAreShared(assignments)) return hidden
  for (const [rtId, ids] of Object.entries(assignments || {})) {
    if (!rtId || rtId === activeRtId || !ids) continue
    for (const valueId of ids) hidden.add(valueId)
  }
  return hidden
}

/**
 * What the Available panel says when it is empty, given whether anything is
 * selected. The old text claimed "Every value is in Selected" even when the
 * Selected panel was empty too -- two panes each blaming the other, which is
 * how a broken screen reads as a configuration choice.
 */
export function availableEmptyMessage({ searching, selectedCount, totalActiveValues }) {
  if (searching) return 'No matches.'
  if (!totalActiveValues) return 'This field has no active values yet. Use + New Value to add one.'
  if (selectedCount > 0 && selectedCount >= totalActiveValues) return 'Every value is in Selected.'
  return 'No values available to add. Other record types have claimed them because this field’s values are not shared.'
}
