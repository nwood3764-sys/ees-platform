// ---------------------------------------------------------------------------
// fieldTiers — what a report may still show once financial tiers apply.
//
// LEAP has described three financial visibility tiers since its first week —
// Tier 1 everyone, Tier 2 Project Managers and above, Tier 3 Admin only — and
// until 2026-08-31 nothing enforced them anywhere. A Lead Technician could put
// the agreed subcontractor payout on a report and read it.
//
// The DECISION is the database's: app_user_restricted_fields(object) is
// SECURITY DEFINER and resolves field_metadata.fm_financial_tier against the
// caller's role, so a tampered client cannot widen it. What lives here is the
// pure consequence — which parts of a SAVED report survive that decision, and
// how to say what went.
//
// Fixture-tested by scripts/field-tiers-fixture.mjs.
// ---------------------------------------------------------------------------

/**
 * Is this descriptor a field on the report's OWN object?
 *
 * Only own-object fields are checked against a given object's restricted set. A
 * field reached through a related object belongs to THAT object and is filtered
 * by its own pass — checking it here would compare a property's column against
 * the opportunity's restricted list and either miss it or drop it wrongly.
 */
export function isOwnObjectField(descriptor) {
  const via = descriptor?.via_path
  return !(Array.isArray(via) && via.length > 0)
}

/**
 * Split a saved report's parts into what survives and what was removed.
 *
 * @param parts { fields, filters, groupings } as stored on the report
 * @param restricted Set of column names the caller may not see
 * @returns { fields, filters, groupings, dropped:[names] }
 *
 * A cross-filter carries no plain field name — it is a set intersection over
 * another object — so it is never dropped by this pass.
 */
export function applyFieldRestrictions(parts, restricted) {
  const deny = restricted instanceof Set ? restricted : new Set(restricted || [])
  const dropped = []
  if (deny.size === 0) {
    return {
      fields:    parts?.fields    || [],
      filters:   parts?.filters   || [],
      groupings: parts?.groupings || [],
      dropped:   [],
    }
  }
  const keep = (name) => {
    if (name && deny.has(name)) { dropped.push(name); return false }
    return true
  }
  return {
    fields: (parts?.fields || []).filter(f => !isOwnObjectField(f) || keep(f?.name)),
    filters: (parts?.filters || []).filter(
      f => f?.rfilt_is_cross_filter
        || !isOwnObjectField({ via_path: f?.rfilt_field_via_path })
        || keep(f?.rfilt_field_name)),
    groupings: (parts?.groupings || []).filter(
      g => !isOwnObjectField({ via_path: g?.rgr_field_via_path }) || keep(g?.rgr_field_name)),
    dropped: Array.from(new Set(dropped)),
  }
}

/**
 * What the viewer is told. A report that silently comes back three columns
 * shorter reads as a bug; naming the reason is the difference between a
 * restriction and a defect.
 */
export function describeRestrictedFields(dropped, labels = {}) {
  const list = Array.isArray(dropped) ? dropped.filter(Boolean) : []
  if (list.length === 0) return null
  const named = list.map(n => labels[n] || n)
  const shown = named.slice(0, 3).join(', ')
  const rest = named.length > 3 ? ` and ${named.length - 3} more` : ''
  return `${named.length === 1 ? 'One column is' : `${named.length} columns are`} hidden by your financial access level: ${shown}${rest}.`
}
