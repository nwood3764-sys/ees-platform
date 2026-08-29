// =============================================================================
// picklistStateScope — state-scoped values inside an ordinary picklist.
//
// A picklist value has been able to name a state since the baseline
// (`picklist_values.picklist_state`), but until now only the record-type picker
// read it. The building utility picklists are the first ordinary field whose
// values are genuinely state-specific: which utilities exist is a fact about
// where the building is, so a Rocky Mount building must not be offered Madison
// Gas and Electric.
//
// This is NOT programStateScope's rule and must not be folded into it. A
// record-type list narrows to the nationwide types when the state is unknown,
// because picking the wrong program is worse than picking none. A utility list
// has no nationwide members to fall back to, so narrowing on an unknown state
// would blank the field — the opposite outcome. Same column, different question.
//
// The rule:
//   • A value set with NO stated values comes back untouched. Every picklist
//     that exists today is that case, so this can change nothing that worked.
//   • A value with no state is offered everywhere — that is what "Other" and
//     "None - Building Has No Natural Gas Service" are for.
//   • When the record's state is known, other states' values are dropped.
//   • When it is NOT known — 38 of 101 buildings carry no state — everything is
//     offered with the state appended to the label, so two rows both reading
//     "Xcel Energy" are distinguishable rather than silently interchangeable.
//   • If narrowing would leave nothing (a state nobody has seeded), the full
//     labelled list comes back. A dropdown a user cannot answer is worse than
//     a long one.
//
// Pure and side-effect free so scripts/picklist-state-scope-fixture.mjs can pin
// it; the reads that resolve a record's state live in layoutService.
// =============================================================================

// Explicit extension: this module is imported directly by
// scripts/picklist-state-scope-fixture.mjs under plain Node, which does not
// resolve extensionless paths. Vite handles it either way.
import { normalizeStateCode } from './programStateScope.js'

/**
 * The state a record claims, read from its own state column. `prefix` is the
 * table's column prefix ('building'), so both the prefixed spelling
 * (`building_state`) and the bare one (`state`) resolve.
 */
export function recordStateValue(record, prefix) {
  if (!record || typeof record !== 'object') return null
  const keys = prefix ? [`${prefix}_state`, 'state'] : ['state']
  for (const k of keys) {
    const found = normalizeStateCode(record[k])
    if (found) return found
  }
  return null
}

/** True when any value in the set is scoped to a state. */
export function hasStateScopedValues(options) {
  return Array.isArray(options) && options.some(o => o && normalizeStateCode(o.state))
}

const labelWithState = (o) => ({ ...o, label: `${o.label} (${normalizeStateCode(o.state)})` })

/**
 * Narrow a fetched option list to the record's state. See the rule above.
 * Returns the same array instance when there is nothing to do.
 */
export function scopePicklistOptionsToState(options, state) {
  const list = Array.isArray(options) ? options : []
  if (!hasStateScopedValues(list)) return list

  const everything = list.map(o => (o && normalizeStateCode(o.state)) ? labelWithState(o) : o)

  const wanted = normalizeStateCode(state)
  if (!wanted) return everything

  const narrowed = list.filter(o => {
    const s = o && normalizeStateCode(o.state)
    return !s || s === wanted
  })
  return narrowed.length > 0 ? narrowed : everything
}
