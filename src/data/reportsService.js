// Service layer for the Reports module. Reads/writes report folders,
// reports, schedules, and per-report metadata (filters, groupings,
// calculated fields). Folder access is layered on top of the standard
// app_user_can() gating via the app_user_folder_access(folder_id) RPC,
// which returns the highest level (manager > editor > viewer) the
// calling user holds — Admin always returns 'manager'.
//
// All fetchers follow the existing list-pane convention: each row carries
// `id` (display key — record number) and `_id` (the real UUID) for routing
// into RecordDetail.

import { supabase } from '../lib/supabase'

// ─── Folders ──────────────────────────────────────────────────────────────

export async function fetchReportFolders() {
  const { data, error } = await supabase
    .from('report_folders')
    .select(`
      id, rf_record_number, rf_name, rf_description, rf_is_public,
      rf_parent_folder_id, rf_owner_user_id, updated_at,
      owner:users!report_folders_rf_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('rf_name', { ascending: true })

  if (error) throw error

  // Resolve folder access in a batch. The RPC is called per row — small N
  // so the round-trips are cheap. If folder counts ever grow large, switch
  // to a single batch RPC.
  const rows = data || []
  const accessLevels = await Promise.all(
    rows.map(r => supabase.rpc('app_user_folder_access', { p_folder_id: r.id }))
  )

  return rows.map((r, idx) => {
    const accessLevel = accessLevels[idx]?.data || null
    return {
      id:           r.rf_record_number || r.id.slice(0, 8).toUpperCase(),
      _id:          r.id,
      name:         r.rf_name,
      description:  r.rf_description || '—',
      isPublic:     r.rf_is_public ? 'Public' : 'Private',
      parentId:     r.rf_parent_folder_id,
      ownerId:      r.rf_owner_user_id,
      ownerName:    r.owner?.user_name || '—',
      accessLevel:  accessLevel,
      updatedAt:    r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
    }
  }).filter(f => f.accessLevel != null)  // hide folders the user can't access
}

// ─── Reports ──────────────────────────────────────────────────────────────

export async function fetchReports({ folderId = null } = {}) {
  let q = supabase
    .from('reports')
    .select(`
      id, rpt_record_number, rpt_name, rpt_description, rpt_format,
      rpt_primary_object, rpt_folder_id, rpt_owner_user_id,
      rpt_last_run_at, updated_at,
      folder:report_folders(id, rf_name),
      owner:users!reports_rpt_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })

  if (folderId) q = q.eq('rpt_folder_id', folderId)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map(r => ({
    id:            r.rpt_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:           r.id,
    name:          r.rpt_name,
    description:   r.rpt_description || '—',
    format:        r.rpt_format ? r.rpt_format.charAt(0).toUpperCase() + r.rpt_format.slice(1) : '—',
    primaryObject: r.rpt_primary_object || '—',
    folder:        r.folder?.rf_name || '—',
    folderId:      r.rpt_folder_id,
    owner:         r.owner?.user_name || '—',
    ownerId:       r.rpt_owner_user_id,
    lastRun:       r.rpt_last_run_at ? new Date(r.rpt_last_run_at).toLocaleString() : 'Never',
    updatedAt:     r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
  }))
}

// ─── Scheduled reports ────────────────────────────────────────────────────

