import { supabase } from '../lib/supabase'
import { loadPicklists } from './outreachService'
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

/**
 * Fetch the page layout configuration for a given object.
 * Returns { layout, sections: [{ ...section, widgets: [...] }] }
 */
export async function fetchPageLayout(objectName) {
  // Get the default record_detail layout for this object
  const { data: layouts, error: layoutErr } = await supabase
    .from('page_layouts')
    .select('*')
    .eq('page_layout_object', objectName)
    .eq('page_layout_type', 'record_detail')
    .eq('page_layout_is_default', true)
    .eq('is_deleted', false)
    .limit(1)

  if (layoutErr) throw layoutErr
  if (!layouts || layouts.length === 0) return null

  const layout = layouts[0]

  // Get sections ordered by section_order
  const { data: sections, error: secErr } = await supabase
    .from('page_layout_sections')
    .select('*')
    .eq('page_layout_id', layout.id)
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

  return {
    layout,
    sections: Array.from(sectionMap.values()),
  }
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
 * batch-fetch display values. Returns a Map<uuid, displayValue>.
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

  for (const [, { table, field, ids }] of byTable) {
    const idArr = Array.from(ids)
    const { data } = await supabase
      .from(table)
      .select(`id, ${field}`)
      .in('id', idArr)

    for (const row of data || []) {
      resolved.set(row.id, row[field])
    }
  }

  return resolved
}

/**
 * Fetch related records for a related_list widget.
 */
export async function fetchRelatedRecords(config, parentRecordId) {
  const { table, fk, is_deleted_col, columns, sort_field, sort_dir } = config

  let query = supabase
    .from(table)
    .select('id, ' + columns.map(c => c.name).join(', '))
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
  return data || []
}

// ---------------------------------------------------------------------------
// Layout synthesizer — when an object has no configured page layout, we build
// a minimal one on the fly from the column metadata so the record is still
// editable. Users get a usable Edit/Save experience on every object out of
// the box; configuring a real layout in Object Manager upgrades the display
// (section grouping, custom labels, picklists, related lists) without
// changing any code paths.
// ---------------------------------------------------------------------------

/**
 * Describe an object's columns via the introspection RPC. Cached per-session.
 * Returns the raw RPC rows (column_name, data_type, is_nullable, is_foreign_key,
 * references_table, references_column, ordinal_position, etc.).
 */
const _columnDescCache = new Map()
export async function fetchColumnDescriptions(tableName) {
  if (_columnDescCache.has(tableName)) return _columnDescCache.get(tableName)
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: tableName })
  if (error) throw error
  const rows = data || []
  _columnDescCache.set(tableName, rows)
  return rows
}

/**
 * Humanize a snake_case column name into a display label by stripping the
 * object prefix and title-casing. Mirrors the same humanizer in RecordDetail
 * — duplicated here so the synthesized layout's labels match what a hand-
 * configured layout would produce.
 */
function _humanizeColumn(col) {
  const prefixes = [
    'contact_', 'property_owner_', 'property_management_company_', 'pmc_',
    'property_', 'opportunity_', 'work_order_', 'work_plan_template_',
    'work_step_template_', 'work_type_', 'project_payment_request_',
    'project_', 'building_', 'unit_', 'assessment_', 'vehicle_',
    'vehicle_activity_', 'va_', 'technician_', 'product_item_', 'product_',
    'equipment_', 'incentive_application_', 'ia_', 'ppr_', 'wpt_', 'wst_',
    'wpte_', 'user_', 'program_', 'partner_org_', 'role_', 'page_layout_',
    'picklist_', 'portal_user_',
  ]
  let name = col
  for (const p of prefixes) { if (name.startsWith(p)) { name = name.slice(p.length); break } }
  if (name.endsWith('_id')) name = name.slice(0, -3)
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || col
}

/**
 * Given a target table's column list, pick the best display column to show in
 * a lookup. Priority: {prefix}_name → {prefix}_display_name → name/title →
 * {prefix}_record_number → id. Returns the column name, or 'id' as a last
 * resort so something (at least the truncated UUID) always renders.
 */
function _pickDisplayColumn(targetTable, targetColumns) {
  const names = new Set(targetColumns.map(c => c.column_name))
  // 1. Unprefixed canonical names (programs.name, etc.) beat prefixed variants.
  for (const c of ['name', 'title', 'display_name', 'label']) if (names.has(c)) return c
  // 2. Prefixed name columns (property_name, pmc_name). Shortest wins so the
  //    canonical "property_name" beats variants like "property_aka_name".
  const prefixNameCols = targetColumns
    .filter(c => c.column_name.endsWith('_name')
               && !c.column_name.endsWith('_first_name')
               && !c.column_name.endsWith('_last_name'))
    .map(c => c.column_name)
    .sort((a, b) => a.length - b.length)
  if (prefixNameCols.length) return prefixNameCols[0]
  // 3. Record number as a last-resort identifier.
  for (const c of targetColumns) if (c.column_name.endsWith('_record_number')) return c.column_name
  return 'id'
}

