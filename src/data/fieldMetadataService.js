import { supabase, fetchAllPaged } from '../lib/supabase'

// =====================================================================
// fieldMetadataService
//
// One job: for a given LEAP table, return the per-column metadata the
// EditableListView needs to render the right editor (text input, number
// input, date picker, picklist dropdown, lookup picker, boolean
// checkbox) and to validate edits before sending them to the
// bulk_update_records RPC.
//
// Per-table metadata is cached for the page session — column shapes
// don't change at runtime. Picklist option lookups are deferred to the
// shared loadPicklists() cache.
//
// Field eligibility rules (mirror the RPC's allowlist):
//   - skip primary key, foreign keys to users for audit, all created_*,
//     updated_*, deleted_*, *_record_number columns
//   - skip *_is_deleted, *_deletion_reason
//   - everything else is user-editable
//
// Editor type derivation:
//   uuid + references picklist_values  → 'picklist'
//   uuid + references any other table  → 'lookup'
//   boolean                            → 'boolean'
//   integer / bigint / numeric         → 'number'
//   date                               → 'date'
//   timestamp with/without time zone   → 'datetime'
//   text / varchar / character...      → 'text'
//   anything else                      → 'text' (fall-through)
// =====================================================================

const _columnsCache = new Map()    // tableName → Promise<FieldMeta[]>
const _picklistOptionsCache = new Map() // `${object}.${field}` → Promise<Option[]>

const SYSTEM_COLUMN_PATTERNS = [
  /^id$/,
  /_record_number$/,
  /_created_at$/,    /_created_by$/,
  /_updated_at$/,    /_updated_by$/,
  /_deleted_at$/,    /_deleted_by$/,
  /_is_deleted$/,    /_deletion_reason$/,
]
const SYSTEM_COLUMN_LITERALS = new Set([
  'created_at','created_by','updated_at','updated_by',
  'deleted_at','deleted_by','is_deleted','deletion_reason',
])

function isSystemManaged(columnName) {
  if (SYSTEM_COLUMN_LITERALS.has(columnName)) return true
  return SYSTEM_COLUMN_PATTERNS.some(p => p.test(columnName))
}

function deriveEditorType({ data_type, is_foreign_key, references_table }) {
  if (is_foreign_key && references_table === 'picklist_values') return 'picklist'
  if (is_foreign_key) return 'lookup'
  if (data_type === 'boolean') return 'boolean'
  if (data_type === 'integer' || data_type === 'bigint' || data_type === 'smallint') return 'number'
  if (data_type === 'numeric' || data_type === 'double precision' || data_type === 'real') return 'number'
  if (data_type === 'date') return 'date'
  if (data_type === 'timestamp with time zone' || data_type === 'timestamp without time zone') return 'datetime'
  return 'text'
}

/**
 * Returns the full ordered column metadata for a LEAP table, with each
 * column annotated as user-editable or system-managed.
 *
 * Shape: [{ columnName, dataType, isNullable, isEditable, editorType,
 *           picklistObject?, picklistField?, referencesTable? }]
 */
export function getEditableFieldsForTable(tableName) {
  if (_columnsCache.has(tableName)) return _columnsCache.get(tableName)

  const promise = (async () => {
    const { data, error } = await supabase.rpc('describe_object_columns', { p_table: tableName })
    if (error) throw error
    return (data || []).map(c => {
      const isEditable = !isSystemManaged(c.column_name)
      const editorType = deriveEditorType(c)
      const meta = {
        columnName:      c.column_name,
        dataType:        c.data_type,
        isNullable:      c.is_nullable === 'YES',
        isPrimaryKey:    c.is_primary_key,
        isForeignKey:    c.is_foreign_key,
        referencesTable: c.references_table,
        isEditable,
        editorType,
      }
      // For picklist columns, derive the (picklist_object, picklist_field)
      // pair the values live under. Convention: the column is named
      // <prefix>_<field>, e.g. property_status → object='properties',
      // field='status'. The table name itself is the object.
      if (editorType === 'picklist') {
        // Strip the table-derived prefix from the column name; what's
        // left is the picklist field. Picklist objects are the singular
        // table name with no s? — actually our picklist_values rows use
        // the plural table name directly (verified against the existing
        // picklist seed data). Use the bare table name as the object.
        const prefix = guessPrefix(tableName)
        const field  = prefix && c.column_name.startsWith(prefix + '_')
          ? c.column_name.slice(prefix.length + 1)
          : c.column_name
        meta.picklistObject = tableName
        meta.picklistField  = field
      }
      return meta
    })
  })()

  _columnsCache.set(tableName, promise)
  return promise
}

/**
 * Returns the active picklist options for a given (object, field) pair.
 * Used by the picklist editor to populate the dropdown.
 *
 * Shape: [{ id, label, value, sortOrder }]
 */
