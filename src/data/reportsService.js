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

// ─── Scheduled report editor helpers ──────────────────────────────────────

export async function loadSchedule(scheduleId) {
  if (!scheduleId || scheduleId === 'new') return null
  const { data, error } = await supabase
    .from('scheduled_reports')
    .select('*')
    .eq('id', scheduleId)
    .eq('is_deleted', false)
    .single()
  if (error) throw error
  return data
}

export async function saveSchedule({ id, schedule }) {
  const isNew = !id || id === 'new'
  const userId = await getCurrentUserId()

  // Compute initial sr_next_send_at via the DB helper so the schedule
  // becomes due at the right moment immediately after save.
  const { data: nextSend, error: nextErr } = await supabase.rpc('compute_next_send_at', {
    p_frequency:    schedule.sr_frequency,
    p_day_of_week:  schedule.sr_day_of_week ?? null,
    p_day_of_month: schedule.sr_day_of_month ?? null,
    p_send_time:    schedule.sr_send_time,
    p_timezone:     schedule.sr_timezone,
    p_anchor:       new Date().toISOString(),
  })
  if (nextErr) throw nextErr

  const payload = {
    sr_report_id:           schedule.sr_report_id,
    sr_name:                schedule.sr_name,
    sr_frequency:           schedule.sr_frequency,
    sr_day_of_week:         schedule.sr_day_of_week ?? null,
    sr_day_of_month:        schedule.sr_day_of_month ?? null,
    sr_send_time:           schedule.sr_send_time,
    sr_timezone:            schedule.sr_timezone,
    sr_format:              schedule.sr_format || 'csv',
    sr_subject_line:        schedule.sr_subject_line,
    sr_message_body:        schedule.sr_message_body || null,
    sr_recipient_user_ids:  schedule.sr_recipient_user_ids || [],
    sr_recipient_role_ids:  schedule.sr_recipient_role_ids || [],
    sr_recipient_emails:    schedule.sr_recipient_emails || [],
    sr_is_active:           schedule.sr_is_active !== false,
    sr_next_send_at:        nextSend,
    updated_by:             userId,
  }

  if (isNew) {
    payload.sr_record_number = ''
    payload.sr_owner_user_id = userId
    payload.created_by       = userId
    const { data, error } = await supabase
      .from('scheduled_reports').insert(payload).select('id').single()
    if (error) throw error
    return data.id
  } else {
    const { error } = await supabase
      .from('scheduled_reports').update(payload).eq('id', id)
    if (error) throw error
    return id
  }
}

/**
 * Manually fire the dispatcher for one schedule — useful from the
 * editor's 'Test send' action without waiting for the cron.
 */
export async function dispatchScheduleNow(scheduleId, { dryRunForce = false } = {}) {
  const { data, error } = await supabase.functions.invoke('dispatch-scheduled-reports', {
    body: { schedule_id: scheduleId, dry_run_force: dryRunForce },
  })
  if (error) throw error
  return data
}

/**
 * Fetch the latest run history for a schedule — used in the editor's
 * History tab so authors can confirm sends are happening.
 */
export async function fetchScheduleRunHistory(scheduleId, { limit = 25 } = {}) {
  const { data, error } = await supabase
    .from('scheduled_report_runs')
    .select('*')
    .eq('srr_scheduled_report_id', scheduleId)
    .order('srr_started_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

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

/**
 * Public column discovery for the Builder UI. Used by cross-filter
 * sub-filter rows to populate a field dropdown for the chosen cross
 * object. Returns the same shape as primary fields: [{name, type, nullable}].
 */
export async function listObjectColumns(tableName) {
  const cols = await describeColumns(tableName)
  return cols
    .filter(c => !['created_at','updated_at','created_by','updated_by','deleted_at','deleted_by','is_deleted','deletion_reason'].includes(c.column_name))
    .map(c => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
    }))
}

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
 * Pull columns AND outgoing FKs for a related object (lazy-loaded when
 * the user expands a related-object node in the field tree). The via_path
 * lets the Builder record where this node came from. Including the FKs
 * lets the Builder render a recursive tree — pick any column at any depth.
 */
