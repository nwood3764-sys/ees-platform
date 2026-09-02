// ─── recordInsertDefaults.js ─────────────────────────────────────────────────
// Which columns does a new record have to carry before it can be inserted, and
// what goes in them.
//
// Every LEAP business table carries the same three: a record number (filled by
// a BEFORE INSERT trigger, but NOT NULL, so something has to be there when the
// statement runs), an OWNER — "every record has a named owner assigned at
// creation, required, never a team or pool" — and a created-by. Miss any of
// them and the insert dies at the constraint, which is what a person sees:
//
//     Create failed — null value in column "sa_owner" of relation
//     "service_appointments" violates not-null constraint
//
// This used to be a hand-written list of table → column prefix, about 34
// entries long, plus a tail of `else if` branches. 86 tables have a NOT NULL
// owner column. So roughly 54 objects could not be created from the UI AT ALL,
// and every object added to LEAP after the list was written joined them
// silently. The list was the defect, exactly as the URL and display allowlists
// were in 2026-08-24, and the four hand-rolled option maps were in 2026-08-31.
//
// So nothing is enumerated here. The prefix is READ OFF THE TABLE'S OWN
// COLUMNS, which means an object nobody has registered still works.
//
// The anchor is `<prefix>_record_number`, and the choice is not arbitrary:
//
//   * Every one of the platform's 162 record-carrying tables has EXACTLY ONE
//     column ending in `_record_number`. It is never ambiguous.
//   * A record number is never a business field, so it cannot be confused with
//     one — unlike `_owner`, which very much can be. Four tables carry more
//     than one column ending in `_owner`: `assessments` has assessment_owner
//     plus assessment_building_owner, _is_the_applicant_the_building_owner and
//     _permission_to_apply_on_behalf_of_owner; `efr_reports` has five.
//     Searching for "a column ending in _owner" is therefore decided by
//     DECLARATION ORDER, which nothing guarantees and describe_object_columns
//     does not promise. On `property_hud_match_review` that search returns
//     phmr_source_owner — the HUD source's owner NAME, at ordinal 7, ahead of
//     the record's own phmr_owner at 14 — so a user id would be written into a
//     text field describing somebody else's property.
//   * The table NAME is not a usable source either: saved_list_views prefixes
//     its columns `list_view_`, and no pluralisation rule derives that.
//
// Kept free of React and Supabase so the rule is testable — see
// scripts/record-insert-defaults-fixture.mjs.
// ---------------------------------------------------------------------------

/** The placeholder a record-number column carries into the insert. Every such
 *  column is filled by a BEFORE INSERT trigger that overwrites this
 *  unconditionally; it exists only to satisfy NOT NULL on the way in. */
export const RECORD_NUMBER_PLACEHOLDER = 'NEW'

/**
 * Work out a table's audit columns from the columns it actually has.
 *
 * @param {string[]} columnNames  every column on the table
 * @returns {{prefix: string|null, recordNumberColumn: string|null,
 *            ownerColumn: string|null, createdByColumn: string|null}}
 */
export function resolveInsertAuditColumns(columnNames) {
  const cols = Array.isArray(columnNames) ? columnNames.filter(c => typeof c === 'string') : []
  const none = { prefix: null, recordNumberColumn: null, ownerColumn: null, createdByColumn: null }
  if (cols.length === 0) return none

  const set = new Set(cols)
  const recordNumberColumn = cols.find(c => c.endsWith('_record_number')) || null
  if (!recordNumberColumn) {
    // A table with no record number is a junction or a log; it has no owner to
    // stamp either. Returning nothing is correct, not a failure.
    return none
  }
  const prefix = recordNumberColumn.slice(0, -'_record_number'.length)

  // Prefixed first, and only for THIS prefix — a column ending in _owner under
  // a different prefix is a business field and must never be touched.
  //
  // The bare spellings are the fallback, not a guess: email_templates,
  // document_templates and the envelope family predate the prefixed-column
  // convention and carry `owner_id` / `created_by` beside a prefixed record
  // number (et_record_number, env_record_number). They are only ever consulted
  // when the prefixed name is absent, so a table that has both is unaffected.
  const pick = (...names) => names.find(n => set.has(n)) || null
  const ownerColumn     = pick(`${prefix}_owner`, 'owner_id', 'owner')
  const createdByColumn = pick(`${prefix}_created_by`, 'created_by', 'created_by_id')

  return { prefix, recordNumberColumn, ownerColumn, createdByColumn }
}

/**
 * Fill a draft record's audit columns, leaving anything already set alone.
 * Mutates and returns `fields`, matching the previous helper's contract.
 *
 * A column that does not exist on the table is never written — an insert
 * naming an unknown column is rejected outright by PostgREST, so guessing here
 * would replace one failure with another.
 *
 * @param {string[]} columnNames  the table's real columns
 * @param {Object}   fields       the draft record
 * @param {string}   userId       public.users.id of the person creating it
 */
export function applyRecordInsertDefaults(columnNames, fields, userId) {
  const f = fields || {}
  const { recordNumberColumn, ownerColumn, createdByColumn } = resolveInsertAuditColumns(columnNames)

  if (recordNumberColumn && !f[recordNumberColumn]) {
    f[recordNumberColumn] = RECORD_NUMBER_PLACEHOLDER
  }
  // An owner may be chosen deliberately on the create form (assigning a record
  // to someone else), so only fill a blank one.
  if (ownerColumn && !f[ownerColumn] && userId) {
    f[ownerColumn] = userId
  }
  if (createdByColumn && !f[createdByColumn] && userId) {
    f[createdByColumn] = userId
  }
  return f
}