export function getPicklistOptions(object, field) {
  const key = `${object}.${field}`
  if (_picklistOptionsCache.has(key)) return _picklistOptionsCache.get(key)

  const promise = (async () => {
    // Status/lifecycle fields keep their workflow sort_order; every other
    // picklist is a choice list and sorts alphabetically by label.
    const isLifecycle = field === 'status' || /_status$/.test(field) || field === 'stage' || /_stage$/.test(field)
    const data = await fetchAllPaged((from, to) => {
      let q = supabase
        .from('picklist_values')
        .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
        .eq('picklist_object', object)
        .eq('picklist_field',  field)
        .eq('picklist_is_active', true)
      if (isLifecycle) {
        q = q.order('picklist_sort_order', { ascending: true }).order('id', { ascending: true })
      } else {
        q = q.order('picklist_label', { ascending: true }).order('id', { ascending: true })
      }
      return q.range(from, to)
    })
    return data.map(r => ({
      id:        r.id,
      label:     r.picklist_label || r.picklist_value,
      value:     r.picklist_value,
      sortOrder: r.picklist_sort_order || 0,
    }))
  })()

  _picklistOptionsCache.set(key, promise)
  return promise
}

/**
 * Lookup picker: returns up to `limit` records from a lookup table
 * matching a substring query against the table's natural-name column.
 * Used by EditableCell when editing a foreign-key column.
 *
 * `nameColumn` is auto-derived from the table name (e.g. accounts →
 * account_name). Override via the third arg if a table uses a
 * different display column.
 */
export async function searchLookupOptions(tableName, query, { nameColumn = null, limit = 20 } = {}) {
  const col = nameColumn || guessNameColumn(tableName)
  if (!col) throw new Error(`No natural-name column known for table ${tableName}`)
  let q = supabase
    .from(tableName)
    .select(`id, ${col}`)
    .order(col, { ascending: true })
    .limit(limit)
  if (query && query.trim().length > 0) {
    q = q.ilike(col, `%${query.trim()}%`)
  }
  const { data, error } = await q
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, label: r[col] }))
}

/**
 * Resolve a single lookup id → label (used for displaying the existing
 * value of a foreign-key cell before the user opens the picker).
 */
export async function resolveLookupLabel(tableName, id, { nameColumn = null } = {}) {
  if (!id) return null
  const col = nameColumn || guessNameColumn(tableName)
  if (!col) return id
  const { data, error } = await supabase
    .from(tableName)
    .select(`id, ${col}`)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return id
  return data[col]
}

// ----- helpers -----

// Column-prefix convention used across LEAP tables.
function guessPrefix(tableName) {
  const map = {
    properties: 'property',
    accounts: 'account',
    contacts: 'contact',
    opportunities: 'opportunity',
    opportunity_contact_roles: 'ocr',
    buildings: 'building',
    units: 'unit',
    property_programs: 'pp',
    work_orders: 'work_order',
    service_appointments: 'sa',
    service_appointment_assignments: 'saa',
    service_territory_members: 'stm',
    resource_absences: 'ra',
    projects: 'project',
    project_payment_requests: 'ppr',
    incentive_applications: 'ia',
    assessments: 'assessment',
    equipment_activities: 'ea',
    vehicle_activities: 'va',
    diagnostic_tests: 'dt',
    mechanical_equipment: 'me',
    products: 'product',
    efr_reports: 'efr',
    tasks: 'task',
    documents: 'doc',
    property_source_data: 'psd',
    property_disaster_exposure: 'pde',
    property_import_batches: 'pib',
    service_territory_members: 'stm',
    resource_absences: 'ra',
  }
  return map[tableName] || null
}

// Natural-name display column for each table. Used by the lookup
// picker to render meaningful options instead of UUIDs.
function guessNameColumn(tableName) {
  const map = {
    properties: 'property_name',
    accounts: 'account_name',
    contacts: 'contact_name',
    opportunities: 'opportunity_name',
    buildings: 'building_name',
    units: 'unit_name',
    work_orders: 'work_order_name',
    service_appointments: 'sa_name',
    projects: 'project_name',
    project_payment_requests: 'ppr_name',
    incentive_applications: 'ia_name',
    assessments: 'assessment_name',
    products: 'product_name',
    mechanical_equipment: 'me_name',
    efr_reports: 'efr_name',
    tasks: 'task_name',
    users: 'user_name',
    picklist_values: 'picklist_label',
    service_territories: 'service_territory_name',
  }
  return map[tableName] || null
}

/**
 * One-shot call that returns the bulk_update_records RPC's response.
 * Translates the actor uuid (the current public.users.id) automatically.
 */
export async function bulkUpdateRecords(tableName, recordIds, updates) {
  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    throw new Error('recordIds must be a non-empty array')
  }
  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('updates must contain at least one column')
  }
  // Resolve the caller's public.users.id via the standard RPC.
  const { data: actorId, error: actorErr } = await supabase.rpc('current_app_user_id')
  if (actorErr) throw actorErr
  if (!actorId) throw new Error('Caller is not a registered LEAP user')

  const { data, error } = await supabase.rpc('bulk_update_records', {
    p_table:      tableName,
    p_record_ids: recordIds,
    p_updates:    updates,
    p_actor_id:   actorId,
  })
  if (error) throw error
  return data
}