export async function loadRelatedObjectFields(viaTable, viaPath) {
  const [columns, fks] = await Promise.all([
    describeColumns(viaTable),
    describeOutgoingFKs(viaTable),
  ])
  return {
    table: viaTable,
    via_path: viaPath,
    columns: columns.map(c => ({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
    })),
    related: fks.map(f => ({
      fk_column: f.column_name,
      table: f.references_table,
      label: humanizeFkLabel(f.column_name, f.references_table),
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

/**
 * Lightweight helper for the Dashboard Editor: returns just a report's
 * selected-fields array without loading filters/groupings/calc fields.
 * Used to populate per-widget group_by / measure_field dropdowns without
 * a round-trip to schema introspection.
 *
 * Returns: array of { name, table, label, via_path, type }
 */
export async function getReportSelectedFields(reportId) {
  if (!reportId || reportId === 'new') return []
  const { data, error } = await supabase
    .from('reports')
    .select('rpt_selected_fields')
    .eq('id', reportId)
    .eq('is_deleted', false)
    .single()
  if (error) return []
  return data?.rpt_selected_fields || []
}

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
      rfilt_prompt_input_type: f.prompt_input_type || 'text',
      rfilt_prompt_options:    f.prompt_options || [],
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
 * with the resolved name column for the referenced table. Picklist FKs
 * get a special marker (is_picklist: true) — they're resolved against
 * picklist_values via a different code path because picklist_values has
 * a generic shape and the relevant rows depend on the (object, field)
 * pair, not just the FK target.
 *
 * Skipped FKs: audit user FKs (*_by) and any non-picklist FK whose
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
      if (c.references_table === 'picklist_values') {
        // Picklist column — resolve via a different path (picklist_values
        // lookup keyed on object+field). We still record it here so the
        // runner knows to do the second-pass resolution.
        out[`${tbl}.${c.column_name}`] = {
          references_table: 'picklist_values',
          is_picklist:      true,
        }
        continue
      }
      const candidates = TABLE_NAME_COLUMNS[c.references_table]
      if (!candidates) continue
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

/**
 * Pull the picklist-values rows that match a list of (table, column) pairs.
 * Returns a Map keyed by picklist_values.id → { value, label }. The runner
 * uses this for second-pass UUID-to-label substitution on picklist columns.
 */
async function loadPicklistLabels(pairs) {
  if (!pairs || pairs.length === 0) return new Map()
  const map = new Map()
  // Group by picklist_object so we can issue one query per object instead
  // of N queries. picklist_field is then filtered in-array.
  const byObject = new Map()
  for (const p of pairs) {
    if (!byObject.has(p.object)) byObject.set(p.object, new Set())
    byObject.get(p.object).add(p.field)
  }
  for (const [object, fields] of byObject) {
    const { data, error } = await supabase
      .from('picklist_values')
      .select('id, picklist_field, picklist_value, picklist_label')
      .eq('picklist_object', object)
      .in('picklist_field', Array.from(fields))
    if (error) {
      console.warn('picklist label load failed for', object, error.message)
      continue
    }
    for (const row of (data || [])) {
      map.set(row.id, {
        value: row.picklist_value,
        label: row.picklist_label || row.picklist_value,
      })
    }
  }
  return map
}

/**
 * Apply a filter-logic expression (e.g. '1 AND (2 OR 3)') to a row set
 * client-side. Each filter row evaluated per-row produces a boolean,
 * indexed by rfilt_filter_index. The expression is parsed via shunting-
 * yard into RPN and evaluated for each row.
 *
 * Used only when the report's rpt_filter_logic is non-trivial — pure
 * AND-of-all-filters reports use PostgREST server-side filters and skip
 * this code path.
 */
function applyFilterLogic(rows, filters, expression, fkLookup, primaryObject) {
  // Tokenize the logic expression: numbers, AND, OR, NOT, ( )
  const tokens = []
  let i = 0
  while (i < expression.length) {
    const c = expression[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < expression.length && /[0-9]/.test(expression[j])) j++
      tokens.push({ type: 'num', value: parseInt(expression.slice(i, j), 10) })
      i = j; continue
    }
    if (c === '(') { tokens.push({ type: '(' }); i++; continue }
    if (c === ')') { tokens.push({ type: ')' }); i++; continue }
    if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < expression.length && /[a-zA-Z]/.test(expression[j])) j++
      const word = expression.slice(i, j).toUpperCase()
      if (word === 'AND' || word === 'OR' || word === 'NOT') tokens.push({ type: word })
      else throw new Error(`Unexpected token in filter logic: ${word}`)
      i = j; continue
    }
    throw new Error(`Unexpected character in filter logic: ${c}`)
  }

  // Shunting-yard to RPN
  const prec = { NOT: 3, AND: 2, OR: 1 }
  const output = []
  const stack = []
  for (const t of tokens) {
    if (t.type === 'num') output.push(t)
    else if (t.type === '(') stack.push(t)
    else if (t.type === ')') {
      while (stack.length && stack[stack.length-1].type !== '(') output.push(stack.pop())
      stack.pop()
    }
    else { // operator
      while (stack.length) {
        const top = stack[stack.length-1]
        if (top.type === '(') break
        if ((prec[top.type] || 0) >= (prec[t.type] || 0)) output.push(stack.pop())
        else break
      }
      stack.push(t)
    }
  }
  while (stack.length) output.push(stack.pop())

  // Evaluate per-row. Per-filter evaluation is delegated to a helper.
  const filterByIdx = new Map()
  for (const f of filters) filterByIdx.set(f.rfilt_filter_index, f)

  return rows.filter(row => {
    const evalStack = []
    for (const t of output) {
      if (t.type === 'num') {
        const f = filterByIdx.get(t.value)
        if (!f) { evalStack.push(false); continue }
        evalStack.push(evalFilterOnRow(f, row, fkLookup, primaryObject))
      } else if (t.type === 'NOT') {
        const a = evalStack.pop()
        evalStack.push(!a)
      } else if (t.type === 'AND') {
        const b = evalStack.pop(), a = evalStack.pop()
        evalStack.push(a && b)
      } else if (t.type === 'OR') {
        const b = evalStack.pop(), a = evalStack.pop()
        evalStack.push(a || b)
      }
    }
    return !!evalStack[0]
  })
}

function evalFilterOnRow(f, row, fkLookup, primaryObject) {
  // Resolve the value at the filter's column path — supports arbitrary
  // via_path depth.
  let v
  if (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0) {
    let nested = row
    for (const fk of f.rfilt_field_via_path) {
      if (!nested) break
      nested = nested[fk]
    }
    v = nested ? nested[f.rfilt_field_name] : null
  } else {
    v = row[f.rfilt_field_name]
  }
  const target = f.rfilt_value
  switch (f.rfilt_operator) {
    case 'equals':           return v == target  // eslint-disable-line eqeqeq
    case 'not_equals':       return v != target  // eslint-disable-line eqeqeq
    case 'greater_than':     return parseFloat(v) > parseFloat(target)
    case 'less_than':        return parseFloat(v) < parseFloat(target)
    case 'greater_or_equal': return parseFloat(v) >= parseFloat(target)
    case 'less_or_equal':    return parseFloat(v) <= parseFloat(target)
    case 'in': {
      const list = Array.isArray(target) ? target : String(target).split(',').map(s => s.trim())
      return list.includes(v) || list.includes(String(v))
    }
    case 'not_in': {
      const list = Array.isArray(target) ? target : String(target).split(',').map(s => s.trim())
      return !(list.includes(v) || list.includes(String(v)))
    }
    case 'contains':    return v != null && String(v).toLowerCase().includes(String(target).toLowerCase())
    case 'starts_with': return v != null && String(v).toLowerCase().startsWith(String(target).toLowerCase())
    case 'ends_with':   return v != null && String(v).toLowerCase().endsWith(String(target).toLowerCase())
    case 'is_null':     return v == null || v === ''
    case 'is_not_null': return v != null && v !== ''
    case 'in_last_n_days': {
      const n = parseInt(target, 10)
      if (!Number.isFinite(n) || !v) return false
      const d = new Date(v)
      if (isNaN(d.getTime())) return false
      return (Date.now() - d.getTime()) <= n * 86400000
    }
    case 'this_month': {
      if (!v) return false
      const d = new Date(v); const now = new Date()
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }
    case 'this_year': {
      if (!v) return false
      const d = new Date(v); const now = new Date()
      return d.getFullYear() === now.getFullYear()
    }
  }
  return true
}

/**
 * Return the list of runtime-prompt filters for a report. Each entry has
 * the filter index (used as the override key), the label shown to the
 * user, the operator, and the saved default value. The runner uses this
 * to render a "Run with parameters" modal before executing the query.
 */
export async function getReportPrompts(reportId) {
  if (!reportId || reportId === 'new') return []
  const { data, error } = await supabase
    .from('report_filters')
    .select('rfilt_filter_index, rfilt_runtime_label, rfilt_field_name, rfilt_operator, rfilt_value, rfilt_is_runtime_prompt, rfilt_prompt_input_type, rfilt_prompt_options')
    .eq('rfilt_report_id', reportId)
    .eq('rfilt_is_runtime_prompt', true)
    .eq('is_deleted', false)
    .order('rfilt_filter_index')
  if (error) throw error
  return (data || []).map(f => ({
    index:        f.rfilt_filter_index,
    label:        f.rfilt_runtime_label || f.rfilt_field_name || `Prompt ${f.rfilt_filter_index}`,
    field_name:   f.rfilt_field_name,
    operator:     f.rfilt_operator,
    default_value: f.rfilt_value,
    input_type:   f.rfilt_prompt_input_type || 'text',
    options:      f.rfilt_prompt_options || [],
  }))
}

/**
 * Apply a single (field, operator, value) tuple to a Supabase query
 * builder. Same operator vocabulary as the runner's main filter loop;
 * extracted so cross-filter sub-filters reuse the same semantics.
 */
function applySimpleFilter(query, fieldName, operator, value) {
  switch (operator) {
    case 'equals':           return query.eq(fieldName, value)
    case 'not_equals':       return query.neq(fieldName, value)
    case 'greater_than':     return query.gt(fieldName, value)
    case 'less_than':        return query.lt(fieldName, value)
    case 'greater_or_equal': return query.gte(fieldName, value)
    case 'less_or_equal':    return query.lte(fieldName, value)
    case 'in':
      return query.in(fieldName,
        Array.isArray(value) ? value : String(value).split(',').map(s => s.trim()))
    case 'not_in':
      return query.not(fieldName, 'in',
        `(${(Array.isArray(value) ? value : String(value).split(',').map(s => s.trim())).map(x => `"${x}"`).join(',')})`)
    case 'contains':    return query.ilike(fieldName, `%${value}%`)
    case 'starts_with': return query.ilike(fieldName, `${value}%`)
    case 'ends_with':   return query.ilike(fieldName, `%${value}`)
    case 'is_null':     return query.is(fieldName, null)
    case 'is_not_null': return query.not(fieldName, 'is', null)
    case 'in_last_n_days': {
      const n = parseInt(value, 10)
      if (Number.isFinite(n) && n > 0) {
        const cutoff = new Date(Date.now() - n * 86400000).toISOString()
        return query.gte(fieldName, cutoff)
      }
      return query
    }
    case 'this_month': {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const end   = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString()
      return query.gte(fieldName, start).lt(fieldName, end)
    }
    case 'this_year': {
      const now = new Date()
      const start = new Date(now.getFullYear(), 0, 1).toISOString()
      const end   = new Date(now.getFullYear()+1, 0, 1).toISOString()
      return query.gte(fieldName, start).lt(fieldName, end)
    }
  }
  return query
}

/**
 * Run a saved report and return its rows + columns.
 *
 * @param {string} reportId
 * @param {Object|null} promptValues  - Map of rfilt_filter_index → value
 *                                      for runtime prompts. Overrides the
 *                                      saved default value of each prompt
 *                                      filter that has a value supplied.
 * @param {Array|null}  extraFilters  - Additional filter rows to apply on
 *                                      top of the report's saved filters.
 *                                      Each entry: { field_name, operator,
 *                                      value }. Used by the Dashboard
 *                                      Runner to apply dashboard-level
 *                                      filters to each widget's report.
 *                                      Filters whose field_name doesn't
 *                                      exist on the primary object are
 *                                      silently skipped — that's how a
 *                                      dashboard filter that only some
 *                                      reports support degrades.
 */
export async function runReport(reportId, promptValues = null, extraFilters = null) {
  const loaded = await loadReport(reportId)
  if (!loaded) throw new Error('Report not found')
  const r = loaded.report

  // If this report has runtime prompts and the caller provided values,
  // override each prompted filter's value before evaluating filters.
  // promptValues is a map keyed by rfilt_filter_index → value.
  if (promptValues && (loaded.filters || []).length > 0) {
    loaded.filters = loaded.filters.map(f => {
      if (f.rfilt_is_runtime_prompt && promptValues[f.rfilt_filter_index] !== undefined) {
        return { ...f, rfilt_value: promptValues[f.rfilt_filter_index] }
      }
      return f
    })
  }

  // Append any extraFilters whose field_name is a real column on the
  // primary object. Filters targeting fields the report doesn't have
  // are silently dropped — this is how dashboard-level filters apply
  // to some reports and not others without erroring on the misses.
  if (extraFilters && extraFilters.length > 0) {
    const primaryCols = await describeColumns(r.rpt_primary_object)
    const primaryColNames = new Set(primaryCols.map(c => c.column_name))
    const applicable = extraFilters.filter(ef => primaryColNames.has(ef.field_name))
    if (applicable.length > 0) {
      const existingCount = (loaded.filters || []).length
      const synthesized = applicable.map((ef, i) => ({
        rfilt_filter_index:      existingCount + i + 1,
        rfilt_field_name:        ef.field_name,
        rfilt_field_via_path:    null,
        rfilt_operator:          ef.operator || 'equals',
        rfilt_value:             ef.value,
        rfilt_is_cross_filter:   false,
        rfilt_is_runtime_prompt: false,
      }))
      loaded.filters = [...(loaded.filters || []), ...synthesized]
    }
  }

  // Build a lookup of FKs across the primary object plus every related
  // object that any selected field traverses (single- or multi-hop). This
  // is what powers (a) auto-embedded FK-label resolution and (b) picklist
  // detection for fields living on related objects.
  const fkLookup = await buildFKLookup(r.rpt_primary_object,
    Array.from(new Set((r.rpt_selected_fields || [])
      .filter(f => f.via_path && f.via_path.length > 0 && f.table)
      .map(f => f.table)))
  )

  // Build the PostgREST select string. Direct fields are listed by name;
  // related-object fields use embedded resource syntax with arbitrary
  // depth: 'fk1:t1(fk2:t2(field))'.
  //
  // We build an embed tree keyed by FK chain, then serialize. This handles
  // multi-hop via_paths uniformly with single-hop. The Builder UI only
  // supports single-hop expansion today, but the runner is ready when it
  // catches up.
  // FK columns on the primary object get a name-label embed auto-attached
  // so the runner can show 'Acme Corp' instead of 'a1b2c3d4-...' in cells.

  const directFields = []
  // embedTree: nested object. embedTree[fk] = { table, fields: [...], children: { fk2: {...} } }
  const embedTree = {}
  const labelEmbeds = []  // { alias, fk_column, table, name_column }

  function ensureEmbedNode(viaPath, leafTable) {
    let node = embedTree
    for (let i = 0; i < viaPath.length; i++) {
      const fk = viaPath[i]
      if (!node[fk]) node[fk] = { table: i === viaPath.length - 1 ? leafTable : null, fields: [], children: {} }
      if (i === viaPath.length - 1 && leafTable) node[fk].table = leafTable
      // Move to the children for the next hop
      if (i < viaPath.length - 1) node = node[fk].children
    }
    // Return reference to the deepest node so caller can push fields
    let cur = embedTree
    for (let i = 0; i < viaPath.length - 1; i++) cur = cur[viaPath[i]].children
    return cur[viaPath[viaPath.length - 1]]
  }

  for (const f of (r.rpt_selected_fields || [])) {
    if (!f.via_path || f.via_path.length === 0) {
      directFields.push(f.name)
      const fkInfo = fkLookup[`${r.rpt_primary_object}.${f.name}`]
      if (fkInfo && fkInfo.name_column) {
        labelEmbeds.push({
          alias:       `_lbl_${f.name}`,
          fk_column:   f.name,
          table:       fkInfo.references_table,
          name_column: fkInfo.name_column,
        })
      }
    } else {
      const node = ensureEmbedNode(f.via_path, f.table)
      if (!node.fields.includes(f.name)) node.fields.push(f.name)
    }
  }

  if (!directFields.includes('id')) directFields.unshift('id')

  // Serialize the embed tree depth-first into PostgREST nested-embed syntax.
  function serializeEmbeds(tree) {
    const parts = []
    for (const [fk, node] of Object.entries(tree)) {
      const innerParts = [...node.fields]
      const childSerialized = serializeEmbeds(node.children)
      innerParts.push(...childSerialized)
      const tableSegment = node.table ? `:${node.table}` : ''
      parts.push(`${fk}${tableSegment}(${innerParts.join(', ')})`)
    }
    return parts
  }

  const selectParts = [...directFields, ...serializeEmbeds(embedTree)]
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

  // Soft-delete filter — different tables use different column names
  // ('is_deleted' vs prefixed equivalents like 'property_is_deleted').
  // ees_table_metadata is the source of truth. If the table doesn't have
  // a soft-delete column at all, skip the filter.
  const { data: meta } = await supabase.rpc('ees_table_metadata', { p_table: r.rpt_primary_object })
  const softDeleteCol = meta?.is_deleted_column
  if (softDeleteCol) {
    query = query.eq(softDeleteCol, false)
  }

  // Cross-filters: pre-compute sets of primary-object IDs that match
  // each cross-filter. After the main query returns, filter rows by
  // intersection (or difference for 'without') with these sets.
  //
  // Cross-filter shape on report_filters rows:
  //   rfilt_is_cross_filter: true
  //   rfilt_cross_object:    'work_orders'
  //   rfilt_cross_match:     'with' | 'without'
  //   rfilt_cross_subfilters: jsonb array of additional filters scoped
  //                            to the cross object
  //
  // Discovery: cross_object must have a FK column pointing at the primary
  // object. We pick the first FK whose references_table === primaryObject.
  const crossFilterRows = (loaded.filters || []).filter(f => f.rfilt_is_cross_filter)
  const crossFilterSets = []  // [{ match: 'with'|'without', ids: Set<uuid> }]

  for (const cf of crossFilterRows) {
    if (!cf.rfilt_cross_object) continue
    try {
      const crossCols = await describeColumns(cf.rfilt_cross_object)
      const linkCol = crossCols.find(c =>
        c.is_foreign_key && c.references_table === r.rpt_primary_object
      )
      if (!linkCol) {
        console.warn(`No FK from ${cf.rfilt_cross_object} to ${r.rpt_primary_object} — skipping cross-filter`)
        continue
      }
      let crossQuery = supabase.from(cf.rfilt_cross_object).select(linkCol.column_name)
      // Cross object's soft-delete column (different tables use different names)
      const { data: crossMeta } = await supabase.rpc('ees_table_metadata', { p_table: cf.rfilt_cross_object })
      if (crossMeta?.is_deleted_column) {
        crossQuery = crossQuery.eq(crossMeta.is_deleted_column, false)
      }
      for (const sf of (cf.rfilt_cross_subfilters || [])) {
        if (!sf.field_name || !sf.operator) continue
        crossQuery = applySimpleFilter(crossQuery, sf.field_name, sf.operator, sf.value)
      }
      const { data: crossData, error: crossErr } = await crossQuery.limit(50000)
      if (crossErr) {
        console.warn('Cross-filter query failed:', crossErr.message)
        continue
      }
      const ids = new Set((crossData || []).map(row => row[linkCol.column_name]).filter(Boolean))
      crossFilterSets.push({
        match: cf.rfilt_cross_match || 'with',
        ids,
      })
    } catch (err) {
      console.warn(`Cross-filter resolution failed for ${cf.rfilt_cross_object}:`, err.message)
    }
  }

  // When the report uses non-trivial filter logic (anything other than
  // 'all' AND-of-everything), skip server-side filter pushdown — the
  // filter logic is evaluated client-side after the query returns. Reports
  // with simple AND-only logic keep using PostgREST filters for efficiency.
  const _logicCheck = (r.rpt_filter_logic || 'all').trim()
  const _hasComplexLogic = _logicCheck !== 'all' && /[A-Z]+\s*[A-Z]|\(|NOT/i.test(_logicCheck)

  // Apply filters — AND-only for v1.
  for (const f of (loaded.filters || [])) {
    if (_hasComplexLogic) break  // skip server-side; client-side handles it
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

  // Cap rows defensively — full pagination later.
  // When a non-trivial filter logic expression is present (contains OR
  // or NOT), we pull the full filtered server-side set, then evaluate
  // the logic expression client-side. PostgREST's .or() is flat and
  // can't combine with AND in the same query.
  const logicExpr = (r.rpt_filter_logic || 'all').trim()
  const hasComplexLogic = logicExpr !== 'all' && /[A-Z]+\s*[A-Z]|\(|NOT/i.test(logicExpr)

  // Pagination loop. PostgREST defaults to 1000 rows per response and
  // caps each query at the per-request maximum. We iterate with .range()
  // until we either exhaust the result set or hit the hard ceiling.
  // Hard ceiling is generous (50k rows) — at that size you should be
  // running aggregated reports or scheduling exports, not pulling raw
  // rows into the browser.
  const PAGE_SIZE = 1000
  const HARD_CEILING = 50000
  let data = []
  let truncated = false
  let pageStart = 0

  while (pageStart < HARD_CEILING) {
    const pageEnd = Math.min(pageStart + PAGE_SIZE - 1, HARD_CEILING - 1)
    const requestedSize = pageEnd - pageStart + 1
    const { data: pageData, error: pageError } = await query.range(pageStart, pageEnd)
    if (pageError) throw pageError
    if (!pageData || pageData.length === 0) break
    data = data.concat(pageData)
    if (pageData.length < requestedSize) break  // last page (server returned fewer than asked)
    pageStart += PAGE_SIZE
    if (data.length >= HARD_CEILING) {
      // We filled the buffer up to the cap — there may or may not be
      // more data beyond. Conservatively flag as truncated so the user
      // knows to refine the filters.
      truncated = true
      break
    }
  }

  // Apply cross-filter sets. For 'with' matches, keep rows whose id is
  // in the set. For 'without', keep rows whose id is NOT in the set.
  for (const cs of crossFilterSets) {
    if (!data) break
    if (cs.match === 'with') {
      data = data.filter(row => cs.ids.has(row.id))
    } else {
      data = data.filter(row => !cs.ids.has(row.id))
    }
  }

  // Client-side filter logic evaluation if expression is non-trivial.
  if (hasComplexLogic && data && (loaded.filters || []).length > 0) {
    data = applyFilterLogic(data, loaded.filters || [], logicExpr, fkLookup, r.rpt_primary_object)
  }

  // Picklist label resolution — second pass. For every selected field
  // that is a picklist FK (either on the primary object or on any related
  // object reached via a via_path), batch-fetch the label rows. Each
  // (object, field) pair the resolution targets goes into the load.
  const picklistFields = (r.rpt_selected_fields || []).filter(f => {
    const fieldTable = (f.via_path && f.via_path.length > 0) ? f.table : r.rpt_primary_object
    if (!fieldTable) return false
    return fkLookup[`${fieldTable}.${f.name}`]?.is_picklist
  })
  let picklistMap = new Map()
  if (picklistFields.length > 0) {
    picklistMap = await loadPicklistLabels(
      picklistFields.map(f => {
        const fieldTable = (f.via_path && f.via_path.length > 0) ? f.table : r.rpt_primary_object
        return { object: fieldTable, field: f.name }
      })
    )
  }

  // Mark this report as run for "Last Run" display
  const userId = await getCurrentUserId()
  await supabase.from('reports').update({
    rpt_last_run_at: new Date().toISOString(),
    rpt_last_run_by: userId,
  }).eq('id', reportId)

  return {
    rows: data || [],
    columns: (r.rpt_selected_fields || []).map(f => {
      const fieldTable = (f.via_path && f.via_path.length > 0) ? f.table : r.rpt_primary_object
      return {
        ...f,
        // Mark picklist columns so getRowValue knows to look up the
        // label — works for direct fields AND fields reached via_path.
        _is_picklist: !!(fieldTable && fkLookup[`${fieldTable}.${f.name}`]?.is_picklist),
      }
    }),
    picklistMap,
    groupings: (loaded.groupings || []).map(g => ({
      field_name:        g.rgr_field_name,
      field_label:       g.rgr_field_label || g.rgr_field_name,
      field_via_path:    g.rgr_field_via_path,
      sort_direction:    g.rgr_sort_direction,
      show_subtotal:     g.rgr_show_subtotal,
      date_granularity:  g.rgr_date_granularity,
    })),
    columnGroupings:  r.rpt_column_groupings || [],
    measure:          (r.rpt_charts && r.rpt_charts[0] && r.rpt_charts[0].measure_type)
      ? { type: r.rpt_charts[0].measure_type, field: r.rpt_charts[0].measure_field || null }
      : { type: 'count', field: null },
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
    truncated,
  }
}

/**
 * Resolve a value at a path within a row — handles direct fields and
 * nested via_path objects of arbitrary depth. For direct FK fields,
 * looks for an auto-embedded label first (prefix '_lbl_<colname>') and
 * returns the resolved name when present. For picklist FK fields, looks
 * up the label in the optional picklistMap.
 *
 * Returns null if the path doesn't resolve.
 */
export function getRowValue(row, field, ctx = null) {
  if (!row || !field) return null
  if (!field.via_path || field.via_path.length === 0) {
    // Direct field

    // Picklist resolution — if this column is flagged as a picklist FK
    // and we have a picklistMap, substitute the UUID with the label.
    if (field._is_picklist && ctx?.picklistMap) {
      const id = row[field.name]
      if (id) {
        const entry = ctx.picklistMap.get(id)
        if (entry) return entry.label
      }
    }

    // FK label resolution — prefer auto-embedded label
    const labelEmbed = row[`_lbl_${field.name}`]
    if (labelEmbed && typeof labelEmbed === 'object') {
      for (const k of Object.keys(labelEmbed)) {
        if (labelEmbed[k] != null) return labelEmbed[k]
      }
    }
    return row[field.name] ?? null
  }
  // Walk via_path of arbitrary depth.
  let nested = row
  for (const fk of field.via_path) {
    if (!nested) return null
    nested = nested[fk]
  }
  if (!nested) return null
  const rawValue = nested[field.name] ?? null

  // Picklist resolution at the via_path leaf — works the same way as
  // direct fields. The column was flagged _is_picklist if its (table,
  // field) pair pointed at picklist_values, regardless of via_path depth.
  if (field._is_picklist && ctx?.picklistMap && rawValue) {
    const entry = ctx.picklistMap.get(rawValue)
    if (entry) return entry.label
  }

  return rawValue
}

// ─── Dashboards ───────────────────────────────────────────────────────────

export async function fetchDashboardFolders() {
  const { data, error } = await supabase
    .from('dashboard_folders')
    .select(`
      id, df_record_number, df_name, df_description, df_is_public,
      df_parent_folder_id, df_owner_user_id, updated_at,
      owner:users!dashboard_folders_df_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('df_name', { ascending: true })

  if (error) throw error
  const rows = data || []
  const accessLevels = await Promise.all(
    rows.map(r => supabase.rpc('app_user_dashboard_folder_access', { p_folder_id: r.id }))
  )
  return rows.map((r, idx) => {
    const accessLevel = accessLevels[idx]?.data || null
    return {
      id:           r.df_record_number || r.id.slice(0, 8).toUpperCase(),
      _id:          r.id,
      name:         r.df_name,
      description:  r.df_description || '—',
      isPublic:     r.df_is_public ? 'Public' : 'Private',
      parentId:     r.df_parent_folder_id,
      ownerId:      r.df_owner_user_id,
      ownerName:    r.owner?.user_name || '—',
      accessLevel,
      updatedAt:    r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
    }
  }).filter(f => f.accessLevel != null)
}

export async function fetchDashboards({ folderId = null } = {}) {
  let q = supabase
    .from('dashboards')
    .select(`
      id, dash_record_number, dash_name, dash_description,
      dash_folder_id, dash_owner_user_id, dash_columns,
      dash_last_run_at, updated_at,
      folder:dashboard_folders(id, df_name),
      owner:users!dashboards_dash_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })

  if (folderId) q = q.eq('dash_folder_id', folderId)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map(d => ({
    id:          d.dash_record_number || d.id.slice(0, 8).toUpperCase(),
    _id:         d.id,
    name:        d.dash_name,
    description: d.dash_description || '—',
    folder:      d.folder?.df_name || '—',
    folderId:    d.dash_folder_id,
    columns:     d.dash_columns,
    owner:       d.owner?.user_name || '—',
    ownerId:     d.dash_owner_user_id,
    lastRun:     d.dash_last_run_at ? new Date(d.dash_last_run_at).toLocaleString() : 'Never',
    updatedAt:   d.updated_at ? new Date(d.updated_at).toLocaleDateString() : '—',
  }))
}

export async function loadDashboard(dashboardId) {
  if (!dashboardId || dashboardId === 'new') return null
  const [dashRes, widgetsRes, filtersRes] = await Promise.all([
    supabase.from('dashboards').select('*').eq('id', dashboardId).eq('is_deleted', false).single(),
    supabase.from('dashboard_widgets').select('*').eq('dw_dashboard_id', dashboardId).eq('is_deleted', false).order('dw_position_row').order('dw_position_col'),
    supabase.from('dashboard_filters').select('*').eq('dfilt_dashboard_id', dashboardId).eq('is_deleted', false).order('dfilt_display_order'),
  ])
  if (dashRes.error)    throw dashRes.error
  if (widgetsRes.error) throw widgetsRes.error
  if (filtersRes.error) throw filtersRes.error
  return {
    dashboard: dashRes.data,
    widgets:   widgetsRes.data || [],
    filters:   filtersRes.data || [],
  }
}

export async function saveDashboard({ id, dashboard, widgets, filters }) {
  const isNew = !id || id === 'new'
  const userId = await getCurrentUserId()

  const dashPayload = {
    dash_name:           dashboard.dash_name,
    dash_description:    dashboard.dash_description || null,
    dash_folder_id:      dashboard.dash_folder_id || null,
    dash_layout:         dashboard.dash_layout || [],
    dash_columns:        dashboard.dash_columns || 3,
    updated_by:          userId,
  }

  let dashId = id
  if (isNew) {
    dashPayload.dash_record_number = ''
    dashPayload.dash_owner_user_id = userId
    dashPayload.created_by         = userId
    const { data, error } = await supabase
      .from('dashboards')
      .insert(dashPayload)
      .select('id')
      .single()
    if (error) throw error
    dashId = data.id
  } else {
    const { error } = await supabase
      .from('dashboards')
      .update(dashPayload)
      .eq('id', id)
    if (error) throw error
  }

  if (!isNew) {
    await Promise.all([
      supabase.from('dashboard_widgets').update({ is_deleted: true }).eq('dw_dashboard_id', dashId),
      supabase.from('dashboard_filters').update({ is_deleted: true }).eq('dfilt_dashboard_id', dashId),
    ])
  }

  if (widgets?.length) {
    // Position is derived from the array order plus the dashboard's column
    // count — reordering in the editor (move up/down in the list) is the
    // single source of truth. Per-widget position_row/col fields are
    // ignored on save and recomputed from index here.
    const cols = Math.max(1, dashboard.dash_columns || 3)
    const rows = widgets.map((w, idx) => ({
      dw_dashboard_id:  dashId,
      dw_report_id:     w.report_id,
      dw_title:         w.title || null,
      dw_widget_type:   w.widget_type || 'table',
      dw_position_row:  Math.floor(idx / cols),
      dw_position_col:  idx % cols,
      dw_width:         w.width || 1,
      dw_height:        w.height || 1,
      dw_widget_config: w.widget_config || {},
      created_by:       userId,
      updated_by:       userId,
    }))
    const { error } = await supabase.from('dashboard_widgets').insert(rows)
    if (error) throw error
  }

  if (filters?.length) {
    const rows = filters.map((f, idx) => ({
      dfilt_dashboard_id:   dashId,
      dfilt_label:          f.label,
      dfilt_field_name:     f.field_name,
      dfilt_operator:       f.operator || 'equals',
      dfilt_default_value:  f.default_value ?? null,
      dfilt_options:        f.options || [],
      dfilt_display_order:  idx,
      created_by:           userId,
      updated_by:           userId,
    }))
    const { error } = await supabase.from('dashboard_filters').insert(rows)
    if (error) throw error
  }

  return dashId
}
