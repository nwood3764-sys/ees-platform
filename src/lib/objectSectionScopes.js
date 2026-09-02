// ---------------------------------------------------------------------------
// Sections whose object list is SCOPED, not merely filtered.
//
// The Field module's Technicians tab rendered the generic contacts list with
// no filter at all, so it showed every contact in LEAP — and could never have
// shown a technician, because a technician is a USER
// (work_orders.assigned_technician_id is an FK to users). Nicholas, after
// trying to filter his way out of it: "if it's on the field module, it can
// only show the technicians. That's it. There's no other way anyone can change
// a filter to see anyone else."
//
// That rules out a default view. A saved view, a seeded filter or an
// `initialFilters` drill-down are all things a person can clear — one click on
// "All Users" and the tab is wrong again. A scope is applied to the FETCH, so
// there is nothing in the filter UI to remove and no view that widens it.
//
// Keyed by module + section rather than by table, because the same object is
// legitimately unscoped elsewhere: Setup's own Users list must show everyone.
// ---------------------------------------------------------------------------

export const OBJECT_SECTION_SCOPES = {
  // Field > Technicians: the people who do field work, and only them.
  // user_is_field_technician is maintained per user (see the column comment) —
  // never derived from the role, because a role is an access grant and being
  // on a crew is a job fact.
  'field.technicians': {
    table:  'users',
    column: 'user_is_field_technician',
    value:  true,
    label:  'Field technicians',
  },
}

/**
 * The scope for a section, or null when it has none.
 *
 * `objectTable` must match the scope's own table. A scope names the column it
 * filters, so applying it to the wrong object would either error at the
 * database or — worse — match nothing and render an empty list that looks like
 * "no records". Returning null on a mismatch leaves the section exactly as
 * unscoped sections behave.
 */
export function scopeForSection(moduleId, sectionId, objectTable) {
  if (!moduleId || !sectionId || !objectTable) return null
  const scope = OBJECT_SECTION_SCOPES[`${moduleId}.${sectionId}`]
  if (!scope) return null
  if (scope.table !== objectTable) return null
  return scope
}
