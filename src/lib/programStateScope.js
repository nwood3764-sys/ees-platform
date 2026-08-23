// =============================================================================
// programStateScope — which state's programs a record may carry.
//
// Every program EES runs belongs to exactly one state, and its record type says
// so: picklist_state holds 'WI' / 'NC' / 'MI' / …, or null for a record type
// that runs everywhere (Field Operations). Narrowing a record-type picker is
// therefore one rule applied to one input — the state the new record is in.
//
// Nicholas, 2026-08-23, from the New Opportunity pop-up on a Rocky Mount, North
// Carolina building that offered FOE-2024-WI and the whole Michigan set:
// "North Carolina properties only get North Carolina opportunities."
//
// Pure and side-effect free so scripts/program-state-scope-fixture.mjs can pin
// it; the reads that resolve a state from the database live in layoutService.
// =============================================================================

/**
 * The record types available in a state: the ones scoped to it, plus every
 * nationwide type. A null/blank state narrows to the nationwide types only —
 * "we don't know where this is yet" must never widen the list to every program
 * in the platform, which is the failure this module exists to prevent.
 */
export function scopedToState(recordTypes, stateCode) {
  const wanted = normalizeStateCode(stateCode)
  return (recordTypes || []).filter(rt => !rt?.state || rt.state === wanted)
}

/** Every state this set of record types has programs configured for, sorted. */
export function statesInRecordTypes(recordTypes) {
  return [...new Set((recordTypes || []).map(rt => rt?.state).filter(Boolean))].sort()
}

/**
 * True when the user has to say which state this record is in before the
 * record-type list means anything: the record could not tell us, and the object
 * has programs in more than one state. An object whose types are all nationwide
 * (or all in one state) never asks.
 */
export function needsStateChoice(stateFromRecord, recordTypes) {
  if (normalizeStateCode(stateFromRecord)) return false
  return statesInRecordTypes(recordTypes).length > 1
}

/**
 * The state a create-prefill carries in its own columns, e.g. building_state on
 * a new opportunity seeded from a building. Last resort only — a state column on
 * a child record is frequently blank, so layoutService resolves the property
 * first and falls back to this.
 */
export function programStateFromSeed(seed) {
  if (!seed || typeof seed !== 'object') return null
  for (const [key, value] of Object.entries(seed)) {
    if (!key.endsWith('_state')) continue
    const code = normalizeStateCode(value)
    if (code) return code
  }
  return null
}

/** Trim and upper-case a state code; anything else resolves to null. */
export function normalizeStateCode(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toUpperCase()
  return trimmed || null
}

/**
 * True when this object's record types are state-scoped and NONE of them run in
 * the given state — so the honest answer is "no record type is available here",
 * never another state's programs.
 *
 * This is the rule behind the one remaining way a wrong-state program could
 * still be offered. fetchAvailableRecordTypes used to fall back to the FULL
 * active set whenever the state filter came back empty, so a Texas property —
 * and 4,037 of them are live — was shown every Wisconsin incentive application
 * form. The fallback existed to stop the picker auto-dismissing and silently
 * skipping the record-type prompt, which is a real problem; widening across
 * states is the wrong cure for it. The picker now says so instead.
 *
 * An object with any nationwide type (picklist_state null) can never reach this:
 * a nationwide type passes every state filter, so the scoped list is non-empty.
 */
export function stateHasNoPrograms(recordTypes, stateCode) {
  const wanted = normalizeStateCode(stateCode)
  if (!wanted) return false
  const list = recordTypes || []
  if (list.length === 0) return false
  // Not a state-scoped object at all — no state carried by any type — so an
  // empty scoped list means something else, and this rule has no opinion.
  if (statesInRecordTypes(list).length === 0) return false
  return scopedToState(list, wanted).length === 0
}
