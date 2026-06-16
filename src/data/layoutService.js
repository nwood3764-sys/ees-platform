import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'
import { invalidateAll } from '../lib/useCachedFetch'
export { loadPicklists }

/**
 * Get the current authenticated user's app-level UUID from the users table.
 */
let _cachedUserId = null
export async function getCurrentUserId() {
  if (_cachedUserId) return _cachedUserId
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data } = await supabase.from('users').select('id').eq('auth_user_id', user.id).single()
  _cachedUserId = data?.id || user.id
  return _cachedUserId
}

/**
 * Clear the in-memory user caches. Called from the AuthGate sign-out
 * handler so a second user signing in on the same browser session
 * doesn't inherit the previous user's app-level ID.
 *
 * Without this, a sign-out + sign-in cycle leaves _cachedUserId pointing
 * at the previous user, which would silently attribute new edits to the
 * wrong owner (saveRecord uses getCurrentUserId() to stamp updated_by).
 */
export function clearUserCache() {
  _cachedUserId = null
  _cachedUserProfile = null
  _cachedAccessibleModules = null
  _cachedCanViewAs = null
}

/**
 * Get the current authenticated user's display profile — display name and role
 * name joined from users/roles. Used by module headers that render
 * "<Role> Dashboard" / "<Display Name> · <date>".
 *
 * Returns { displayName, roleName, email } where either field may be null if
 * the auth user has no matching app-level users row or no assigned role. The
 * caller is responsible for falling back sensibly when a field is null.
 *
 * Cached per session to avoid re-querying on every module mount.
 */
let _cachedUserProfile = null
export async function getCurrentUserProfile() {
  if (_cachedUserProfile) return _cachedUserProfile

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { displayName: null, roleName: null, email: null }

  const { data } = await supabase
    .from('users')
    .select('user_name, user_first_name, user_last_name, user_email, roles:role_id ( role_name )')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // If the auth user has no corresponding app-level users row yet, the header
  // will still render via its fallback path — we don't want to crash the UI.
  const displayName =
    data?.user_name ||
    [data?.user_first_name, data?.user_last_name].filter(Boolean).join(' ').trim() ||
    null

  const profile = {
    displayName: displayName || null,
    roleName: data?.roles?.role_name || null,
    email: data?.user_email || user.email || null,
  }

  _cachedUserProfile = profile
  return profile
}

// Module-level access for the main app. Returns the set of NAV_MODULES ids the
// current user may see. Admin resolves to the sentinel ['*'] meaning "all".
// Cached per session alongside the profile; cleared by clearUserCache().
let _cachedAccessibleModules = null
export async function fetchAccessibleModules() {
  if (_cachedAccessibleModules) return _cachedAccessibleModules
  const { data, error } = await supabase.rpc('my_accessible_modules')
  if (error) throw error
  const list = Array.isArray(data) ? data : []
  _cachedAccessibleModules = list
  return list
}

// True if the user may access a given module id, honoring the '*' admin token.
export function moduleAllowed(accessible, moduleId) {
  if (!accessible) return false
  if (accessible.includes('*')) return true
  return accessible.includes(moduleId)
}

// ── View As (role-preview troubleshooting) ──────────────────────────────────
// Whether the current user may use View As at all (Admin or granted role).
let _cachedCanViewAs = null
export async function fetchCanUseViewAs() {
  if (_cachedCanViewAs !== null) return _cachedCanViewAs
  const { data, error } = await supabase.rpc('can_use_view_as')
  if (error) { _cachedCanViewAs = false; return false }
  _cachedCanViewAs = !!data
  return _cachedCanViewAs
}

// All active roles, for the View As picker.
export async function fetchAllRoles() {
  const { data, error } = await supabase
    .from('roles')
    .select('id, role_name')
    .eq('role_is_active', true)
    .order('role_name', { ascending: true })
  if (error) throw error
  return data || []
}