/**
 * Build a synthetic { layout, sections } for a table that has no configured
 * page layout. The returned object has the same shape as fetchPageLayout
 * so the downstream render/edit code doesn't need a separate path.
 *
 * Async because it introspects each FK target table to pick a readable
 * display column for lookups. FK introspections are parallelized.
 */
export async function synthesizeLayoutFromColumns(tableName) {
  const columns = await fetchColumnDescriptions(tableName)

  const visible = columns.filter(c => {
    const n = c.column_name
    if (n === 'id') return false
    if (n === 'is_deleted' || n.endsWith('_is_deleted')) return false
    if (c.data_type === 'ARRAY' || c.data_type === 'jsonb' || c.data_type === 'json') return false
    // created_by / updated_by are audit fields set by triggers or the save
    // path — rendering them as editable lookups would be misleading. Owner
    // fields stay (ownership transfer is a legitimate user action).
    if (n === 'created_by' || n === 'updated_by') return false
    if (n.endsWith('_created_by') || n.endsWith('_updated_by')) return false
    return true
  })

  // Resolve display columns for every distinct FK target in parallel.
  const fkTargets = [...new Set(
    visible
      .filter(c => c.is_foreign_key && c.data_type === 'uuid' && c.references_table)
      .map(c => c.references_table)
  )]
  const displayColByTable = new Map()
  await Promise.all(fkTargets.map(async (t) => {
    try {
      const targetCols = await fetchColumnDescriptions(t)
      displayColByTable.set(t, _pickDisplayColumn(t, targetCols))
    } catch {
      displayColByTable.set(t, 'id')
    }
  }))

  // Split business fields from audit/system fields so system fields sink to
  // the bottom of the form. Matches the Salesforce convention.
  const business = []
  const system = []
  for (const c of visible) {
    const n = c.column_name
    const isSystem =
      n === 'owner_id' ||
      n === 'created_by' || n === 'created_at' ||
      n === 'updated_by' || n === 'updated_at' ||
      n.endsWith('_owner') ||
      n.endsWith('_owner_id') ||
      n.endsWith('_created_by') || n.endsWith('_created_at') ||
      n.endsWith('_updated_by') || n.endsWith('_updated_at')
    if (isSystem) system.push(c); else business.push(c)
  }
  const byOrdinal = (a, b) => (a.ordinal_position || 0) - (b.ordinal_position || 0)
  business.sort(byOrdinal)
  system.sort(byOrdinal)

  const toField = (c) => {
    const field = { name: c.column_name, label: _humanizeColumn(c.column_name) }

    if (c.is_foreign_key && c.data_type === 'uuid' && c.references_table) {
      field.type = 'lookup'
      field.lookup_table = c.references_table
      field.lookup_field = displayColByTable.get(c.references_table) || 'id'
    } else if (c.data_type === 'date') {
      field.type = 'date'
    } else if (c.data_type === 'timestamp with time zone' || c.data_type === 'timestamp without time zone') {
      field.type = 'datetime'
    } else if (c.data_type === 'boolean') {
      field.type = 'boolean'
    } else if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(c.data_type)) {
      field.type = 'number'
    } else if (
      /(_notes|_description|_content|_message|_body|_instructions|_guidance)$/.test(c.column_name) ||
      ['notes', 'description', 'comments', 'instructions', 'guidance'].includes(c.column_name)
    ) {
      field.type = 'textarea'
    } else {
      field.type = 'text'
    }
    return field
  }

  const businessFields = business.map(toField)
  const systemFields = system.map(toField)

  const sections = [{
    id: `__synth_section_${tableName}_details`,
    section_name: 'Record',
    section_tab: 'Details',
    section_order: 1,
    widgets: [{
      id: `__synth_widget_${tableName}_details`,
      widget_type: 'field_group',
      widget_name: 'Details',
      widget_order: 1,
      widget_config: { title: 'Details', fields: businessFields },
    }],
  }]

  if (systemFields.length) {
    sections.push({
      id: `__synth_section_${tableName}_system`,
      section_name: 'System Information',
      section_tab: 'Details',
      section_order: 2,
      widgets: [{
        id: `__synth_widget_${tableName}_system`,
        widget_type: 'field_group',
        widget_name: 'System Information',
        widget_order: 1,
        widget_config: { title: 'System Information', fields: systemFields },
      }],
    })
  }

  return {
    layout: {
      id: `__synth_layout_${tableName}`,
      page_layout_name: 'Auto-generated Layout',
      page_layout_object: tableName,
      synthesized: true,
    },
    sections,
  }
}

/**
 * Master function: load everything needed to render a record detail page.
 * Returns { record, layout, sections, picklists, lookups }
 *
 * If the object has no configured page layout, a synthetic one is built from
 * the column metadata so the record is still editable. The returned layout
 * carries a `synthesized: true` flag so the UI can show a "configure layout"
 * hint.
 */
