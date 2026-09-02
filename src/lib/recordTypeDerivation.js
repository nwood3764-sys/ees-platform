// ---------------------------------------------------------------------------
// Preselecting a child's record type from its parent's.
//
// Nicholas, 2026-09-02: "when creating contacts, the record type for the
// contact needs to be inherited from the parent, so if I'm creating a contact
// on a property owner, it needs to be a property owner contact."
//
// The database guarantees it (trg_0_derive_contact_record_type fills a blank
// before the platform default is stamped). This is the visible half: the
// create pop-up should SHOW the inherited type rather than asking blind, or a
// person answers a question the platform already knew the answer to — and
// their answer WINS, because derivation only ever fills a blank.
//
// Preselect, never auto-advance. A derived record type is a default, not a
// constraint (record_type_eligibility is what constrains), so the choice stays
// on screen and stays changeable.
// ---------------------------------------------------------------------------

/**
 * The derived record type's id, but only when it is genuinely choosable here.
 *
 * A derivation rule can name a record type this particular picker is not
 * offering — it may be scoped out by state, constrained away by eligibility,
 * or already taken on the building. Preselecting one of those would show a
 * choice that cannot be saved, which is worse than showing none.
 *
 * @param recordTypes the options the picker is rendering ([{ id, taken }])
 * @param derivedId   the id the derivation rule resolved to, or null
 * @returns the id to preselect, or null
 */
export function derivedSelectableId(recordTypes, derivedId) {
  if (!derivedId || !Array.isArray(recordTypes)) return null
  const match = recordTypes.find(rt => rt && rt.id === derivedId)
  if (!match) return null
  if (match.taken) return null
  return derivedId
}