export async function fetchScheduledReports() {
  const { data, error } = await supabase
    .from('scheduled_reports')
    .select(`
      id, sr_record_number, sr_name, sr_frequency, sr_format,
      sr_send_time, sr_timezone, sr_is_active,
      sr_last_sent_at, sr_next_send_at, sr_owner_user_id,
      report:reports(id, rpt_name),
      owner:users!scheduled_reports_sr_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('sr_next_send_at', { ascending: true, nullsFirst: false })

  if (error) throw error

  return (data || []).map(s => ({
    id:        s.sr_record_number || s.id.slice(0, 8).toUpperCase(),
    _id:       s.id,
    name:      s.sr_name,
    report:    s.report?.rpt_name || '—',
    reportId:  s.report?.id,
    frequency: s.sr_frequency ? s.sr_frequency.charAt(0).toUpperCase() + s.sr_frequency.slice(1) : '—',
    format:    s.sr_format ? s.sr_format.toUpperCase() : '—',
    sendTime:  s.sr_send_time || '—',
    timezone:  s.sr_timezone || '—',
    active:    s.sr_is_active ? 'Active' : 'Paused',
    lastSent:  s.sr_last_sent_at ? new Date(s.sr_last_sent_at).toLocaleString() : 'Never',
    nextSend:  s.sr_next_send_at ? new Date(s.sr_next_send_at).toLocaleString() : '—',
    owner:     s.owner?.user_name || '—',
    ownerId:   s.sr_owner_user_id,
  }))
}

// ─── Field discovery for the Report Builder ───────────────────────────────
// Walks the FK graph from a primary object outward. Returns the columns
// available on the primary object plus the directly-related objects (one
// hop away via outgoing FKs). The Report Builder calls this on initial
// load and again whenever the user expands a related-object node.

const _columnsCache = new Map()
const _fkOutgoingCache = new Map()

async function describeColumns(tableName) {
  if (_columnsCache.has(tableName)) return _columnsCache.get(tableName)
  const { data, error } = await supabase.rpc('describe_object_columns', { p_table: tableName })
  if (error) throw error
  const cols = data || []
  _columnsCache.set(tableName, cols)
  return cols
}

// Outgoing FKs from this table — i.e. columns on this table that are FKs
// pointing at OTHER tables. describe_object_columns returns these via the
// is_foreign_key + references_table fields, so we filter the existing
// column-cache rather than calling another RPC.
async function describeOutgoingFKs(tableName) {
  if (_fkOutgoingCache.has(tableName)) return _fkOutgoingCache.get(tableName)
  const cols = await describeColumns(tableName)
  const fks = cols
    .filter(c => {
      if (!c.is_foreign_key || !c.references_table) return false
      // Exclude audit-user FKs — created_by/updated_by/deleted_by/etc.
      if (c.column_name.endsWith('_by') || c.column_name === 'created_by' || c.column_name === 'updated_by' || c.column_name === 'deleted_by') return false
      // Exclude FKs into picklist_values — these are status/record-type/picklist
      // columns and don't represent traversable related objects.
      if (c.references_table === 'picklist_values') return false
      return true
    })
    .map(c => ({
      column_name:      c.column_name,
      references_table: c.references_table,
      references_column: c.references_column || 'id',
    }))
  _fkOutgoingCache.set(tableName, fks)
  return fks
}

/**
 * Load the initial field tree for a primary object. Returns:
 *   {
 *     primary: { table, columns: [...] },
 *     related: [{ fk_column, table, label }]   // one hop, lazy-loaded
 *   }
 *
 * The Report Builder renders `related` as expandable nodes; expanding
 * one calls loadRelatedObjectFields() to pull that object's columns.
 */
export async function loadFieldTree(primaryObject) {
  if (!primaryObject) return { primary: null, related: [] }
  const [columns, fks] = await Promise.all([
    describeColumns(primaryObject),
    describeOutgoingFKs(primaryObject),
  ])
  return {
    primary: {
      table: primaryObject,
      columns: columns.map(c => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
      })),
    },
    related: fks.map(f => ({
      fk_column: f.column_name,
      table: f.references_table,
      label: humanizeFkLabel(f.column_name, f.references_table),
    })),
  }
}

/**
 * Pull columns for a related object (lazy-loaded when the user expands a
 * related-object node in the field tree). The via_path lets the Builder
 * record where this column came from when adding it to the report.
 */
export async function loadRelatedObjectFields(viaTable, viaPath) {
  const columns = await describeColumns(viaTable)
  return {
    table: viaTable,
    via_path: viaPath,
    columns: columns.map(c => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
    })),
  }
}

function humanizeFkLabel(fkColumn, referencesTable) {
  // 'project_account_id' on projects → 'Account'
  // 'property_id' on work_orders     → 'Property'
  const table = referencesTable || ''
  const singular = table.endsWith('s') ? table.slice(0, -1) : table
  return singular.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ─── List of objects available as a primary report object ─────────────────
// Salesforce calls this the "Object" picker on a new report. We expose every
// business table that has a record-detail concept — same set used by the
// universal search index, basically.

export async function listPrimaryObjectOptions() {
  // Hardcoded curated list for v1 — better than enumerating every table
  // (which would include junction tables, audit tables, system tables, etc.).
  // Expanded via Setup → Objects later.
  return [
    { table: 'accounts',                label: 'Accounts' },
    { table: 'contacts',                label: 'Contacts' },
    { table: 'properties',              label: 'Properties' },
    { table: 'buildings',               label: 'Buildings' },
    { table: 'units',                   label: 'Units' },
    { table: 'opportunities',           label: 'Opportunities' },
    { table: 'projects',                label: 'Projects' },
    { table: 'work_orders',             label: 'Work Orders' },
    { table: 'work_steps',              label: 'Work Steps' },
    { table: 'work_plans',              label: 'Work Plans' },
    { table: 'incentive_applications',  label: 'Incentive Applications' },
    { table: 'incentives',              label: 'Incentives' },
    { table: 'income_qualifications',   label: 'Income Qualifications' },
    { table: 'project_payment_requests',label: 'Project Payment Requests' },
    { table: 'payment_receipts',        label: 'Payment Receipts' },
    { table: 'assessments',             label: 'Assessments' },
    { table: 'efr_reports',             label: 'EFR Reports' },
    { table: 'tasks',                   label: 'Tasks' },
    { table: 'comments',                label: 'Comments' },
    { table: 'activities',              label: 'Activities' },
    { table: 'envelopes',               label: 'Envelopes' },
    { table: 'documents',               label: 'Documents' },
    { table: 'photos',                  label: 'Photos' },
    { table: 'vehicles',                label: 'Vehicles' },
    { table: 'vehicle_activities',      label: 'Vehicle Activities' },
    { table: 'equipment',               label: 'Equipment' },
    { table: 'products',                label: 'Products' },
    { table: 'materials_requests',      label: 'Materials Requests' },
    { table: 'job_kits',                label: 'Job Kits' },
    { table: 'time_sheets',             label: 'Time Sheets' },
    { table: 'time_sheet_entries',      label: 'Time Sheet Entries' },
    { table: 'service_appointments',    label: 'Service Appointments' },
    { table: 'users',                   label: 'Users' },
    { table: 'programs',                label: 'Programs' },
    { table: 'chat_threads',            label: 'Chat Threads' },
  ]
}

// ─── Save / load report definitions ───────────────────────────────────────

export async function loadReport(reportId) {
  if (!reportId || reportId === 'new') return null

  const [reportRes, filtersRes, groupingsRes, calcRes] = await Promise.all([
    supabase.from('reports').select('*').eq('id', reportId).eq('is_deleted', false).single(),
    supabase.from('report_filters').select('*').eq('rfilt_report_id', reportId).eq('is_deleted', false).order('rfilt_filter_index'),
    supabase.from('report_groupings').select('*').eq('rgr_report_id', reportId).eq('is_deleted', false).order('rgr_grouping_level'),
    supabase.from('report_calculated_fields').select('*').eq('rcf_report_id', reportId).eq('is_deleted', false).order('rcf_display_order'),
  ])

  if (reportRes.error) throw reportRes.error
  if (filtersRes.error) throw filtersRes.error
  if (groupingsRes.error) throw groupingsRes.error
  if (calcRes.error) throw calcRes.error

  return {
    report:           reportRes.data,
    filters:          filtersRes.data || [],
    groupings:        groupingsRes.data || [],
    calculatedFields: calcRes.data || [],
  }
}

export async function getCurrentUserId() {
  const { data: authData } = await supabase.auth.getUser()
  if (!authData?.user?.id) return null
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', authData.user.id)
    .single()
  if (error) return null
  return data?.id || null
}

/**
 * Save (insert or update) a report and its child rows. The child tables
 * (filters, groupings, calculated_fields) use a delete-and-reinsert
 * strategy on save — simpler than diffing and matches how Salesforce
 * persists report metadata.
 */
export async function saveReport({ id, report, filters, groupings, calculatedFields }) {
  const isNew = !id || id === 'new'
  const userId = await getCurrentUserId()

  const reportPayload = {
    rpt_name:             report.rpt_name,
    rpt_description:      report.rpt_description || null,
    rpt_folder_id:        report.rpt_folder_id || null,
    rpt_format:           report.rpt_format || 'tabular',
    rpt_primary_object:   report.rpt_primary_object,
    rpt_selected_fields:  report.rpt_selected_fields || [],
    rpt_filter_logic:     report.rpt_filter_logic || 'all',
    rpt_sort_config:      report.rpt_sort_config || [],
    rpt_column_groupings: report.rpt_column_groupings || [],
    rpt_runtime_prompts:  report.rpt_runtime_prompts || [],
    rpt_charts:           report.rpt_charts || [],
    updated_by:           userId,
  }

  let reportId = id
  if (isNew) {
    reportPayload.rpt_record_number = ''  // trigger generates the number
    reportPayload.rpt_owner_user_id  = userId
    reportPayload.created_by         = userId
    const { data, error } = await supabase
      .from('reports')
      .insert(reportPayload)
      .select('id')
      .single()
    if (error) throw error
    reportId = data.id
  } else {
    const { error } = await supabase
      .from('reports')
      .update(reportPayload)
      .eq('id', id)
    if (error) throw error
  }

  // Soft-delete existing children, then re-insert
  if (!isNew) {
    await Promise.all([
      supabase.from('report_filters').update({ is_deleted: true }).eq('rfilt_report_id', reportId),
      supabase.from('report_groupings').update({ is_deleted: true }).eq('rgr_report_id', reportId),
      supabase.from('report_calculated_fields').update({ is_deleted: true }).eq('rcf_report_id', reportId),
    ])
  }

  if (filters?.length) {
    const rows = filters.map((f, idx) => ({
      rfilt_report_id:         reportId,
      rfilt_filter_index:      idx + 1,
      rfilt_field_name:        f.field_name || null,
      rfilt_field_table:       f.field_table || null,
      rfilt_field_via_path:    f.field_via_path || null,
      rfilt_operator:          f.operator,
      rfilt_value:             f.value !== undefined ? f.value : null,
      rfilt_is_cross_filter:   !!f.is_cross_filter,
      rfilt_cross_object:      f.cross_object || null,
      rfilt_cross_match:       f.cross_match || null,
      rfilt_cross_subfilters:  f.cross_subfilters || [],
      rfilt_is_runtime_prompt: !!f.is_runtime_prompt,
      rfilt_runtime_label:     f.runtime_label || null,
      created_by:              userId,
      updated_by:              userId,
    }))
    const { error } = await supabase.from('report_filters').insert(rows)
    if (error) throw error
  }

  if (groupings?.length) {
    const rows = groupings.map((g, idx) => ({
      rgr_report_id:         reportId,
      rgr_grouping_level:    idx + 1,
      rgr_field_name:        g.field_name,
      rgr_field_table:       g.field_table || null,
      rgr_field_via_path:    g.field_via_path || null,
      rgr_field_label:       g.field_label || null,
      rgr_sort_direction:    g.sort_direction || 'asc',
      rgr_sort_by_aggregate: g.sort_by_aggregate || null,
      rgr_show_subtotal:     g.show_subtotal !== false,
      rgr_date_granularity:  g.date_granularity || null,
      created_by:            userId,
      updated_by:            userId,
    }))
    const { error } = await supabase.from('report_groupings').insert(rows)
    if (error) throw error
  }

  if (calculatedFields?.length) {
    const rows = calculatedFields.map((c, idx) => ({
      rcf_report_id:      reportId,
      rcf_label:          c.label,
      rcf_scope:          c.scope || 'row',
      rcf_expression:     c.expression,
      rcf_data_type:      c.data_type || 'number',
      rcf_format_options: c.format_options || {},
      rcf_display_order:  idx,
      rcf_grouping_level: c.grouping_level || null,
      created_by:         userId,
      updated_by:         userId,
    }))
    const { error } = await supabase.from('report_calculated_fields').insert(rows)
    if (error) throw error
  }

  return reportId
}

// ─── Report runner — Phase 2c ─────────────────────────────────────────────
// Executes a saved report's query against Postgres via PostgREST and
// returns the result rows. Phase 2c.1: tabular reports with AND-only
// filters and direct + one-hop fields. Summary/matrix layouts and
// nested OR/NOT logic come in 2c.2.
//
// Returns:
//   {
//     rows:    [...],          // raw rows from PostgREST, with via_path nested objects intact
//     columns: [...],          // ordered selected_fields for layout
//     groupings: [...],        // groupings (for summary/matrix layout)
//     calculatedFields: [...], // for evaluator
//     format:  'tabular'|'summary'|'matrix',
//     primaryObject: 'projects',
//   }

// Map of well-known label columns per table, in priority order. The runner
// uses this to auto-embed an FK column's parent record name so users see
// 'Acme Corp' instead of a UUID. If a table isn't here, no label is
// resolved (cell falls back to the truncated UUID display).
const TABLE_NAME_COLUMNS = {
  accounts:               ['account_name'],
  contacts:               ['contact_name', 'contact_first_name'],
  properties:             ['property_name'],
  buildings:              ['building_name'],
  units:                  ['unit_name'],
  opportunities:          ['opportunity_name'],
  projects:               ['project_name'],
  work_orders:            ['work_order_name'],
  work_steps:             ['work_step_name'],
  work_plans:             ['work_plan_name'],
  work_types:             ['name', 'work_type_name'],
  work_plan_templates:    ['wpt_name'],
  work_step_templates:    ['wst_name'],
  incentive_applications: ['ia_name'],
  programs:               ['name'],
  users:                  ['user_name'],
  roles:                  ['role_name'],
  vehicles:               ['vehicle_name'],
  equipment:              ['equipment_name'],
  products:               ['product_name'],
  envelopes:              ['env_name'],
  document_templates:     ['name'],
  email_templates:        ['name'],
  picklist_values:        ['picklist_label', 'picklist_value'],
  skills:                 ['skill_name'],
  service_territories:    ['name'],
  report_folders:         ['rf_name'],
  reports:                ['rpt_name'],
  portals:                ['portal_name'],
  chat_threads:           ['chat_subject'],
}

/**
 * For a list of tables, return a map of "{table}.{column}" → FK metadata
 * with the resolved name column for the referenced table. Skipped FKs:
 * picklist_values (handled via picklist label resolution separately;
 * Phase 2c.4 follow-up), audit user FKs (*_by), and any FK whose
 * referenced table doesn't have a known name column.
 */
async function buildFKLookup(primaryTable, alsoTables) {
  const allTables = Array.from(new Set([primaryTable, ...(alsoTables || [])])).filter(Boolean)
  const out = {}
  for (const tbl of allTables) {
    const cols = await describeColumns(tbl)
    for (const c of cols) {
      if (!c.is_foreign_key || !c.references_table) continue
      if (c.column_name.endsWith('_by')) continue
      // Picklist label resolution will be its own thing later; skip here
      if (c.references_table === 'picklist_values') continue
      const candidates = TABLE_NAME_COLUMNS[c.references_table]
      if (!candidates) continue
      // Pick the first candidate that exists on the referenced table
      const refCols = await describeColumns(c.references_table)
      const nameCol = candidates.find(n => refCols.some(rc => rc.column_name === n))
      if (!nameCol) continue
      out[`${tbl}.${c.column_name}`] = {
        references_table: c.references_table,
        name_column:      nameCol,
      }
    }
  }
  return out
}

export async function runReport(reportId) {
  const loaded = await loadReport(reportId)
  if (!loaded) throw new Error('Report not found')
  const r = loaded.report

  // We need to know which columns on the primary object (and any expanded
  // related object) are FKs, so we can auto-embed the parent record's
  // name field for label display. Cached per call.
  const fkLookup = await buildFKLookup(r.rpt_primary_object,
    Array.from(new Set((r.rpt_selected_fields || [])
      .filter(f => f.via_path && f.via_path.length === 1)
      .map(f => f.table)))
  )

  // Build the PostgREST select string. Direct fields are listed by name;
  // related-object fields use embedded resource syntax: 'foreign_table(field)'.
  // We group fields by their FK column so multiple fields from the same
  // related table share a single embed.
  // FK columns get a name-label embed auto-attached so the runner can show
  // 'Acme Corp' instead of 'a1b2c3d4-...' in cells.
  const directFields = []
  const embedMap = {}  // fk_column → { table, fields: [...] }
  // Auto-embeds for FK label resolution: keyed by alias to avoid clashing
  // with explicit user-selected embeds on the same fk_column.
  const labelEmbeds = []  // { alias, fk_column, table, name_column }

  for (const f of (r.rpt_selected_fields || [])) {
    if (!f.via_path || f.via_path.length === 0) {
      directFields.push(f.name)
      // If this is a FK column on the primary object, queue a label embed
      const fkInfo = fkLookup[`${r.rpt_primary_object}.${f.name}`]
      if (fkInfo && fkInfo.name_column) {
        labelEmbeds.push({
          alias:       `_lbl_${f.name}`,
          fk_column:   f.name,
          table:       fkInfo.references_table,
          name_column: fkInfo.name_column,
        })
      }
    } else if (f.via_path.length === 1) {
      const fk = f.via_path[0]
      if (!embedMap[fk]) embedMap[fk] = { table: f.table, fields: [] }
      embedMap[fk].fields.push(f.name)
    } else {
      console.warn(`Multi-hop via_path not supported in runner v1: ${f.name}`)
    }
  }

  if (!directFields.includes('id')) directFields.unshift('id')

  const selectParts = [...directFields]
  for (const [fk, embed] of Object.entries(embedMap)) {
    selectParts.push(`${fk}:${embed.table}(${embed.fields.join(', ')})`)
  }
  // Auto-embeds for FK labels — separate alias so they don't collide with
  // user-selected embeds on the same FK column
  for (const le of labelEmbeds) {
    selectParts.push(`${le.alias}:${le.fk_column}(${le.name_column})`)
  }
  for (const g of (loaded.groupings || [])) {
    if (!g.rgr_field_via_path && g.rgr_field_name && !selectParts.includes(g.rgr_field_name)) {
      selectParts.push(g.rgr_field_name)
    }
  }

  const selectStr = selectParts.join(', ')

  let query = supabase.from(r.rpt_primary_object).select(selectStr)

  // Soft-delete filter — every business table has either is_deleted or
  // a prefixed equivalent. Use a try/catch path: prefer plain is_deleted,
  // skip silently if the table doesn't have one.
  query = query.eq('is_deleted', false)

  // Apply filters — AND-only for v1.
  for (const f of (loaded.filters || [])) {
    if (f.rfilt_is_cross_filter) continue  // cross-filters in 2c.2
    if (!f.rfilt_field_name || !f.rfilt_operator) continue
    const col = (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0)
      ? `${f.rfilt_field_via_path[0]}.${f.rfilt_field_name}`
      : f.rfilt_field_name
    const v = f.rfilt_value
    switch (f.rfilt_operator) {
      case 'equals':            query = query.eq(col, v); break
      case 'not_equals':        query = query.neq(col, v); break
      case 'greater_than':      query = query.gt(col, v); break
      case 'less_than':         query = query.lt(col, v); break
      case 'greater_or_equal':  query = query.gte(col, v); break
      case 'less_or_equal':     query = query.lte(col, v); break
      case 'in':                query = query.in(col, Array.isArray(v) ? v : String(v).split(',').map(s => s.trim())); break
      case 'not_in':            query = query.not(col, 'in', `(${(Array.isArray(v) ? v : String(v).split(',').map(s => s.trim())).map(x => `"${x}"`).join(',')})`); break
      case 'contains':          query = query.ilike(col, `%${v}%`); break
      case 'starts_with':       query = query.ilike(col, `${v}%`); break
      case 'ends_with':         query = query.ilike(col, `%${v}`); break
      case 'is_null':           query = query.is(col, null); break
      case 'is_not_null':       query = query.not(col, 'is', null); break
      case 'in_last_n_days': {
        const n = parseInt(v, 10)
        if (Number.isFinite(n) && n > 0) {
          const cutoff = new Date(Date.now() - n * 86400000).toISOString()
          query = query.gte(col, cutoff)
        }
        break
      }
      case 'this_month': {
        const now = new Date()
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const end   = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString()
        query = query.gte(col, start).lt(col, end)
        break
      }
      case 'this_year': {
        const now = new Date()
        const start = new Date(now.getFullYear(), 0, 1).toISOString()
        const end   = new Date(now.getFullYear()+1, 0, 1).toISOString()
        query = query.gte(col, start).lt(col, end)
        break
      }
      default:
        console.warn(`Unsupported operator: ${f.rfilt_operator}`)
    }
  }

  // Apply sort — sort_config is an array of { name, direction, table?, via_path? }
  const sortConfig = r.rpt_sort_config || []
  for (const s of sortConfig) {
    if (!s.name) continue
    const col = (s.via_path && s.via_path.length > 0)
      ? `${s.via_path[0]}.${s.name}`
      : s.name
    query = query.order(col, { ascending: s.direction !== 'desc' })
  }

  // Cap rows defensively — full pagination later
  query = query.limit(2000)

  const { data, error } = await query
  if (error) throw error

  // Mark this report as run for "Last Run" display
  const userId = await getCurrentUserId()
  await supabase.from('reports').update({
    rpt_last_run_at: new Date().toISOString(),
    rpt_last_run_by: userId,
  }).eq('id', reportId)

  return {
    rows: data || [],
    columns: r.rpt_selected_fields || [],
    groupings: (loaded.groupings || []).map(g => ({
      field_name:        g.rgr_field_name,
      field_label:       g.rgr_field_label || g.rgr_field_name,
      field_via_path:    g.rgr_field_via_path,
      sort_direction:    g.rgr_sort_direction,
      show_subtotal:     g.rgr_show_subtotal,
      date_granularity:  g.rgr_date_granularity,
    })),
    calculatedFields: (loaded.calculatedFields || []).map(c => ({
      label:           c.rcf_label,
      scope:           c.rcf_scope,
      expression:      c.rcf_expression,
      data_type:       c.rcf_data_type,
      grouping_level:  c.rcf_grouping_level,
    })),
    format:        r.rpt_format,
    primaryObject: r.rpt_primary_object,
    name:          r.rpt_name,
  }
}

/**
 * Resolve a value at a path within a row — handles direct fields and
 * one-hop via_path nested objects. For direct FK fields, looks for an
 * auto-embedded label first (prefix '_lbl_<colname>') and returns the
 * resolved name when present.
 *
 * Returns null if the path doesn't resolve.
 */
export function getRowValue(row, field) {
  if (!row || !field) return null
  if (!field.via_path || field.via_path.length === 0) {
    // Direct field: check for an auto-resolved FK label first
    const labelEmbed = row[`_lbl_${field.name}`]
    if (labelEmbed && typeof labelEmbed === 'object') {
      // Pick the first non-null property — there's only ever one (the name col)
      for (const k of Object.keys(labelEmbed)) {
        if (labelEmbed[k] != null) return labelEmbed[k]
      }
    }
    return row[field.name] ?? null
  }
  // One-hop: row[fk_column] is the nested object
  const nested = row[field.via_path[0]]
  if (!nested) return null
  return nested[field.name] ?? null
}