export async function loadRecordDetailData(tableName, recordId) {
  // Parallel fetch: record, layout, picklists
  const [record, realLayout, picklists] = await Promise.all([
    fetchRecord(tableName, recordId),
    fetchPageLayout(tableName),
    loadPicklists(),
  ])

  // Fall back to a synthesized layout when no real one is configured.
  const layoutData = realLayout || await synthesizeLayoutFromColumns(tableName)

  // Collect lookup requests from all field_group widgets
  const lookupRequests = []
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
          }
        }
      }
    }
  }

  const lookups = await resolveLookups(lookupRequests)

  // Pre-fetch related list data
  for (const sec of layoutData.sections) {
    for (const w of sec.widgets) {
      if (w.widget_type === 'related_list' && w.widget_config) {
        w._relatedData = await fetchRelatedRecords(w.widget_config, recordId)
      }
    }
  }

  return {
    record,
    layout: layoutData.layout,
    sections: layoutData.sections,
    picklists,
    lookups,
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
  return data
}

/**
 * Fetch picklist options for a given object + field.
 * Used to populate <select> dropdowns in edit mode.
 */
export async function fetchPicklistOptions(objectName, fieldName) {
  const { data, error } = await supabase
    .from('picklist_values')
    .select('id, picklist_value, picklist_label')
    .eq('picklist_object', objectName)
    .eq('picklist_field', fieldName)
    .eq('picklist_is_active', true)
    .order('picklist_sort_order', { ascending: true })

  if (error) throw error
  return (data || []).map(r => ({
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
  return data
}

/**
 * Apply the standard Anura insert-time defaults to a draft record. Fills in
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
  const prefixes = [
    'contact', 'property', 'opportunity', 'work_order', 'project', 'building',
    'unit', 'assessment', 'vehicle', 'technician', 'product', 'equipment',
  ]
  for (const p of prefixes) {
    if (tableName.startsWith(p) || tableName === p + 's' || tableName === p + 'ies') {
      if (!fields[`${p}_record_number`]) fields[`${p}_record_number`] = 'NEW'
      if (!fields[`${p}_owner`])         fields[`${p}_owner`]         = userId
      if (!fields[`${p}_created_by`])    fields[`${p}_created_by`]    = userId
      // Auto-derive contact_name when only first/last were typed
      if (p === 'contact' && !fields.contact_name && fields.contact_first_name) {
        fields.contact_name = `${fields.contact_first_name} ${fields.contact_last_name || ''}`.trim()
      }
      return fields
    }
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
  } else if (tableName === 'partner_organizations') {
    if (!fields.owner_id)    fields.owner_id    = userId
    if (!fields.created_by)  fields.created_by  = userId
    if (!fields.record_type) fields.record_type = 'Partner Organization'
  }
  return fields
}

/**
 * Fetch lookup options for a FK field — id + display name from the
 * referenced table. Used for <select> dropdowns on lookup fields.
 *
 * Soft-deleted rows are excluded automatically when the target table has
 * a discoverable `*_is_deleted` column (via anura_table_metadata). We do
 * NOT filter by `*_is_active` — keeping inactive rows in the option list
 * means an existing record whose lookup currently points at an inactive
 * target still shows the right value in edit mode rather than appearing
 * blank.
 */
export async function fetchLookupOptions(lookupTable, lookupField, limit = 50) {
  // Discover the soft-delete column for the target table — cached for the
  // session by fetchTableMetadata, so this is essentially free on repeat
  // calls. Failure is non-fatal: we just don't filter.
  let isDeletedCol = null
  try {
    const meta = await fetchTableMetadata(lookupTable)
    isDeletedCol = meta?.is_deleted_column || null
  } catch { /* metadata RPC unavailable for this table — proceed unfiltered */ }

  let query = supabase
    .from(lookupTable)
    .select(`id, ${lookupField}`)
    .limit(limit)

  if (isDeletedCol) query = query.eq(isDeletedCol, false)

  const { data, error } = await query

  if (error) throw error
  return (data || []).map(r => ({
    value: r.id,
    label: r[lookupField] || r.id.slice(0, 8),
  }))
}

/**
 * Fetch table metadata (required fields, soft-delete column, is-active column)
 * via the anura_table_metadata(text) Postgres RPC. Results are cached in-memory
 * for the life of the page load since the schema doesn't change at runtime.
 *
 * Returns { required_fields: string[], is_active_column: string|null,
 *           is_deleted_column: string|null }
 */
const _metadataCache = new Map()
export async function fetchTableMetadata(tableName) {
  if (_metadataCache.has(tableName)) return _metadataCache.get(tableName)
  const { data, error } = await supabase.rpc('anura_table_metadata', { p_table: tableName })
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
//     trigger — the Anura convention is to pass '' so the trigger fires.
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

  // Trigger-assigned record number — Anura convention: pass ''.
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
