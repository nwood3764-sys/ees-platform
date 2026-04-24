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
export async function fetchPageLayout(objectName, recordTypeValue = null) {
  // Resolution order:
  //   1. If recordTypeValue is provided AND a layout exists with record_type_id
  //      matching that picklist row → return it.
  //   2. Otherwise return the master layout (record_type_id IS NULL).
  //   3. If neither exists → return null (caller falls back to raw field render).
  //
  // We issue one query that pulls both the record-type-specific layout and
  // the master at once, then pick the preferred one in JS. One round trip.

  // Step 1 — resolve the record_type_id if a value was supplied.
  let recordTypeId = null
  if (recordTypeValue != null && recordTypeValue !== '') {
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

  // record_type is optional — tables without it yield `undefined`, which
  // fetchPageLayout treats as null (master layout fallback).
  const layoutData = await fetchPageLayout(tableName, record?.record_type ?? null)

  if (!layoutData) {
    return { record, layout: null, sections: [], picklists, lookups: new Map() }
  }

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