// The module set a given role would see — used to simulate that role's nav.
export async function fetchModuleAccessForRole(roleId) {
  const { data, error } = await supabase.rpc('module_access_for_role', { p_role_id: roleId })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

/**
 * Identify the table's record-type column. For business tables (accounts,
 * properties, opportunities, etc.) this is `{prefix}_record_type` where the
 * prefix is the singular form of the table name with the long-prefix tables
 * (incentive_applications -> ia, work_plan_templates -> wpt) handled by the
 * applyInsertDefaults explicit-case map elsewhere. For Create-mode form
 * prefill we accept either the canonical column name OR the generic
 * `record_type` key, which propagates through to the right column at save.
 */
// Central table->column-prefix map. Same prefixes the database columns use
// (e.g. accounts.account_*, properties.property_*). Driven by hand because
// English pluralization rules don't always match how column prefixes were
// chosen — and getting it wrong silently produces invalid column names
// like 'propertie_record_type' or 'opportunitie_record_type'. Every table
// that has prefixed columns must appear here. Tables that don't follow
// the convention at all (mapping tables, certain telemetry) are absent.
const TABLE_COLUMN_PREFIX = {
  accounts:                          'account',
  account_contact_relations:         'acr',
  assessments:                       'assessment',
  buildings:                         'building',
  bulk_import_runs:                  'bir',
  contacts:                          'contact',
  contact_skills:                    'cs',
  conversations:                     'conv',
  diagnostic_tests:                  'dt',
  efr_reports:                       'efr',
  equipment:                         'equipment',
  equipment_activities:              'ea',
  incentive_applications:            'ia',
  messages:                          'msg',
  opportunities:                     'opportunity',
  opportunity_contact_roles:         'ocr',
  outbound_mailboxes:                'outbound_mailbox',
  products:                          'product',
  projects:                          'project',
  project_payment_requests:          'ppr',
  project_report_templates:          'prt',
  project_report_template_sections:  'prts',
  project_report_template_snapshots: 'prtsn',
  project_reservations:              'pr',
  properties:                        'property',
  service_appointments:              'sa',
  service_appointment_assignments:   'saa',
  skills:                            'skill',
  units:                             'unit',
  vehicles:                          'vehicle',
  work_orders:                       'work_order',
  work_plans:                        'work_plan',
  work_plan_templates:               'wpt',
  work_steps:                        'work_step',
  work_step_templates:               'wst',
  work_type_skill_requirements:      'wtsr',
}

/**
 * Get the column prefix for a table. Returns null if the table isn't in
 * the canonical map, which means callers must handle that case explicitly
 * rather than silently producing a wrong column name like 'propertie_*'.
 */
export function getTableColumnPrefix(tableName) {
  return TABLE_COLUMN_PREFIX[tableName] || null
}

export function getRecordTypeColumn(tableName) {
  const prefix = TABLE_COLUMN_PREFIX[tableName]
  if (!prefix) {
    // No mapping — fall back to the literal column name 'record_type'.
    // Tables outside the map shouldn't be using record types, but if one
    // does, prefer the unprefixed name over a guess that might be wrong.
    return 'record_type'
  }
  return `${prefix}_record_type`
}

/**
 * Returns the active record-type picklist values for an object as
 * [{ id, value, label }]. Empty array means the object has no record-type
 * differentiation and the Create flow should skip the record-type picker.
 */
export async function fetchAvailableRecordTypes(objectName, { state = null } = {}) {
  let query = supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label, picklist_state')
    .eq('picklist_object', objectName)
    .eq('picklist_field', 'record_type')
    .eq('picklist_is_active', true)
  // When a state is supplied, show only record types scoped to that state plus
  // any nationwide types (picklist_state IS NULL). When no state is supplied,
  // show everything active (the picker falls back to the full set).
  if (state) {
    query = query.or(`picklist_state.eq.${state},picklist_state.is.null`)
  }
  // Always alphabetical ascending by label — never storage/sort_order, which
  // produces an illogical sequence for the user.
  query = query.order('picklist_label', { ascending: true })
  const { data, error } = await query
  if (error) throw error
  return (data || []).map(r => ({
    id:    r.id,
    value: r.picklist_value,
    label: r.picklist_label || r.picklist_value,
    state: r.picklist_state || null,
  }))
}

/**
 * Extract the record-type value from a record (or prefill draft) regardless of
 * column-naming convention. Energy Efficiency Services business tables use a {prefix}_record_type
 * column (e.g. property_record_type, account_record_type, ia_record_type) that
 * holds a uuid FK to picklist_values.id; a few legacy tables still use a
 * generic `record_type` text column. This finds the first matching key on
 * the input and returns its value, or null if none is set.
 */
export function getRecordTypeValue(obj) {
  if (!obj) return null
  // Prefer a generic `record_type` if present (covers prefill paths and the
  // small set of legacy text-typed tables), but fall through to any prefixed
  // form. There is at most one record-type column per table by convention.
  if ('record_type' in obj && obj.record_type != null && obj.record_type !== '') {
    return obj.record_type
  }
  for (const key of Object.keys(obj)) {
    if (key.endsWith('_record_type') && obj[key] != null && obj[key] !== '') {
      return obj[key]
    }
  }
  return null
}

// A canonical RFC 4122 uuid string. We use this to decide whether a value
// passed into fetchPageLayout is already a picklist_values.id (uuid path)
// or needs to be resolved through a name lookup (legacy text path).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Batch field-permission resolver. For an object and a list of field names,
 * returns a Map<fieldName, { visible, editable }> by calling the
 * app_user_field_permissions RPC. Single round-trip per layout fetch.
 *
 * Empty fields list short-circuits to an empty Map (no RPC call).
 *
 * On RPC failure: returns an empty Map. fetchPageLayout treats that as
 * "no overrides" (default visible+editable) so a transient permissions error
 * never blanks the page — the safety net is RLS, not the UI filter.
 */
export async function fetchFieldPermissions(objectName, fields) {
  if (!objectName || !fields || fields.length === 0) return new Map()
  // De-dupe — same field can appear in multiple widgets across sections.
  const unique = Array.from(new Set(fields.filter(Boolean)))
  if (unique.length === 0) return new Map()

  const { data, error } = await supabase.rpc('app_user_field_permissions', {
    p_object: objectName,
    p_fields: unique,
  })
  if (error) {
    console.warn('app_user_field_permissions failed:', error.message)
    return new Map()
  }

  const map = new Map()
  if (data && typeof data === 'object') {
    for (const [name, perm] of Object.entries(data)) {
      map.set(name, {
        visible: perm?.visible !== false,
        editable: perm?.editable !== false,
      })
    }
  }
  return map
}

/**
 * Fetch the page layout configuration for a given object.
 * Returns { layout, sections: [{ ...section, widgets: [...] }] }
 *
 * The `recordTypeValue` argument accepts either form:
 *   • a uuid — used directly as the page_layouts.record_type_id (the
 *     `{prefix}_record_type` columns on business tables ARE the
 *     picklist_values.id, so no resolution is needed)
 *   • a non-uuid string — resolved through picklist_values via
 *     (picklist_object, picklist_field='record_type', picklist_value)
 *     for the small set of legacy tables that still store text values
 *
 * If neither resolves, falls back to the master layout
 * (record_type_id IS NULL).
 *
 * After loading the layout, applies field-level permissions to every
 * field_group widget: invisible fields are stripped from widget_config.fields,
 * and remaining fields are annotated with `_editable` (true unless the
 * resolver explicitly says otherwise). The frontend renderer treats
 * `_editable === false` as read-only in edit mode.
 *
 * Pass `{ skipPermissions: true }` to bypass — used by admin tooling that
 * needs to see the unfiltered layout (Page Layout Builder).
 */
export async function fetchPageLayout(objectName, recordTypeValue = null, options = {}) {
  const { skipPermissions = false } = options
  // Step 1 — resolve the record_type_id if a value was supplied.
  let recordTypeId = null
  if (recordTypeValue != null && recordTypeValue !== '') {
    if (UUID_RE.test(String(recordTypeValue))) {
      // The value is already a picklist_values.id — use it directly.
      recordTypeId = recordTypeValue
    } else {
      // Legacy text-value path: resolve via picklist_values lookup.
      const { data: rtRows, error: rtErr } = await supabase
        .from('picklist_values')
        .select('id')
        .eq('picklist_object', objectName)
        .eq('picklist_field', 'record_type')
        .eq('picklist_value', recordTypeValue)
        .eq('picklist_is_active', true)
        .limit(1)
      if (rtErr) throw rtErr
      if (rtRows && rtRows.length > 0) recordTypeId = rtRows[0].id
    }
  }

  // Step 2 — fetch candidate layouts: the record-type-specific one (if any)
  //         and the master. We filter is_default=true so there's at most one
  //         of each per scope (enforced by page_layouts_one_default_per_scope).
  let query = supabase
    .from('page_layouts')
    .select('*')
    .eq('page_layout_object', objectName)
    .eq('page_layout_type', 'record_detail')
    .eq('page_layout_is_default', true)
    .eq('is_deleted', false)

  if (recordTypeId) {
    // Pull both: matching record_type_id OR master (null). PostgREST `.or()`
    // with `is.null` covers the master side.
    query = query.or(`record_type_id.eq.${recordTypeId},record_type_id.is.null`)
  } else {
    query = query.is('record_type_id', null)
  }

  const { data: layouts, error: layoutErr } = await query
  if (layoutErr) throw layoutErr
  if (!layouts || layouts.length === 0) return null

  // Step 3 — prefer the record-type-specific layout; fall back to master.
  const layout =
    (recordTypeId && layouts.find(l => l.record_type_id === recordTypeId)) ||
    layouts.find(l => l.record_type_id == null) ||
    null
  if (!layout) return null

  // Get sections ordered by section_order — respect soft-delete
  const { data: sections, error: secErr } = await supabase
    .from('page_layout_sections')
    .select('*')
    .eq('page_layout_id', layout.id)
    .eq('is_deleted', false)
    .order('section_order', { ascending: true })

  if (secErr) throw secErr

  // Get all widgets for this layout
  const { data: widgets, error: widErr } = await supabase
    .from('page_layout_widgets')
    .select('*')
    .eq('page_layout_id', layout.id)
    .eq('is_deleted', false)
    .order('widget_position', { ascending: true })

  if (widErr) throw widErr

  // Nest widgets under their sections
  const sectionMap = new Map()
  for (const s of sections || []) {
    sectionMap.set(s.id, { ...s, widgets: [] })
  }
  for (const w of widgets || []) {
    const sec = sectionMap.get(w.section_id)
    if (sec) sec.widgets.push(w)
  }

  const sectionList = Array.from(sectionMap.values())

  // Apply field-level permissions to every field_group widget. We collect
  // every referenced field name across all field_group widgets, batch-resolve
  // visibility+editability in one RPC call, then mutate widget_config.fields
  // in place: drop invisible fields, annotate the rest with `_editable`.
  //
  // Skipped when `skipPermissions: true` is passed (admin Page Layout Builder
  // needs the unfiltered view to author layouts) or when no field_group
  // widgets exist (charts-only or related-list-only layouts).
  if (!skipPermissions) {
    const fieldNames = []
    for (const sec of sectionList) {
      for (const w of sec.widgets) {
        if (w.widget_type === 'field_group' && Array.isArray(w.widget_config?.fields)) {
          for (const f of w.widget_config.fields) {
            if (f?.name) fieldNames.push(f.name)
          }
        }
      }
    }

    if (fieldNames.length > 0) {
      const perms = await fetchFieldPermissions(objectName, fieldNames)
      // perms is empty when (a) the user has no app-level row, (b) the RPC
      // failed, or (c) Admin (Admin returns explicit visible+editable=true
      // for every requested field, so this branch only catches a/b). In all
      // three cases we leave the layout untouched — the resolver returns no
      // entries for fields with no override, which means default visible.
      if (perms.size > 0) {
        for (const sec of sectionList) {
          for (const w of sec.widgets) {
            if (w.widget_type !== 'field_group' || !Array.isArray(w.widget_config?.fields)) continue
            const filtered = []
            for (const f of w.widget_config.fields) {
              const p = f?.name ? perms.get(f.name) : null
              if (p && p.visible === false) continue  // strip invisible
              filtered.push(p ? { ...f, _editable: p.editable } : f)
            }
            // Mutate widget_config (cloning to avoid sharing references with
            // the page-layout cache — page_layout_widgets rows are read-only
            // from this code path but defensive cloning costs nothing).
            w.widget_config = { ...w.widget_config, fields: filtered }
          }
        }
      }
    }
  }

  // Step 4 — fetch per-layout action overrides. Drives the topbar's
  // primary/menu tier assignment for actions; absence of a row means "use
  // the recordActions.js registry default." Read is RLS-open so this works
  // for every authenticated user.
  let actionOverrides = []
  {
    const { data, error } = await supabase
      .from('page_layout_actions')
      .select('pla_action_key, pla_display_tier, pla_sort_order, pla_label_override, pla_visibility_role_id, pla_is_deleted')
      .eq('pla_page_layout_id', layout.id)
      .eq('pla_is_deleted', false)
    if (error) throw error
    actionOverrides = data || []
  }

  return {
    layout,
    sections: applyConventionalReadOnly(objectName, sectionList),
    actionOverrides,
  }
}

/**
 * Annotate read-only fields based on table+name conventions. Two kinds:
 *
 * 1. Roll-up summary fields — naming patterns that always indicate computed
 *    aggregates: <prefix>_total_number_of_<thing>, <prefix>_number_of_<thing>,
 *    <prefix>_amount_of_<thing>, <prefix>_count_of_<thing>, *_rollup.
 *    These are maintained by triggers (or to-be-built triggers); the user
 *    should never type into them.
 *
 * 2. Derived-name fields — Salesforce-style auto-computed display names.
 *    Currently:
 *      - properties.property_name  =  property_street + ' - ' + property_city
 *      - (others may follow as the model fleshes out)
 *    The handleFieldChange in RecordDetail keeps the draft in sync when the
 *    source fields change. Marking them read-only here prevents the user
 *    from typing into them directly.
 *
 * Mutates the section list in place; the same reference is returned so the
 * caching identity stays stable.
 */
function applyConventionalReadOnly(objectName, sectionList) {
  const ROLLUP_RE = /(_total_number_of_|_number_of_|_amount_of_|_count_of_|_rollup$)/
  const DERIVED_NAME_FIELDS = {
    properties: new Set(['property_name']),
  }
  const derivedSet = DERIVED_NAME_FIELDS[objectName] || new Set()
  for (const sec of sectionList) {
    for (const w of sec.widgets || []) {
      if (w.widget_type !== 'field_group' || !Array.isArray(w.widget_config?.fields)) continue
      const fields = w.widget_config.fields.map(f => {
        if (!f?.name) return f
        if (f._editable === false) return f
        if (ROLLUP_RE.test(f.name) || derivedSet.has(f.name)) return { ...f, _editable: false }
        return f
      })
      w.widget_config = { ...w.widget_config, fields }
    }
  }
  return sectionList
}

/**
 * Fetch a single record from a table by ID.
 * Returns all columns (SELECT *).
 */
export async function fetchRecord(tableName, recordId) {
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .eq('id', recordId)
    .limit(1)
    .single()

  if (error) throw error
  return data
}

/**
 * Resolve lookup fields — given an array of { lookup_table, lookup_field, value (uuid) },
 * batch-fetch display values. Returns a Map<uuid, { label, table }>. The
 * `table` is the parent table the FK points at, so the renderer can turn the
 * value into a clickable hyperlink that navigates to the parent record.
 *
 * Map values used to be plain strings — Map.get(id) returned a label. The
 * shape change is non-breaking because callers either:
 *   • use `lookups.get(id)` for display (now returns an object — handled by
 *     formatFieldValue and friends, which read `.label`), or
 *   • use `lookups.has(id)` for existence checks (still works).
 *
 * To keep the formatFieldValue path simple, this function ALSO mirrors a
 * label-only string under a parallel Map keyed `${id}__label`, but the
 * canonical entry is the object. Callers updated below read `.label`.
 */
export async function resolveLookups(lookupRequests) {
  const resolved = new Map()
  if (!lookupRequests || lookupRequests.length === 0) return resolved

  // Group by table to batch queries
  const byTable = new Map()
  for (const req of lookupRequests) {
    if (!req.value) continue
    const key = `${req.lookup_table}:${req.lookup_field}`
    if (!byTable.has(key)) {
      byTable.set(key, { table: req.lookup_table, field: req.lookup_field, ids: new Set() })
    }
    byTable.get(key).ids.add(req.value)
  }

  await Promise.all(
    Array.from(byTable.values()).map(async ({ table, field, ids }) => {
      const idArr = Array.from(ids)
      const { data } = await supabase
        .from(table)
        .select(`id, ${field}`)
        .in('id', idArr)
      for (const row of data || []) {
        resolved.set(row.id, { label: row[field], table })
      }
    })
  )

  return resolved
}

// ─── Polymorphic lookup support ─────────────────────────────────────────────
// Some FK columns don't have a fixed parent — `envelopes.env_parent_record_id`
// can point at projects, properties, opportunities, etc. The table name is
// stored in a sibling column (`env_parent_object`). The renderer needs to
// resolve these at load time and turn the UUID into a hyperlink to the right
// place. Same shape as `resolveLookups` so callers can merge the results.
//
// Each request: { object_value: 'projects', value: '<uuid>' }. Returns the
// same Map<uuid, { label, table }> shape as resolveLookups.
//
// The display column per table comes from POLY_DISPLAY_COL — a small registry
// that mirrors the nameColumn/recordNumberColumn intent in RecordDetail's
// TABLE_META. It lives here rather than imported from RecordDetail because
// layoutService.js is a leaf and the cyclic import is undesirable. When a new
// table needs to be a polymorphic-lookup target, add a row to this map.
const POLY_DISPLAY_COL = {
  // Outreach
  accounts:                 'account_name',
  contacts:                 'contact_name',
  properties:               'property_name',
  buildings:                'building_name',
  units:                    'unit_name',
  opportunities:            'opportunity_name',
  // Field
  projects:                 'project_name',
  work_orders:              'work_order_name',
  envelopes:                'env_name',
  // Qualification
  assessments:              'assessment_name',
  incentive_applications:   'ia_name',
  // Stock / Fleet
  products:                 'product_name',
  equipment:                'equipment_name',
  vehicles:                 'vehicle_name',
  // Admin (record-number-as-name where there's no narrative name field)
  email_templates:          'name',
  document_templates:       'name',
  project_report_templates: 'prt_name',
  skills:                   'skill_name',
}

/**
 * Resolve polymorphic lookups. Each request: { object_value, value }.
 * Returns Map<uuid, { label, table }> — same shape as resolveLookups, so the
 * caller can merge both maps into one `lookups` map for the renderer.
 */
export async function resolvePolymorphicLookups(requests) {
  const resolved = new Map()
  if (!requests || requests.length === 0) return resolved

  // Group by target table — the table comes from the runtime row data, not
  // the layout, so we can't pre-batch this the way we do for static lookups.
  const byTable = new Map()
  for (const req of requests) {
    if (!req.value || !req.object_value) continue
    const tbl = req.object_value
    if (!POLY_DISPLAY_COL[tbl]) continue  // table we can't display — skip
    if (!byTable.has(tbl)) byTable.set(tbl, new Set())
    byTable.get(tbl).add(req.value)
  }

  await Promise.all(
    Array.from(byTable.entries()).map(async ([table, idSet]) => {
      const displayCol = POLY_DISPLAY_COL[table]
      const idArr = Array.from(idSet)
      try {
        const { data } = await supabase
          .from(table)
          .select(`id, ${displayCol}`)
          .in('id', idArr)
        for (const row of data || []) {
          resolved.set(row.id, { label: row[displayCol] || String(row.id).slice(0, 8), table })
        }
      } catch {
        // RLS denies, table doesn't exist, etc. Skip silently — the renderer
        // falls back to displaying the raw UUID.
      }
    })
  )

  return resolved
}

/**
 * Fetch related records for a related_list widget.
 */
export async function fetchRelatedRecords(config, parentRecordId) {
  const { table, fk, is_deleted_col, columns, sort_field, sort_dir } = config

  // Build the select. Plain columns are listed by name. A column of
  // type 'lookup' (with lookup_table + lookup_field) is fetched as a
  // PostgREST embedded resource so the related list can show the FK's
  // human name (e.g. the contact's name) instead of a raw UUID. The
  // embed is aliased to the column name so the flattening step below can
  // find it: `<colName>:<fk_col>(<name_col>)`.
  const selectParts = ['id']
  const lookupCols = []
  for (const c of columns) {
    if (c.type === 'lookup' && c.lookup_table && c.lookup_field && c.fk_column) {
      selectParts.push(`${c.name}:${c.fk_column}(${c.lookup_field})`)
      lookupCols.push(c)
    } else {
      selectParts.push(c.name)
    }
  }

  let query = supabase
    .from(table)
    .select(selectParts.join(', '))
    .eq(fk, parentRecordId)

  if (is_deleted_col) {
    query = query.eq(is_deleted_col, false)
  }

  if (sort_field) {
    query = query.order(sort_field, { ascending: sort_dir !== 'desc' })
  }

  query = query.limit(25)

  const { data, error } = await query
  if (error) throw error

  // Flatten embedded lookup objects to their display string so the cell
  // renderer receives a plain value. `row[colName]` arrives as
  // { <lookup_field>: 'Josiah Brazle' } | null; collapse it to the string.
  const rows = data || []
  if (lookupCols.length) {
    for (const row of rows) {
      for (const c of lookupCols) {
        const embedded = row[c.name]
        row[c.name] = embedded && typeof embedded === 'object'
          ? (embedded[c.lookup_field] ?? null)
          : (embedded ?? null)
      }
    }
  }
  return rows
}

/**
 * Master function: load everything needed to render a record detail page.
 * Returns { record, layout, sections, picklists, lookups }
 */
export async function loadRecordDetailData(tableName, recordId) {
  // Fetch the record first — its record_type column (if present) determines
  // which page layout to load. Picklists are independent and run in parallel
  // with the record fetch.
  const [record, picklists] = await Promise.all([
    fetchRecord(tableName, recordId),
    loadPicklists(),
  ])

  // record_type is optional — tables without it yield null, which
  // fetchPageLayout treats as a request for the master layout.
  const layoutData = await fetchPageLayout(tableName, getRecordTypeValue(record))

  if (!layoutData) {
    return { record, layout: null, sections: [], picklists, lookups: new Map(), actionOverrides: [] }
  }

  // Collect lookup requests from all field_group widgets.
  // Two flavors are gathered side-by-side:
  //   • static lookups (type='lookup') — target table fixed in widget config
  //   • polymorphic lookups (type='polymorphic_lookup') — target table read
  //     from a sibling column on the record (e.g. env_parent_object names
  //     the table for env_parent_record_id). The sibling column is given
  //     by widget_config.fields[].object_field.
  const lookupRequests = []
  const polyRequests = []
  for (const sec of layoutData.sections) {
    for (const w of sec.widgets) {
      if (w.widget_type === 'field_group' && w.widget_config?.fields) {
        for (const f of w.widget_config.fields) {
          if (f.type === 'lookup' && record[f.name]) {
            lookupRequests.push({
              lookup_table: f.lookup_table,
              lookup_field: f.lookup_field,
              value: record[f.name],
            })
          } else if (f.type === 'polymorphic_lookup' && record[f.name] && f.object_field) {
            polyRequests.push({
              object_value: record[f.object_field],
              value: record[f.name],
            })
          }
        }
      }
    }
  }

  // Resolve both flavors in parallel and merge into a single Map. Callers
  // (formatFieldValue, FieldGroupWidget, Breadcrumbs) read both kinds out
  // of the same `lookups` map without caring which kind a UUID came from.
  const [staticLookups, polyLookups] = await Promise.all([
    resolveLookups(lookupRequests),
    resolvePolymorphicLookups(polyRequests),
  ])
  const lookups = new Map([...staticLookups, ...polyLookups])

  // Pre-fetch related list data. Previously this was a serial for-loop with an
  // await per related list, so a record with N related lists incurred N
  // sequential round-trips before first render — the dominant cause of slow
  // record loads. Collect every related-list widget and fetch them in parallel.
  const relatedWidgets = []
  for (const sec of layoutData.sections) {
    for (const w of sec.widgets) {
      if (w.widget_type === 'related_list' && w.widget_config) {
        relatedWidgets.push(w)
      }
    }
  }
  await Promise.all(
    relatedWidgets.map(async (w) => {
      w._relatedData = await fetchRelatedRecords(w.widget_config, recordId)
    })
  )

  return {
    record,
    layout: layoutData.layout,
    sections: layoutData.sections,
    picklists,
    lookups,
    actionOverrides: layoutData.actionOverrides || [],
  }
}

/**
 * Save changes to a record. Only sends the changed fields.
 * Returns the updated record.
 */
export async function saveRecord(tableName, recordId, changes) {
  const { data, error } = await supabase
    .from(tableName)
    .update(changes)
    .eq('id', recordId)
    .select()
    .single()

  if (error) throw error
  // Nuke the cross-module cache so any other section the user opens
  // next gets a fresh read. The cost is a re-fetch on next navigation;
  // the benefit is no stale lists showing this record's old values.
  invalidateAll()
  return data
}

/**
 * Fetch picklist options for a given object + field.
 * Used to populate <select> dropdowns in edit mode.
 */
export async function fetchPicklistOptions(objectName, fieldName) {
  // Status / lifecycle fields are the ONE place where sort_order is the
  // logical order (To Be Scheduled -> Scheduled -> In Progress ...). Every
  // other picklist is a choice list and must be alphabetical ascending so the
  // user always sees a predictable, scannable order.
  const isLifecycleField = (f) => f === 'status' || /_status$/.test(f) || f === 'stage' || /_stage$/.test(f)

  // Picklist values use the *short* field name (e.g. 'record_type', 'status',
  // 'type'), while page-layout widgets pass the actual column name on the
  // table (e.g. 'account_record_type', 'property_subsidy_type'). Try the
  // direct lookup first; if it returns nothing AND the column name has the
  // table's prefix in front of a known short field, retry with the short
  // form. This keeps the loader resilient to both naming styles.
  const tryFetch = async (field) => {
    let q = supabase
      .from('picklist_values')
      .select('id, picklist_value, picklist_label, picklist_sort_order')
      .eq('picklist_object', objectName)
      .eq('picklist_field', field)
      .eq('picklist_is_active', true)
    if (isLifecycleField(field)) {
      q = q.order('picklist_sort_order', { ascending: true })
    } else {
      q = q.order('picklist_label', { ascending: true })
    }
    const { data, error } = await q
    if (error) throw error
    return data || []
  }

  let rows = await tryFetch(fieldName)

  if (rows.length === 0) {
    // Strip the table's column prefix and retry. Uses the canonical
    // TABLE_COLUMN_PREFIX map so this handles every table correctly
    // including y->ies words (properties, opportunities) that naive
    // pluralization breaks.
    const prefix = getTableColumnPrefix(objectName)
    if (prefix && fieldName.startsWith(`${prefix}_`)) {
      const shortField = fieldName.slice(prefix.length + 1)
      rows = await tryFetch(shortField)
    }
  }

  return rows.map(r => ({
    id: r.id,
    value: r.id,        // the UUID stored in the record
    label: r.picklist_label || r.picklist_value,
  }))
}

/**
 * Insert a new record. Returns the newly created record.
 */
export async function insertRecord(tableName, fields) {
  const { data, error } = await supabase
    .from(tableName)
    .insert(fields)
    .select()
    .single()

  if (error) throw error
  // Same reasoning as saveRecord / deleteRecord: insert affects any
  // list view containing this table, anywhere in the app.
  invalidateAll()
  return data
}

/**
 * Apply the standard Energy Efficiency Services insert-time defaults to a draft record. Fills in
 * `<prefix>_record_number = 'NEW'` (the BEFORE-INSERT auto-number trigger
 * overwrites it), `<prefix>_owner = userId`, and `<prefix>_created_by = userId`
 * based on the table's naming convention. Mutates and returns `fields`.
 *
 * Handles two naming patterns:
 *   1. The table name prefixes its columns directly (contacts → contact_*,
 *      work_orders → work_order_*).
 *   2. The table uses a short abbreviation (incentive_applications → ia_*,
 *      work_step_templates → wst_*). These are enumerated explicitly.
 *
 * This helper is shared between RecordDetail.handleSave and the picker
 * modal's inline-create flow so both paths produce identical inserts.
 */
export function applyInsertDefaults(tableName, fields, userId) {
  // Explicit table -> column-prefix map. Replaces a previous pluralization-
  // guessing loop that broke for y->ies words (properties, opportunities,
  // assessments-was-fine-but-companies/categories etc would have failed
  // too). Map covers every standard-prefix Energy Efficiency Services
  // business table. Short-prefix tables (incentive_applications -> ia_, etc.)
  // are handled by the explicit branches below.
  const TABLE_PREFIX = {
    accounts:       'account',
    assessments:    'assessment',
    buildings:      'building',
    contacts:       'contact',
    equipment:      'equipment',   // already singular
    opportunities:  'opportunity',
    products:       'product',
    projects:       'project',
    properties:     'property',
    skills:         'skill',
    units:          'unit',
    vehicles:       'vehicle',
    work_orders:    'work_order',
  }
  const p = TABLE_PREFIX[tableName]
  if (p) {
    if (!fields[`${p}_record_number`]) fields[`${p}_record_number`] = 'NEW'
    if (!fields[`${p}_owner`])         fields[`${p}_owner`]         = userId
    if (!fields[`${p}_created_by`])    fields[`${p}_created_by`]    = userId
    // Auto-derive contact_name when only first/last were typed
    if (p === 'contact' && !fields.contact_name && fields.contact_first_name) {
      fields.contact_name = `${fields.contact_first_name} ${fields.contact_last_name || ''}`.trim()
    }
    // Auto-derive account_name from organization_name when present
    if (p === 'account' && !fields.account_name && fields.account_organization_name) {
      fields.account_name = fields.account_organization_name
    }
    return fields
  }
  // Short-prefix special cases
  if (tableName === 'incentive_applications') {
    if (!fields.ia_record_number) fields.ia_record_number = 'NEW'
    if (!fields.ia_owner)         fields.ia_owner         = userId
    if (!fields.ia_created_by)    fields.ia_created_by    = userId
  } else if (tableName === 'project_payment_requests') {
    if (!fields.ppr_record_number) fields.ppr_record_number = 'NEW'
    if (!fields.ppr_owner)         fields.ppr_owner         = userId
    if (!fields.ppr_created_by)    fields.ppr_created_by    = userId
  } else if (tableName === 'work_step_templates') {
    // wst_record_number is populated by trg_wst_rn (BEFORE INSERT). We set a
    // placeholder here so NOT NULL + findMissingRequired both pass; the trigger
    // overwrites it unconditionally.
    if (!fields.wst_record_number) fields.wst_record_number = 'NEW'
    if (!fields.wst_owner)         fields.wst_owner         = userId
    if (!fields.wst_created_by)    fields.wst_created_by    = userId
  } else if (tableName === 'work_plan_templates') {
    // wpt_record_number is populated by trg_wpt_rn (BEFORE INSERT) — same
    // pattern as WST. The trigger overwrites the placeholder unconditionally.
    if (!fields.wpt_record_number) fields.wpt_record_number = 'NEW'
    if (!fields.wpt_owner)         fields.wpt_owner         = userId
    if (!fields.wpt_created_by)    fields.wpt_created_by    = userId
  } else if (tableName === 'account_contact_relations') {
    if (!fields.acr_record_number) fields.acr_record_number = 'NEW'
    if (!fields.acr_owner)         fields.acr_owner         = userId
    if (!fields.acr_created_by)    fields.acr_created_by    = userId
  } else if (tableName === 'opportunity_contact_roles') {
    // No owner column — a contact role belongs to its parent opportunity.
    // ocr_record_number is populated by trg_ocr_rn (BEFORE INSERT); ocr_name
    // is populated by trg_ocr_name. Pass a placeholder record number so NOT
    // NULL + findMissingRequired both pass; the trigger overwrites it.
    if (!fields.ocr_record_number) fields.ocr_record_number = 'NEW'
    if (!fields.ocr_created_by)    fields.ocr_created_by    = userId
  } else if (tableName === 'contact_skills') {
    if (!fields.cs_record_number) fields.cs_record_number = 'NEW'
    if (!fields.cs_owner)         fields.cs_owner         = userId
    if (!fields.cs_created_by)    fields.cs_created_by    = userId
  } else if (tableName === 'work_type_skill_requirements') {
    if (!fields.wtsr_record_number) fields.wtsr_record_number = 'NEW'
    if (!fields.wtsr_owner)         fields.wtsr_owner         = userId
    if (!fields.wtsr_created_by)    fields.wtsr_created_by    = userId
  } else if (tableName === 'project_report_templates') {
    // prt_record_number populated by trg_prt_rn (BEFORE INSERT, unconditional).
    if (!fields.prt_record_number) fields.prt_record_number = 'NEW'
    if (!fields.prt_owner)         fields.prt_owner         = userId
    if (!fields.prt_created_by)    fields.prt_created_by    = userId
  } else if (tableName === 'project_report_template_record_type_assignments') {
    // PRTRTA has no owner column — assignments belong to their parent PRT.
    if (!fields.prtrta_record_number) fields.prtrta_record_number = 'NEW'
    if (!fields.prtrta_created_by)    fields.prtrta_created_by    = userId
  } else if (tableName === 'project_report_template_sections') {
    // PRTS has no owner column — sections belong to their parent PRT.
    if (!fields.prts_record_number) fields.prts_record_number = 'NEW'
    if (!fields.prts_created_by)    fields.prts_created_by    = userId
  } else if (tableName === 'email_templates') {
    // Bare-column table — record_number uses et_ short prefix per the
    // BEFORE INSERT trigger (trg_et_rn). Owner / created_by are the bare
    // columns owner_id / created_by because the table predates the
    // prefixed-column convention.
    if (!fields.et_record_number) fields.et_record_number = 'NEW'
    if (!fields.owner_id)         fields.owner_id         = userId
    if (!fields.created_by)       fields.created_by       = userId
  } else if (tableName === 'document_templates') {
    // Same shape as email_templates but with dt_ short prefix on record_number.
    if (!fields.dt_record_number) fields.dt_record_number = 'NEW'
    if (!fields.owner_id)         fields.owner_id         = userId
    if (!fields.created_by)       fields.created_by       = userId
  } else if (tableName === 'envelopes') {
    // env_record_number is populated by the BEFORE INSERT auto-numbering trigger.
    // env_status has a column DEFAULT pointing at the Draft picklist UUID, so we
    // intentionally do NOT pre-fill it here — Postgres handles it. The Draft
    // default also makes env_status excluded from required_fields metadata.
    if (!fields.env_record_number) fields.env_record_number = 'NEW'
    if (!fields.env_owner)         fields.env_owner         = userId
    if (!fields.created_by)        fields.created_by        = userId
  } else if (tableName === 'envelope_recipients') {
    if (!fields.recipient_record_number) fields.recipient_record_number = 'NEW'
    if (!fields.created_by)              fields.created_by              = userId
  } else if (tableName === 'envelope_tabs') {
    if (!fields.tab_record_number) fields.tab_record_number = 'NEW'
    if (!fields.created_by)        fields.created_by        = userId
  } else if (tableName === 'envelope_events') {
    if (!fields.event_record_number) fields.event_record_number = 'NEW'
    if (!fields.created_by)          fields.created_by          = userId
  }
  return fields
}

/**
 * Fetch lookup options for a FK field — id + display name from the
 * referenced table. Used for <select> dropdowns on lookup fields.
 *
 * Soft-deleted rows are excluded automatically when the target table has
 * a discoverable `*_is_deleted` column (via ees_table_metadata). We do
 * NOT filter by `*_is_active` — keeping inactive rows in the option list
 * means an existing record whose lookup currently points at an inactive
 * target still shows the right value in edit mode rather than appearing
 * blank.
 */
export async function fetchLookupOptions(lookupTable, lookupField, limit = 50, opts = {}) {
  // Discover the soft-delete column for the target table — cached for the
  // session by fetchTableMetadata, so this is essentially free on repeat
  // calls. Failure is non-fatal: we just don't filter.
  let isDeletedCol = null
  try {
    const meta = await fetchTableMetadata(lookupTable)
    isDeletedCol = meta?.is_deleted_column || null
  } catch { /* metadata RPC unavailable for this table — proceed unfiltered */ }

  const { search = null, includeId = null } = opts

  let query = supabase
    .from(lookupTable)
    .select(`id, ${lookupField}`)
    .order(lookupField, { ascending: true })
    .limit(limit)

  if (isDeletedCol) query = query.eq(isDeletedCol, false)
  // Server-side search: filter by the label column so the dropdown queries the
  // full table as the user types, instead of filtering a 50-row client slice.
  // Without this, a lookup against a large table (e.g. ~2,000 accounts) can
  // only ever surface the alphabetically-first `limit` rows.
  if (search && String(search).trim()) {
    query = query.ilike(lookupField, `%${String(search).trim()}%`)
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []).map(r => ({
    value: r.id,
    label: r[lookupField] || r.id.slice(0, 8),
  }))

  // Ensure the currently-selected value is always present in the option set,
  // even when it sorts past `limit` or doesn't match the active search. Without
  // this, a prefilled or previously-saved lookup (e.g. an account carried over
  // by advance-to-opportunity) renders blank because its row isn't in the page.
  if (includeId && !rows.some(r => String(r.value) === String(includeId))) {
    try {
      const { data: one } = await supabase
        .from(lookupTable)
        .select(`id, ${lookupField}`)
        .eq('id', includeId)
        .maybeSingle()
      if (one) rows.unshift({ value: one.id, label: one[lookupField] || one.id.slice(0, 8) })
    } catch { /* selected row not fetchable — leave as-is */ }
  }

  return rows
}

/**
 * Fetch lookup options for a dependent dropdown — options narrowed by the
 * current record's other field values. Each `kind` is a named query pattern
 * implemented as a Postgres RPC; the field config supplies `kind` plus the
 * names of the host-record fields whose values feed the filter.
 *
 * Spec on a field_group field:
 *
 *   {
 *     "name": "property_primary_contact_id",
 *     "type": "lookup",
 *     "lookup_table": "contacts",     // fallback for the unscoped path
 *     "lookup_field": "contact_name", // fallback for the unscoped path
 *     "lookup_dependency": {
 *       "kind": "contacts_for_accounts",
 *       "depends_on": ["property_account_id", "property_managing_account_id"]
 *     }
 *   }
 *
 * On entering edit mode the caller passes the current draft (or the loaded
 * record on first read). On dependency-field change the caller re-invokes
 * with the updated draft to refresh the options.
 *
 * Returns the same `{value, label}[]` shape as fetchLookupOptions. If the
 * dependency yields no input values (e.g. neither parent field is filled
 * yet on a new record) we return an empty list — the UI surfaces a hint
 * telling the user to fill the parent field first.
 *
 * Extending: add a new `kind` here when adding a new dependent-lookup RPC.
 * Keep the contract: pure read, returns rows of `{id, <displayField>}`,
 * SECURITY INVOKER so RLS still applies to the caller.
 */
export async function fetchDependentLookupOptions(field, record) {
  const dep = field.lookup_dependency
  if (!dep || !dep.kind) {
    throw new Error('fetchDependentLookupOptions called without lookup_dependency')
  }
  const dependsOn = Array.isArray(dep.depends_on) ? dep.depends_on : []
  const dependencyValues = dependsOn
    .map(fieldName => record?.[fieldName])
    .filter(v => v !== null && v !== undefined && v !== '')

  // The current FK value on the field itself — passed to the RPC as a
  // backward-compat escape hatch so saved values that don't match the
  // filter still render in the dropdown rather than appearing blank.
  const currentValue = record?.[field.name] ?? null

  switch (dep.kind) {
    case 'contacts_for_accounts': {
      if (dependencyValues.length === 0) {
        return []
      }
      const { data, error } = await supabase.rpc('list_contacts_for_accounts', {
        p_account_ids: dependencyValues,
        p_include_contact_id: currentValue,
      })
      if (error) throw error
      return (data || []).map(r => ({
        value: r.id,
        label: r.contact_name || r.id.slice(0, 8),
      }))
    }
    case 'signer_contacts_for_opportunity': {
      if (dependencyValues.length === 0) {
        return []
      }
      const { data, error } = await supabase.rpc('list_signer_contacts_for_opportunity', {
        p_opportunity_id: dependencyValues[0],
        p_include_contact_id: currentValue,
      })
      if (error) throw error
      return (data || []).map(r => ({
        value: r.id,
        label: r.contact_name || r.id.slice(0, 8),
      }))
    }
    case 'contacts_for_opportunity': {
      if (dependencyValues.length === 0) {
        return []
      }
      const { data, error } = await supabase.rpc('list_contacts_for_opportunity', {
        p_opportunity_id: dependencyValues[0],
        p_include_contact_id: currentValue,
      })
      if (error) throw error
      return (data || []).map(r => ({
        value: r.id,
        label: r.contact_name || r.id.slice(0, 8),
      }))
    }
    case 'buildings_for_property': {
      if (dependencyValues.length === 0) {
        return []
      }
      const { data, error } = await supabase.rpc('list_buildings_for_property', {
        p_property_ids: dependencyValues,
        p_include_building_id: currentValue,
      })
      if (error) throw error
      return (data || []).map(r => ({
        value: r.id,
        label: r.building_name || r.id.slice(0, 8),
      }))
    }
    default:
      throw new Error(`Unknown lookup_dependency kind: ${dep.kind}`)
  }
}

/**
 * Fetch table metadata (required fields, soft-delete column, is-active column)
 * via the ees_table_metadata(text) Postgres RPC. Results are cached in-memory
 * for the life of the page load since the schema doesn't change at runtime.
 *
 * Returns { required_fields: string[], is_active_column: string|null,
 *           is_deleted_column: string|null }
 */
const _metadataCache = new Map()
export async function fetchTableMetadata(tableName) {
  if (_metadataCache.has(tableName)) return _metadataCache.get(tableName)
  const { data, error } = await supabase.rpc('ees_table_metadata', { p_table: tableName })
  if (error) throw error
  const meta = data || { required_fields: [], is_active_column: null, is_deleted_column: null }
  // Normalise — the RPC may return nulls for the array fields
  const normalised = {
    required_fields:    meta.required_fields    || [],
    is_active_column:   meta.is_active_column   || null,
    is_deleted_column:  meta.is_deleted_column  || null,
  }
  _metadataCache.set(tableName, normalised)
  return normalised
}

/**
 * Soft-delete a record. Uses the metadata RPC to discover the correct
 * `*_is_deleted` column for the table, then flips it to true. Never performs
 * a hard DELETE — deleted records remain in the database until an admin
 * purges them from the recycle bin.
 */
export async function deleteRecord(tableName, recordId) {
  const meta = await fetchTableMetadata(tableName)
  if (!meta.is_deleted_column) {
    throw new Error(`No soft-delete column configured for "${tableName}"`)
  }
  const { error } = await supabase
    .from(tableName)
    .update({ [meta.is_deleted_column]: true })
    .eq('id', recordId)
  if (error) throw error
  // Same reasoning as saveRecord: a delete affects list views all over
  // the app — invalidate everything so the next render is correct.
  invalidateAll()
  return { deleted: true, column: meta.is_deleted_column }
}

// ---------------------------------------------------------------------------
// Editable related-list helpers — drag-to-reorder and add-from-pool picker
// over junction tables (e.g. work_plan_template_entries).
//
// A junction row carries at minimum:
//   • a parent FK       (widget_config.fk)
//   • a source FK       (widget_config.picker.source_id_col)
//   • an order field    (widget_config.order_field)
//   • a soft-delete col (widget_config.is_deleted_col)
//   • a <prefix>_record_number column auto-assigned by a BEFORE INSERT
//     trigger — the Energy Efficiency Services convention is to pass '' so the trigger fires.
//
// The order field's prefix (e.g. "wpte" from "wpte_execution_order") is
// reused to discover sibling columns (<prefix>_name, <prefix>_created_by).
// ---------------------------------------------------------------------------

/**
 * Extract the snake_case prefix from a column name like "wpte_execution_order"
 * — everything before the first underscore. Returns "" for null/undefined
 * and the whole name if there is no underscore.
 */
function _derivePrefix(fieldName) {
  if (!fieldName) return ''
  const i = fieldName.indexOf('_')
  return i === -1 ? fieldName : fieldName.slice(0, i)
}

/**
 * Check whether a table has a given column. Issues a zero-row SELECT and
 * treats an error as "column does not exist". Cached per-session.
 */
const _columnCache = new Map()
async function _tableHasColumn(tableName, columnName) {
  const key = `${tableName}.${columnName}`
  if (_columnCache.has(key)) return _columnCache.get(key)
  const { error } = await supabase.from(tableName).select(columnName).limit(0)
  const exists = !error
  _columnCache.set(key, exists)
  return exists
}

/**
 * Interpolate a junction row name from a picker template. Supported tokens:
 *   {order}        → execution order as a bare integer
 *   {order:0Nd}    → zero-padded to N digits (e.g. {order:02d} → "07")
 *   {source_label} → the source record's human-readable label
 *
 * When the template is empty, falls back to the source label.
 */
export function interpolateNameTemplate(template, { order, sourceLabel } = {}) {
  if (!template) return sourceLabel || ''
  return String(template)
    .replace(/\{order(?::0(\d+)d)?\}/g, (_m, width) => {
      const n = Number(order ?? 0)
      return width ? String(n).padStart(Number(width), '0') : String(n)
    })
    .replace(/\{source_label\}/g, sourceLabel || '')
}

/**
 * Reorder a junction table by rewriting each row's order field to its
 * 1-based index in `orderedIds`.
 *
 * Routes through the `reorder_junction_rows` RPC so the whole reorder lands
 * in one atomic Postgres transaction. A prior loop-update implementation
 * broke on any table with a UNIQUE (parent_fk, order_field) constraint —
 * mid-loop two rows briefly shared the same order and raised 23505. The RPC
 * two-phases through negative staging indexes inside a single function so
 * the unique constraint stays satisfied end-to-end.
 *
 * The server-side function whitelists which (table, field) pairs are
 * callable. Adding a new reorderable junction requires extending that
 * whitelist in a migration.
 */
export async function reorderJunctionRows(config, orderedIds) {
  const { table, order_field: orderField } = config || {}
  if (!table || !orderField) {
    throw new Error('reorderJunctionRows: widget_config.order_field is required')
  }
  if (!orderedIds || orderedIds.length === 0) {
    return { reordered: 0 }
  }
  const { data, error } = await supabase.rpc('reorder_junction_rows', {
    p_table: table,
    p_order_field: orderField,
    p_ids: orderedIds,
  })
  if (error) throw error
  return { reordered: typeof data === 'number' ? data : orderedIds.length }
}

/**
 * Fetch the source records that can still be added to this junction — not
 * already linked to the parent and (when configured) not soft-deleted and
 * currently active. Linked rows are filtered client-side to avoid
 * PostgREST URL length limits on large `.not('id','in', …)` lists.
 *
 * Returns [{ id, label }] ordered by label.
 */
export async function fetchPickerCandidates(config, parentRecordId) {
  const {
    fk, table: junctionTable, is_deleted_col: junctionDeletedCol, picker,
  } = config || {}
  if (!picker?.source_table || !picker?.source_id_col || !picker?.source_label_field) {
    throw new Error('fetchPickerCandidates: widget_config.picker is not configured')
  }

  // 1. Source IDs already linked (not soft-deleted).
  let linkedQuery = supabase
    .from(junctionTable)
    .select(picker.source_id_col)
    .eq(fk, parentRecordId)
  if (junctionDeletedCol) linkedQuery = linkedQuery.eq(junctionDeletedCol, false)
  const { data: linked, error: linkedErr } = await linkedQuery
  if (linkedErr) throw linkedErr
  const linkedIds = new Set(
    (linked || []).map(r => r[picker.source_id_col]).filter(Boolean)
  )

  // 2. Candidate pool from the source table.
  let candQuery = supabase
    .from(picker.source_table)
    .select(`id, ${picker.source_label_field}`)
    .order(picker.source_label_field, { ascending: true })
    .limit(500)
  if (picker.source_deleted_col) candQuery = candQuery.eq(picker.source_deleted_col, false)
  if (picker.source_active_col)  candQuery = candQuery.eq(picker.source_active_col, true)
  const { data: candidates, error: candErr } = await candQuery
  if (candErr) throw candErr

  return (candidates || [])
    .filter(r => !linkedIds.has(r.id))
    .map(r => ({
      id: r.id,
      label: r[picker.source_label_field] || r.id.slice(0, 8),
    }))
}

/**
 * Insert a new junction row linking `sourceRecordId` to `parentRecordId`.
 * Auto-assigns the next execution order (max+1), applies the name template
 * if one is configured, and stamps <prefix>_created_by when that column
 * exists. The <prefix>_record_number column is set to '' so the BEFORE
 * INSERT trigger can populate it.
 */
export async function addJunctionRow(config, parentRecordId, sourceRecordId, sourceLabel) {
  const {
    fk, table: junctionTable, is_deleted_col: junctionDeletedCol,
    order_field: orderField, picker,
  } = config || {}
  if (!junctionTable || !fk || !orderField || !picker?.source_id_col) {
    throw new Error('addJunctionRow: widget_config is missing required keys')
  }

  // 1. Next execution order = max(existing non-deleted) + 1.
  let maxQuery = supabase
    .from(junctionTable)
    .select(orderField)
    .eq(fk, parentRecordId)
    .order(orderField, { ascending: false })
    .limit(1)
  if (junctionDeletedCol) maxQuery = maxQuery.eq(junctionDeletedCol, false)
  const { data: maxRows, error: maxErr } = await maxQuery
  if (maxErr) throw maxErr
  const nextOrder = Number(maxRows?.[0]?.[orderField] || 0) + 1

  // 2. Compose the insert payload. Prefix like "wpte" drives sibling cols.
  const prefix = _derivePrefix(orderField)
  const payload = {
    [fk]: parentRecordId,
    [picker.source_id_col]: sourceRecordId,
    [orderField]: nextOrder,
  }

  // Trigger-assigned record number — Energy Efficiency Services convention: pass ''.
  const recordNumberCol = `${prefix}_record_number`
  if (await _tableHasColumn(junctionTable, recordNumberCol)) {
    payload[recordNumberCol] = ''
  }

  // Name — interpolate template, fall back to source label.
  if (picker.name_field) {
    payload[picker.name_field] = interpolateNameTemplate(picker.name_template, {
      order: nextOrder,
      sourceLabel,
    }) || sourceLabel || ''
  }

  // Stamp <prefix>_created_by when present (non-fatal if user lookup fails).
  const createdByCol = `${prefix}_created_by`
  if (await _tableHasColumn(junctionTable, createdByCol)) {
    try { payload[createdByCol] = await getCurrentUserId() } catch { /* optional */ }
  }

  const { data, error } = await supabase
    .from(junctionTable)
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Soft-delete a junction row. Piggybacks on deleteRecord() which discovers
 * the correct is_deleted column via fetchTableMetadata.
 */
export async function removeJunctionRow(config, junctionRowId) {
  if (!config?.table) throw new Error('removeJunctionRow: widget_config.table is required')
  return deleteRecord(config.table, junctionRowId)
}
