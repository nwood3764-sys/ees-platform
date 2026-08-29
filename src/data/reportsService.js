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
import { guessPrefix } from './fieldMetadataService'
import {
  resolveReportColumnLabels,
  deriveReportColumnLabel,
  isDerivedLabel,
} from '../lib/reportColumnLabels'
import { recordLinkForField } from '../lib/reportRecordLinks'
import {
  fieldKindFor,
  resolveDateBound,
  resolveDateLiteral,
  isDateLiteral,
  toValueArray,
  operatorNeedsValue,
  operatorIsRange,
  operatorIsMulti,
  filterIsIncomplete,
  evaluateOperator,
  parseFilterLogic,
  evaluateLogic,
  logicIsPlainAnd,
} from '../lib/reportFilters'

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
    .map(c => describeColumnToField(tableName, c))
}

/**
 * Human field label for a column, Salesforce-style: the object's column
 * prefix is stripped and the remainder title-cased, so `opportunity_stage`
 * reads "Stage" and `property_hud_management_org` reads "Hud Management Org".
 * FK columns drop the trailing `_id` ("Property", not "Property Id").
 */
export function columnLabel(tableName, columnName) {
  if (!columnName) return ''
  const prefix = guessPrefix(tableName)
  let name = String(columnName)
  if (prefix && name.startsWith(prefix + '_') && name.length > prefix.length + 1) {
    name = name.slice(prefix.length + 1)
  }
  name = name.replace(/_id$/, '')
  if (!name) name = String(columnName)
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Normalise a describe_object_columns row into the field shape the Builder
 * works with — label and kind included, so operator lists and value editors
 * can be chosen without every caller re-deriving them.
 */
function describeColumnToField(tableName, c) {
  return {
    name:             c.column_name,
    label:            columnLabel(tableName, c.column_name),
    type:             c.data_type,
    kind:             fieldKindFor({ type: c.data_type, is_foreign_key: c.is_foreign_key, references_table: c.references_table }),
    nullable:         c.is_nullable === 'YES',
    is_foreign_key:   !!c.is_foreign_key,
    references_table: c.references_table || null,
  }
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
      columns: columns.map(c => describeColumnToField(primaryObject, c)),
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
    columns: columns.map(c => describeColumnToField(viaTable, c)),
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
    .select('rpt_selected_fields, rpt_primary_object')
    .eq('id', reportId)
    .eq('is_deleted', false)
    .single()
  if (error) return []
  // Headers are derived here too, so a dashboard widget's group-by and
  // measure dropdowns name the same fields the report's own columns do.
  return resolveReportColumnLabels(data?.rpt_selected_fields || [], {
    primaryObject: data?.rpt_primary_object,
    prefixFor:     guessPrefix,
  })
}

export async function loadReport(reportId) {
  if (!reportId || reportId === 'new') return null

  const [reportRes, filtersRes, groupingsRes, calcRes] = await Promise.all([
    // maybeSingle() — a zero-row result (soft-deleted or hidden by the reports
    // RLS read policy) must return null, not throw a PostgREST coercion error.
    // runReport() already handles a null load via its "Report not found" path,
    // and DashboardRunner catches that per-widget, so one inaccessible report
    // degrades to a single empty widget instead of blanking the dashboard.
    supabase.from('reports').select('*').eq('id', reportId).eq('is_deleted', false).maybeSingle(),
    supabase.from('report_filters').select('*').eq('rfilt_report_id', reportId).eq('is_deleted', false).order('rfilt_filter_index'),
    supabase.from('report_groupings').select('*').eq('rgr_report_id', reportId).eq('is_deleted', false).order('rgr_grouping_level'),
    supabase.from('report_calculated_fields').select('*').eq('rcf_report_id', reportId).eq('is_deleted', false).order('rcf_display_order'),
  ])

  if (reportRes.error) throw reportRes.error
  if (filtersRes.error) throw filtersRes.error
  if (groupingsRes.error) throw groupingsRes.error
  if (calcRes.error) throw calcRes.error

  if (!reportRes.data) return null

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
 * Salesforce-parity Save As / Clone. Calls the clone_report RPC which
 * copies the report row plus its filters, groupings, and calculated
 * fields into a new record owned by the caller. Returns the new id so
 * the UI can navigate the user to the freshly-cloned record (typically
 * straight into the Builder so they can rename and tweak before saving).
 *
 * Both name and folder are optional — the RPC defaults the name to
 * "<source name> (Clone)" and lands the new report in the source's
 * folder. Pass overrides when the user explicitly chose a destination.
 *
 * Throws if the source isn't found, isn't readable by the caller, or if
 * the caller can't write to reports / report_filters / report_groupings /
 * report_calculated_fields. Errors propagate verbatim from the RPC.
 */
export async function cloneReport(sourceReportId, { newName = null, newFolderId = null } = {}) {
  const { data, error } = await supabase.rpc('clone_report', {
    p_source_report_id: sourceReportId,
    p_new_name:         newName,
    p_new_folder_id:    newFolderId,
  })
  if (error) throw error
  if (!data) throw new Error('clone_report returned no id')
  return data
}

/**
 * Salesforce-parity Save As / Clone for dashboards. Calls the
 * clone_dashboard RPC which copies the dashboard row plus its widgets
 * and filters into a new record owned by the caller. Returns the new
 * id so the Editor can reload onto the cloned record.
 *
 * Symmetric to cloneReport — same defaults: name → "<source> (Clone)",
 * folder → source's folder. Caller becomes owner.
 */
export async function cloneDashboard(sourceDashboardId, { newName = null, newFolderId = null } = {}) {
  const { data, error } = await supabase.rpc('clone_dashboard', {
    p_source_dashboard_id: sourceDashboardId,
    p_new_name:            newName,
    p_new_folder_id:       newFolderId,
  })
  if (error) throw error
  if (!data) throw new Error('clone_dashboard returned no id')
  return data
}

/**
 * Salesforce-parity Save As / Clone for scheduled reports. Calls
 * clone_scheduled_report which copies the schedule but with two
 * intentional resets:
 *   • sr_is_active is always false on the clone (manual confirmation
 *     required before the clone starts firing)
 *   • sr_last_sent_at and sr_next_send_at are nulled (the clone has
 *     no send history; next_send_at is recomputed on first save)
 *
 * Returns the new schedule id so the Editor can reload onto the clone.
 */
export async function cloneScheduledReport(sourceScheduleId, { newName = null } = {}) {
  const { data, error } = await supabase.rpc('clone_scheduled_report', {
    p_source_schedule_id: sourceScheduleId,
    p_new_name:           newName,
  })
  if (error) throw error
  if (!data) throw new Error('clone_scheduled_report returned no id')
  return data
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
    rpt_row_limit:        report.rpt_row_limit || null,
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

  // Replace the child collections (filters / groupings / calculated fields)
  // atomically. The RPC soft-deletes the current set and re-inserts the new
  // set inside a SINGLE transaction, so a failed re-insert can never leave the
  // report with its children deleted (the delete rolls back with the insert).
  // Safe on a brand-new report too — the delete is a no-op when there are none.
  const { error: childErr } = await supabase.rpc('save_report_children', {
    p_report_id:         reportId,
    p_filters:           filters || [],
    p_groupings:         groupings || [],
    p_calculated_fields: calculatedFields || [],
  })
  if (childErr) throw childErr

  return reportId
}

/**
 * Build a runReportDefinition()-compatible "loaded" object from the report
 * builder's in-editor state, WITHOUT persisting. Mirrors saveReport's mapping
 * of the friendly builder shapes → the DB row shapes (rfilt_/rgr_/rcf_), minus
 * the bookkeeping columns, so a draft preview runs exactly as the saved report
 * would. This is what powers the builder's live (unsaved) preview.
 */
export function buildReportDefinition({ report, filters = [], groupings = [], calculatedFields = [] }) {
  return {
    report: { ...report },
    filters: (filters || []).map((f, idx) => ({
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
    })),
    groupings: (groupings || []).map((g, idx) => ({
      rgr_grouping_level:    idx + 1,
      rgr_field_name:        g.field_name,
      rgr_field_table:       g.field_table || null,
      rgr_field_via_path:    g.field_via_path || null,
      rgr_field_label:       g.field_label || null,
      rgr_sort_direction:    g.sort_direction || 'asc',
      rgr_sort_by_aggregate: g.sort_by_aggregate || null,
      rgr_show_subtotal:     g.show_subtotal !== false,
      rgr_date_granularity:  g.date_granularity || null,
      rgr_group_filter_op:   g.group_filter_op || null,
      rgr_group_filter_value: g.group_filter_value ?? null,
    })),
    calculatedFields: (calculatedFields || []).map((c, idx) => ({
      rcf_label:          c.label,
      rcf_scope:          c.scope || 'row',
      rcf_expression:     c.expression,
      rcf_data_type:      c.data_type || 'number',
      rcf_format_options: c.format_options || {},
      rcf_display_order:  idx,
      rcf_grouping_level: c.grouping_level || null,
    })),
  }
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
    const fieldSet = byObject.get(p.object)
    fieldSet.add(p.field)
    // picklist_field naming is inconsistent across objects: some rows use
    // the full column name (property_status), others the prefix-stripped
    // field (record_type). Query both spellings so either resolves —
    // without this, accounts.account_record_type never finds its labels.
    const prefix = guessPrefix(p.object)
    if (prefix && p.field.startsWith(prefix + '_')) {
      fieldSet.add(p.field.slice(prefix.length + 1))
    }
  }
  for (const [object, fields] of byObject) {
    const { data, error } = await supabase
      .from('picklist_values')
      .select('id, picklist_field, picklist_value, picklist_label, picklist_sort_order')
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
        // Carried so grouped reports can order picklist groups by the
        // picklist's defined order (Salesforce parity) instead of alphabetically.
        sort_order: row.picklist_sort_order,
      })
    }
  }
  return map
}

/**
 * For a given (primaryTable, columnName), return the set of selectable
 * filter values, or null when the column should stay free-text.
 *
 *   - Picklist / record-type column (FK → picklist_values): returns the
 *     active picklist values for this (object=table, field=column) pair,
 *     each as { value: picklist_values.id, label, secondary }. The id is
 *     stored because evalFilterOnRow compares against the raw row value,
 *     which is the UUID.
 *   - FK → a real table with a known name column: returns up to a cap of
 *     referenced records as { value: id, label: <name column> }.
 *   - Anything else (text, number, date, boolean, unknown FK): returns null
 *     so the caller falls back to a free-text combo.
 *
 * Returns { kind: 'picklist'|'fk'|null, options: [...] }.
 */
export async function loadFilterValueOptions(primaryTable, columnName) {
  if (!primaryTable || !columnName) return { kind: null, options: [] }
  const cols = await describeColumns(primaryTable)
  const col = cols.find(c => c.column_name === columnName)
  if (!col) return { kind: null, options: [] }

  // Boolean → fixed true/false options.
  if (col.data_type === 'boolean') {
    return { kind: 'fk', options: [
      { value: 'true',  label: 'True' },
      { value: 'false', label: 'False' },
    ] }
  }

  if (col.is_foreign_key && col.references_table === 'picklist_values') {
    // picklist_object is the full table name. picklist_field equals the
    // column name for most picklists (e.g. opportunity_status), but the
    // record-type column maps to the bare 'record_type' key. Query the
    // candidate keys so both conventions resolve.
    const fieldKeys = [columnName]
    if (/(^|_)record_type$/.test(columnName)) fieldKeys.push('record_type')
    const { data, error } = await supabase
      .from('picklist_values')
      .select('id, picklist_value, picklist_label, picklist_sort_order, picklist_is_active')
      .eq('picklist_object', primaryTable)
      .in('picklist_field', fieldKeys)
      .eq('picklist_is_active', true)
      .order('picklist_sort_order', { ascending: true })
    if (error) { console.warn('picklist value options load failed:', error.message); return { kind: null, options: [] } }
    const options = (data || []).map(r => ({
      value: r.id,
      label: r.picklist_label || r.picklist_value,
      secondary: r.picklist_value && r.picklist_label && r.picklist_value !== r.picklist_label ? r.picklist_value : undefined,
    }))
    return { kind: 'picklist', options }
  }

  if (col.is_foreign_key && col.references_table) {
    const candidates = TABLE_NAME_COLUMNS[col.references_table]
    if (!candidates) return { kind: null, options: [] }
    const refCols = await describeColumns(col.references_table)
    const nameCol = candidates.find(n => refCols.some(rc => rc.column_name === n))
    if (!nameCol) return { kind: null, options: [] }
    // Cap the referenced-record list — these can be large. The combo filters
    // client-side over whatever we load; 500 covers configuration-style FKs
    // (programs, territories, record types). For very large reference tables
    // (e.g. properties) the user can still type the underlying id verbatim
    // via the free-text fallback if their target isn't in the first 500.
    const softDeleteCol = refCols.find(rc => rc.column_name === 'is_deleted')
      ? 'is_deleted'
      : (refCols.find(rc => rc.column_name.endsWith('_is_deleted'))?.column_name || null)
    let q = supabase.from(col.references_table).select(`id, ${nameCol}`).limit(500)
    if (softDeleteCol) q = q.eq(softDeleteCol, false)
    q = q.order(nameCol, { ascending: true })
    const { data, error } = await q
    if (error) { console.warn('FK value options load failed:', error.message); return { kind: null, options: [] } }
    const options = (data || []).map(r => ({ value: r.id, label: r[nameCol] != null ? String(r[nameCol]) : '(unnamed)' }))
    return { kind: 'fk', options }
  }

  return { kind: null, options: [] }
}


/**
 * Apply a filter-logic expression (e.g. '1 AND (2 OR 3)') to a row set
 * client-side. Each filter row is evaluated per row, indexed by
 * rfilt_filter_index, and combined by the parsed expression.
 *
 * Used whenever the report's logic isn't a plain AND of every filter —
 * AND-only reports push their filters to PostgREST and skip this path.
 * Operator semantics come from lib/reportFilters so the client-side result
 * matches the server-side pushdown exactly.
 */
function applyFilterLogic(rows, filters, expression, fkLookup, primaryObject) {
  const fieldFilters = (filters || []).filter(f => !f.rfilt_is_cross_filter)
  const parsed = parseFilterLogic(expression, (filters || []).length)
  if (!parsed.ok) throw new Error(`Filter logic: ${parsed.error}`)
  if (parsed.isAll || !parsed.rpn) {
    return rows.filter(row => fieldFilters.every(f => evalFilterOnRow(f, row, fkLookup, primaryObject)))
  }

  const filterByIdx = new Map()
  for (const f of (filters || [])) filterByIdx.set(f.rfilt_filter_index, f)

  return rows.filter(row => evaluateLogic(parsed.rpn, (idx) => {
    const f = filterByIdx.get(idx)
    if (!f) return false
    // Cross-filters were already applied as row-set intersections before
    // this point; inside the logic expression they read as satisfied so a
    // reference to one doesn't wipe out the whole clause.
    if (f.rfilt_is_cross_filter) return true
    return evalFilterOnRow(f, row, fkLookup, primaryObject)
  }))
}

function evalFilterOnRow(f, row, fkLookup, primaryObject) {
  if (!f.rfilt_field_name || !f.rfilt_operator) return true

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

  const kind = filterFieldKind(f, fkLookup, primaryObject)
  // An incomplete filter (no value chosen yet) matches everything, so a
  // half-built filter in the live preview never blanks the result set.
  if (filterIsIncomplete(kind, f.rfilt_operator, f.rfilt_value)) return true
  return evaluateOperator(v, f.rfilt_operator, f.rfilt_value, kind)
}

/**
 * The field kind (text / number / date / picklist / lookup / boolean) a
 * filter compares against, resolved from the FK lookup when the column is a
 * foreign key and from the cached column metadata otherwise.
 */
function filterFieldKind(f, fkLookup, primaryObject) {
  const table = (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0)
    ? (f.rfilt_field_table || null)
    : primaryObject
  if (table) {
    const fkInfo = fkLookup?.[`${table}.${f.rfilt_field_name}`]
    if (fkInfo) return fkInfo.is_picklist ? 'picklist' : 'lookup'
    const cols = _columnsCache.get(table)
    const col = cols?.find(c => c.column_name === f.rfilt_field_name)
    if (col) return fieldKindFor({ type: col.data_type, is_foreign_key: col.is_foreign_key, references_table: col.references_table })
  }
  return isDateLiteral(f.rfilt_value) ? 'date' : 'text'
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
/**
 * Push one filter down to PostgREST. Shared by the report's own filters and
 * by cross-filter sub-filters, so both honour the same operator vocabulary:
 * multi-value equals ("is any of"), between, does-not-contain, and relative
 * date literals (TODAY / LAST_N_DAYS:90 / THIS_QUARTER …).
 *
 * `kind` steers date handling; pass null when the column's kind is unknown
 * and it will be inferred from the value itself.
 */
function applySimpleFilter(query, fieldName, operator, value, kind = null) {
  const quoteList = (list) => `(${list.map(x => `"${String(x).replace(/"/g, '\\"')}"`).join(',')})`
  const dateish = kind === 'date' || kind === 'datetime' || isDateLiteral(value) ||
    (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value))

  switch (operator) {
    case 'equals':
    case 'not_equals': {
      const negate = operator === 'not_equals'
      if (dateish) {
        const range = resolveDateBound(value, new Date())
        if (!range) return query
        // A ranged equality can't be negated in one PostgREST clause — the
        // client-side pass handles the negative case.
        if (negate) return query.or(`${fieldName}.lt.${range.start},${fieldName}.gte.${range.end}`)
        return query.gte(fieldName, range.start).lt(fieldName, range.end)
      }
      const list = Array.isArray(value) ? toValueArray(value) : null
      if (list) {
        if (list.length === 0) return query
        if (list.length === 1) return negate ? query.neq(fieldName, list[0]) : query.eq(fieldName, list[0])
        return negate ? query.not(fieldName, 'in', quoteList(list)) : query.in(fieldName, list)
      }
      return negate ? query.neq(fieldName, value) : query.eq(fieldName, value)
    }
    case 'greater_than':
    case 'greater_or_equal':
    case 'less_than':
    case 'less_or_equal': {
      if (dateish) {
        const range = resolveDateBound(value, new Date())
        if (!range) return query
        switch (operator) {
          case 'greater_than':     return query.gte(fieldName, range.end)
          case 'greater_or_equal': return query.gte(fieldName, range.start)
          case 'less_than':        return query.lt(fieldName, range.start)
          case 'less_or_equal':    return query.lt(fieldName, range.end)
          default: return query
        }
      }
      switch (operator) {
        case 'greater_than':     return query.gt(fieldName, value)
        case 'greater_or_equal': return query.gte(fieldName, value)
        case 'less_than':        return query.lt(fieldName, value)
        case 'less_or_equal':    return query.lte(fieldName, value)
        default: return query
      }
    }
    case 'between': {
      const arr = Array.isArray(value) ? value : []
      const loRaw = arr[0], hiRaw = arr[1]
      if (dateish || isDateLiteral(loRaw) || isDateLiteral(hiRaw)) {
        const lo = resolveDateBound(loRaw, new Date())
        const hi = resolveDateBound(hiRaw, new Date())
        if (lo) query = query.gte(fieldName, lo.start)
        if (hi) query = query.lt(fieldName, hi.end)
        return query
      }
      if (loRaw != null && loRaw !== '') query = query.gte(fieldName, loRaw)
      if (hiRaw != null && hiRaw !== '') query = query.lte(fieldName, hiRaw)
      return query
    }
    case 'in':
      return query.in(fieldName, toValueArray(value))
    case 'not_in':
      return query.not(fieldName, 'in', quoteList(toValueArray(value)))
    case 'contains':         return query.ilike(fieldName, `%${value}%`)
    case 'does_not_contain': return query.not(fieldName, 'ilike', `%${value}%`)
    case 'starts_with':      return query.ilike(fieldName, `${value}%`)
    case 'ends_with':        return query.ilike(fieldName, `%${value}`)
    case 'is_null':          return query.is(fieldName, null)
    case 'is_not_null':      return query.not(fieldName, 'is', null)
    case 'in_last_n_days': {
      const range = resolveDateLiteral(`LAST_N_DAYS:${parseInt(value, 10) || 0}`, new Date())
      return range ? query.gte(fieldName, range.start).lt(fieldName, range.end) : query
    }
    case 'this_month':
    case 'this_year': {
      const range = resolveDateLiteral(operator === 'this_month' ? 'THIS_MONTH' : 'THIS_YEAR', new Date())
      return query.gte(fieldName, range.start).lt(fieldName, range.end)
    }
    default:
      console.warn(`Unsupported report filter operator: ${operator}`)
      return query
  }
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
export async function runReport(reportId, promptValues = null, extraFilters = null, overrideFields = null) {
  const loaded = await loadReport(reportId)
  if (!loaded) throw new Error('Report not found')
  return runReportDefinition(loaded, { promptValues, extraFilters, overrideFields, reportId })
}

/**
 * Run a report from an already-loaded definition — the loadReport shape:
 * { report, filters, groupings, calculatedFields }. runReport is now a thin
 * wrapper that loads then calls this.
 *
 * Exposing it lets the report builder preview UNSAVED edits: build a
 * loaded-shaped object from the in-editor config and run it without persisting.
 * `reportId` is optional — when present the run is recorded as the report's
 * Last Run; when absent (a draft preview) nothing is written back.
 */
export async function runReportDefinition(loaded, { promptValues = null, extraFilters = null, overrideFields = null, reportId = null } = {}) {
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

  // Columns the caller (e.g. a dashboard filter bar) owns outright override
  // the report's own saved filter on the same column: the caller's value —
  // or its absence ("All" → no extra filter) — is authoritative, so strip
  // the report's stored filter for those columns before appending extras.
  // Without this, a report whose stored filter is `property_state = NC`
  // stays pinned to NC even when the dashboard STATE control is set to
  // "All", because the two filters get ANDed instead of replaced.
  // Cross-filters (no plain field_name) are left untouched.
  if (overrideFields && overrideFields.length > 0) {
    const ov = new Set(overrideFields)
    loaded.filters = (loaded.filters || []).filter(
      f => f.rfilt_is_cross_filter || !ov.has(f.rfilt_field_name)
    )
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
  // Related tables come from anywhere the report reaches across a via_path:
  // selected fields, filters, and groupings alike — a filter or grouping on a
  // related object needs the same FK/picklist metadata a column does.
  const relatedTables = new Set()
  for (const f of (r.rpt_selected_fields || [])) {
    if (f.via_path && f.via_path.length > 0 && f.table) relatedTables.add(f.table)
  }
  for (const f of (loaded.filters || [])) {
    if (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0 && f.rfilt_field_table) {
      relatedTables.add(f.rfilt_field_table)
    }
  }
  for (const g of (loaded.groupings || [])) {
    if (g.rgr_field_via_path && g.rgr_field_via_path.length > 0 && g.rgr_field_table) {
      relatedTables.add(g.rgr_field_table)
    }
  }
  const fkLookup = await buildFKLookup(r.rpt_primary_object, Array.from(relatedTables))

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
      // `id` on every embedded object: a related record's name cell is a
      // link to that record, and the link needs the record it points at.
      if (!node.fields.includes('id')) node.fields.push('id')
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
  // Grouping columns. A report can group by a field it doesn't display, so
  // each direct grouping column is pulled explicitly — and, when it's a
  // lookup FK, its name-label embed comes along too. Without that embed a
  // "group by Property" header would read as a bare UUID.
  for (const g of (loaded.groupings || [])) {
    if (g.rgr_field_via_path && g.rgr_field_via_path.length > 0) continue
    if (!g.rgr_field_name) continue
    if (!selectParts.includes(g.rgr_field_name)) selectParts.push(g.rgr_field_name)
    const fkInfo = fkLookup[`${r.rpt_primary_object}.${g.rgr_field_name}`]
    const alias = `_lbl_${g.rgr_field_name}`
    if (fkInfo?.name_column && !selectParts.some(p => p.startsWith(`${alias}:`))) {
      selectParts.push(`${alias}:${g.rgr_field_name}(${fkInfo.name_column})`)
    }
  }
  // Matrix column groupings get the same treatment.
  for (const cg of (r.rpt_column_groupings || [])) {
    const name = typeof cg === 'string' ? cg : (cg?.name || cg?.field_name)
    if (!name || (cg?.via_path && cg.via_path.length > 0)) continue
    if (!selectParts.includes(name)) selectParts.push(name)
    const fkInfo = fkLookup[`${r.rpt_primary_object}.${name}`]
    const alias = `_lbl_${name}`
    if (fkInfo?.name_column && !selectParts.some(p => p.startsWith(`${alias}:`))) {
      selectParts.push(`${alias}:${name}(${fkInfo.name_column})`)
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

  // Filter pushdown. A report whose logic is a plain AND of every filter
  // pushes its filters to PostgREST; anything with OR / NOT / parentheses is
  // pulled back and evaluated client-side against the same operator
  // semantics (lib/reportFilters), because PostgREST can't express a mixed
  // AND/OR tree in one request.
  const logicExpression = (r.rpt_filter_logic || 'all').trim()
  const pushDownFilters = logicIsPlainAnd(logicExpression, (loaded.filters || []).length)

  if (pushDownFilters) {
    for (const f of (loaded.filters || [])) {
      if (f.rfilt_is_cross_filter) continue  // applied as a row-set intersection below
      if (!f.rfilt_field_name || !f.rfilt_operator) continue
      const kind = filterFieldKind(f, fkLookup, r.rpt_primary_object)
      // Skip filters the user hasn't finished authoring rather than
      // querying for an empty value and returning nothing.
      if (filterIsIncomplete(kind, f.rfilt_operator, f.rfilt_value)) continue
      const col = (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0)
        ? `${f.rfilt_field_via_path[0]}.${f.rfilt_field_name}`
        : f.rfilt_field_name
      query = applySimpleFilter(query, col, f.rfilt_operator, f.rfilt_value, kind)
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

  // Client-side evaluation for anything the pushdown couldn't express
  // (OR / NOT / parentheses). The row set here is the soft-delete- and
  // cross-filter-scoped superset, so the expression sees every candidate.
  if (!pushDownFilters && data && (loaded.filters || []).length > 0) {
    data = applyFilterLogic(data, loaded.filters || [], logicExpression, fkLookup, r.rpt_primary_object)
  }

  // Top-N row limit — cap the returned rows after all filtering + sort
  // (Salesforce "Row Limit"). NULL/0 = no cap.
  const rowLimit = parseInt(r.rpt_row_limit, 10)
  if (Number.isFinite(rowLimit) && rowLimit > 0 && data && data.length > rowLimit) {
    data = data.slice(0, rowLimit)
    truncated = true
  }

  // Picklist label resolution — second pass. Every field the report renders
  // as a picklist FK gets its label rows batch-fetched: selected columns,
  // row groupings, AND matrix column groupings. Groupings were the gap that
  // made "Opportunities by Stage" print raw picklist UUIDs in its group
  // headers while the same column rendered its label in the detail rows.
  const tableForField = (table, viaPath) =>
    (viaPath && viaPath.length > 0) ? table : r.rpt_primary_object
  const isPicklistField = (name, table, viaPath) => {
    const fieldTable = tableForField(table, viaPath)
    return !!(fieldTable && name && fkLookup[`${fieldTable}.${name}`]?.is_picklist)
  }

  const picklistPairs = []
  for (const f of (r.rpt_selected_fields || [])) {
    if (isPicklistField(f.name, f.table, f.via_path)) {
      picklistPairs.push({ object: tableForField(f.table, f.via_path), field: f.name })
    }
  }
  for (const g of (loaded.groupings || [])) {
    if (isPicklistField(g.rgr_field_name, g.rgr_field_table, g.rgr_field_via_path)) {
      picklistPairs.push({ object: tableForField(g.rgr_field_table, g.rgr_field_via_path), field: g.rgr_field_name })
    }
  }
  for (const cg of (r.rpt_column_groupings || [])) {
    const name = typeof cg === 'string' ? cg : (cg?.name || cg?.field_name)
    if (isPicklistField(name, cg?.table, cg?.via_path)) {
      picklistPairs.push({ object: tableForField(cg?.table, cg?.via_path), field: name })
    }
  }
  let picklistMap = new Map()
  if (picklistPairs.length > 0) {
    picklistMap = await loadPicklistLabels(picklistPairs)
  }

  // Mark this report as run for "Last Run" display — only for a real saved
  // report. Skipped for an unsaved draft preview (reportId null), which must
  // not write anything back.
  if (reportId) {
    const userId = await getCurrentUserId()
    await supabase.from('reports').update({
      rpt_last_run_at: new Date().toISOString(),
      rpt_last_run_by: userId,
    }).eq('id', reportId)
  }

  // Column headers are DERIVED, not read back from what was saved: the
  // stored label on a field selected before 2026-08-25 is the object's
  // prefix-stripped column name, which is how a report showing a property's,
  // a building's and an opportunity's name came to head all three "Name".
  // A label a person wrote by hand is detected and kept (isDerivedLabel).
  const labelOpts = { primaryObject: r.rpt_primary_object, prefixFor: guessPrefix }
  const labelledColumns = resolveReportColumnLabels(r.rpt_selected_fields || [], labelOpts)

  return {
    rows: data || [],
    columns: labelledColumns.map(f => ({
      ...f,
      // Mark picklist columns so getRowValue knows to look up the
      // label — works for direct fields AND fields reached via_path.
      _is_picklist: isPicklistField(f.name, f.table, f.via_path),
      // Where this cell's record lives, when the cell IS a record: a lookup
      // column on the primary object points at the record it references, and
      // a related object's own name column points at that related record.
      _link: recordLinkForField(f, r.rpt_primary_object, fkLookup, { prefixFor: guessPrefix }),
    })),
    picklistMap,
    // Groupings carry `name`/`via_path`/`_is_picklist` as well as their
    // rgr_-derived names so a grouping is itself a valid field descriptor
    // for getRowValue — that is what resolves picklist and lookup group
    // headers to labels instead of UUIDs.
    groupings: (loaded.groupings || []).map(g => ({
      field_name:        g.rgr_field_name,
      field_label:       groupingLabel(g, r.rpt_primary_object),
      field_table:       g.rgr_field_table,
      field_via_path:    g.rgr_field_via_path,
      name:              g.rgr_field_name,
      via_path:          g.rgr_field_via_path,
      _is_picklist:      isPicklistField(g.rgr_field_name, g.rgr_field_table, g.rgr_field_via_path),
      sort_direction:    g.rgr_sort_direction,
      sort_by_aggregate: g.rgr_sort_by_aggregate,
      group_filter_op:    g.rgr_group_filter_op,
      group_filter_value: g.rgr_group_filter_value,
      show_subtotal:     g.rgr_show_subtotal,
      date_granularity:  g.rgr_date_granularity,
    })),
    columnGroupings: (r.rpt_column_groupings || []).map(cg => {
      const name = typeof cg === 'string' ? cg : (cg?.name || cg?.field_name)
      const base = typeof cg === 'string' ? {} : { ...cg }
      return {
        ...base,
        name,
        label: groupingLabel({
          rgr_field_name:     name,
          rgr_field_table:    base.table,
          rgr_field_via_path: base.via_path,
          rgr_field_label:    base.label,
        }, r.rpt_primary_object),
        via_path: base.via_path || null,
        _is_picklist: isPicklistField(name, base.table, base.via_path),
      }
    }),
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
 * A grouping's header. Same rule the columns follow: derived unless a person
 * wrote the label, so "Group by Property" never reads "Group by Name".
 */
function groupingLabel(g, primaryObject) {
  const descriptor = {
    name:     g.rgr_field_name,
    table:    g.rgr_field_table,
    via_path: g.rgr_field_via_path,
  }
  const opts = { primaryObject, prefixFor: guessPrefix }
  const stored = g.rgr_field_label
  if (stored && !isDerivedLabel(stored, descriptor, opts)) return stored
  return deriveReportColumnLabel(descriptor, opts)
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
    // maybeSingle() — NOT single(). A zero-row result here is a legitimate
    // outcome (row soft-deleted, or hidden from this user by the dashboards
    // RLS read policy), not an exception. single() throws a PostgREST coercion
    // error on zero rows, which previously propagated up and blanked the entire
    // home screen when the embedded home dashboard wasn't readable. We surface a
    // typed, catchable error instead so the renderer shows an empty-state card.
    supabase.from('dashboards').select('*').eq('id', dashboardId).eq('is_deleted', false).maybeSingle(),
    supabase.from('dashboard_widgets').select('*').eq('dw_dashboard_id', dashboardId).eq('is_deleted', false).order('dw_position_row').order('dw_position_col'),
    supabase.from('dashboard_filters').select('*').eq('dfilt_dashboard_id', dashboardId).eq('is_deleted', false).order('dfilt_display_order'),
  ])
  if (dashRes.error)    throw dashRes.error
  if (widgetsRes.error) throw widgetsRes.error
  if (filtersRes.error) throw filtersRes.error
  if (!dashRes.data) {
    const e = new Error('Dashboard not found or not accessible')
    e.code = 'DASHBOARD_NOT_VISIBLE'
    throw e
  }
  return {
    dashboard: dashRes.data,
    widgets:   widgetsRes.data || [],
    filters:   filtersRes.data || [],
  }
}

/**
 * Resolve the selectable options for a dashboard filter.
 *
 * dfilt_options may be:
 *   - null/undefined        → no options (runner renders a free-text input)
 *   - a plain array         → static option list, passed through as-is
 *   - { source:'distinct',  → dynamic: distinct, non-deleted, non-blank values
 *       object, field }       of object.field, ordered most-common-first, via the
 *                             dashboard_filter_distinct_values RPC. Self-maintaining:
 *                             the dropdown only ever shows values that actually
 *                             exist in records, with no hardcoded list to update.
 *
 * Returns an array of { value, label } (label === value for distinct sources).
 * On any RPC error returns [] so the runner degrades to a text input rather
 * than blanking the filter bar.
 */
export async function fetchFilterOptions(filter) {
  const opts = filter?.dfilt_options
  if (!opts) return []

  // Static array form: ["NC","WI",...] or [{value,label},...]
  if (Array.isArray(opts)) {
    return opts.map(o =>
      (o && typeof o === 'object')
        ? { value: o.value, label: o.label ?? o.value }
        : { value: o, label: o }
    )
  }

  if (opts.source === 'distinct' && opts.object && opts.field) {
    const { data, error } = await supabase.rpc('dashboard_filter_distinct_values', {
      p_object: opts.object,
      p_field:  opts.field,
      p_limit:  opts.limit ?? 200,
    })
    if (error) { console.warn('fetchFilterOptions distinct failed:', error.message); return [] }
    return (data || []).map(r => ({ value: r.value, label: r.value }))
  }

  return []
}

/**
 * Server-side aggregation fast path for dashboard widgets.
 *
 * Calls the report_aggregate RPC, which does a real SQL GROUP BY and
 * returns ~N grouped rows ({label, value, raw_value}) instead of
 * paginating thousands of detail rows into the browser. Used by
 * DashboardRunner for group-by widget types (bar/pie/donut/funnel/
 * ranked_list). Returns the grouped data plus the report's primary
 * object; the widget renders it directly via the result.aggregated
 * branch in buildChartData.
 *
 * Resolves the widget's backing report to get the primary object and
 * its saved filters (including the state runtime prompt's default),
 * merges any dashboard-level extraFilters whose column exists on the
 * primary object, and translates them into the RPC's {col, op, val}
 * filter shape. On any failure the caller falls back to runReport.
 */
// Shared context for every aggregate fast path: resolves the widget's report
// to its primary object and translates report + dashboard filters into the
// RPC {col, op, val} shape (dashboard filter columns override same-column
// report filters — see runReport for the rationale).
async function buildWidgetAggregateContext(widget, extraFilters = null, overrideFields = null) {
  const loaded = await loadReport(widget.dw_report_id)
  if (!loaded) throw new Error('Report not found')
  const primaryObject = loaded.report.rpt_primary_object

  // Real columns on the primary object — used to drop filters that don't apply.
  const primaryCols = await describeColumns(primaryObject)
  const colNames = new Set(primaryCols.map(c => c.column_name))
  const ov = new Set(overrideFields || [])

  // Translate a report_filter / extraFilter operator into the RPC's op set.
  const opMap = {
    equals: 'equals', not_equals: 'not_equals',
    greater_than: 'gt', less_than: 'lt',
    greater_or_equal: 'gte', less_or_equal: 'lte',
    is_null: 'is_null', is_not_null: 'is_not_null',
    in: 'in',
  }

  const filters = []
  for (const f of (loaded.report ? (loaded.filters || []) : [])) {
    if (f.rfilt_is_cross_filter) continue
    if (ov.has(f.rfilt_field_name)) continue   // dashboard controls this column
    if (!colNames.has(f.rfilt_field_name)) continue
    const op = opMap[f.rfilt_operator]
    if (!op) continue
    let val = f.rfilt_value
    if (val && typeof val === 'object' && 'value' in val) val = val.value
    filters.push({ col: f.rfilt_field_name, op, val })
  }
  for (const ef of (extraFilters || [])) {
    if (!colNames.has(ef.field_name)) continue
    const op = opMap[ef.operator || 'equals'] || 'equals'
    filters.push({ col: ef.field_name, op, val: ef.value })
  }

  return { primaryObject, filters, reportName: loaded.report.rpt_name }
}

export async function runWidgetAggregate(widget, extraFilters = null, overrideFields = null) {
  const cfg = widget.dw_widget_config || {}
  const groupCol = cfg.group_by
  if (!groupCol) throw new Error('Widget has no group_by; cannot aggregate')
  const { primaryObject, filters, reportName } = await buildWidgetAggregateContext(widget, extraFilters, overrideFields)

  const { data, error } = await supabase.rpc('report_aggregate', {
    p_primary_object: primaryObject,
    p_group_col:      groupCol,
    p_measure_type:   cfg.measure_type || 'count',
    p_measure_field:  cfg.measure_field || null,
    p_filters:        filters,
    p_sort:           cfg.sort_by || 'value_desc',
    p_limit:          cfg.limit || 100,
  })
  if (error) throw error

  // Shape into the {name, value, rawValue, groupCol} rows buildChartData
  // emits, attached as result.aggregated so the widget short-circuits.
  const aggregated = (data || []).map(row => ({
    name:     row.label,
    value:    Number(row.value) || 0,
    rawValue: row.raw_value,
    groupCol,
  }))

  return { aggregated, primaryObject, name: reportName }
}

// Category × series pivot (stacked / clustered / 100% bars, heatmap, matrix).
export async function runWidgetAggregate2D(widget, extraFilters = null, overrideFields = null) {
  const cfg = widget.dw_widget_config || {}
  if (!cfg.group_by || !cfg.series_by) throw new Error('Widget needs group_by and series_by')
  const { primaryObject, filters, reportName } = await buildWidgetAggregateContext(widget, extraFilters, overrideFields)

  const { data, error } = await supabase.rpc('report_aggregate_2d', {
    p_primary_object: primaryObject,
    p_group_col:      cfg.group_by,
    p_series_col:     cfg.series_by,
    p_measure_type:   cfg.measure_type || 'count',
    p_measure_field:  cfg.measure_field || null,
    p_filters:        filters,
    p_limit:          500,
  })
  if (error) throw error
  // Rows arrive ordered by group total desc. Keep raw rows; the renderer
  // pivots them (group list order = first appearance).
  const aggregated2d = (data || []).map(r => ({
    name: r.label, series: r.series, value: Number(r.value) || 0,
    rawValue: r.raw_value, rawSeries: r.raw_series,
  }))
  return { aggregated2d, groupCol: cfg.group_by, seriesCol: cfg.series_by, primaryObject, name: reportName }
}

// Time-bucketed aggregate (real time-axis line/area, sparklines).
export async function runWidgetAggregateTime(widget, extraFilters = null, overrideFields = null) {
  const cfg = widget.dw_widget_config || {}
  if (!cfg.date_field) throw new Error('Widget needs date_field')
  const { primaryObject, filters, reportName } = await buildWidgetAggregateContext(widget, extraFilters, overrideFields)

  const { data, error } = await supabase.rpc('report_aggregate_time', {
    p_primary_object: primaryObject,
    p_date_col:       cfg.date_field,
    p_grain:          cfg.date_grain || 'month',
    p_measure_type:   cfg.measure_type || 'count',
    p_measure_field:  cfg.measure_field || null,
    p_filters:        filters,
    p_series_col:     cfg.series_by || null,
    p_limit:          500,
  })
  if (error) throw error
  const aggregatedTime = (data || []).map(r => ({
    bucket: r.bucket, name: r.label, series: r.series,
    value: Number(r.value) || 0, rawSeries: r.raw_series,
  }))
  return { aggregatedTime, dateCol: cfg.date_field, seriesCol: cfg.series_by || null, primaryObject, name: reportName }
}

// One aggregate, no grouping — metric/gauge/KPI without pulling every row.
export async function runWidgetAggregateSingle(widget, extraFilters = null, overrideFields = null) {
  const cfg = widget.dw_widget_config || {}
  const { primaryObject, filters, reportName } = await buildWidgetAggregateContext(widget, extraFilters, overrideFields)

  const { data, error } = await supabase.rpc('report_aggregate_single', {
    p_primary_object: primaryObject,
    p_measure_type:   cfg.measure_type || 'count',
    p_measure_field:  cfg.measure_field || null,
    p_filters:        filters,
  })
  if (error) throw error
  return { aggregatedSingle: Number(data) || 0, primaryObject, name: reportName }
}

// The query shape each widget type wants. 'rows' (and anything unlisted)
// means the full runReport row fetch. Kept here so DashboardRunner and
// LiveWidgetPreview route identically.
export const WIDGET_QUERY_SHAPES = {
  bar: 'agg', line: 'agg', pie: 'agg', donut: 'agg', funnel: 'agg', pyramid: 'agg',
  ranked_list: 'agg', treemap: 'agg', waterfall: 'agg', multi_row_card: 'agg',
  pareto: 'agg', rose: 'agg',
  stacked_bar: 'agg2d', clustered_bar: 'agg2d', stacked_bar_100: 'agg2d', heatmap: 'agg2d',
  matrix: 'agg2d', sankey: 'agg2d', radar: 'agg2d', sunburst: 'agg2d',
  area: 'time', calendar_heatmap: 'time', stat: 'stat',
  metric: 'single', gauge: 'single', kpi: 'single', rating: 'single',
  speedometer: 'single', bullet: 'single', progress_ring: 'single',
  combo: 'combo',
  table: 'rows', scatter: 'rows', histogram: 'rows', box_plot: 'rows',
  filter_picklist: 'filter', filter_toggle: 'filter', filter_date_range: 'filter',
  heading: 'none', rich_text: 'none', spacer: 'none', image: 'none', link: 'none',
}

// Route a widget to its fast path, falling back to the full row fetch when the
// shape's required config is missing or the fast path fails — a degraded-but-
// correct result, never a blank widget.
export async function runWidgetData(widget, extraFilters = null, overrideFields = null) {
  const cfg = widget.dw_widget_config || {}
  const shape = WIDGET_QUERY_SHAPES[widget.dw_widget_type] || 'rows'
  // Content widgets (heading, rich text, spacer, image) carry no report at
  // all — hand back a truthy stub so tiles render without a fetch.
  if (shape === 'none') return { none: true }
  const rows = () => runReport(widget.dw_report_id, null, extraFilters, overrideFields)
  try {
    switch (shape) {
      case 'agg':
        if (!cfg.group_by) return await rows()
        return await runWidgetAggregate(widget, extraFilters, overrideFields)
      case 'agg2d':
        if (!cfg.group_by || !cfg.series_by) return await rows()
        return await runWidgetAggregate2D(widget, extraFilters, overrideFields)
      case 'time':
        if (!cfg.date_field) return await rows()
        return await runWidgetAggregateTime(widget, extraFilters, overrideFields)
      case 'single':
        // A metric scoped by group_by + filter_value keeps the row path (its
        // scoping matches labels as well as raw values — client-side logic).
        if (widget.dw_widget_type === 'metric' && cfg.group_by && cfg.filter_value) return await rows()
        return await runWidgetAggregateSingle(widget, extraFilters, overrideFields)
      case 'stat': {
        // Big number + sparkline: single aggregate for the number, time
        // buckets for the trend (when a date field is configured).
        const single = await runWidgetAggregateSingle(widget, extraFilters, overrideFields)
        if (!cfg.date_field) return single
        try {
          const t = await runWidgetAggregateTime(widget, extraFilters, overrideFields)
          return { ...single, aggregatedTime: t.aggregatedTime }
        } catch { return single }
      }
      case 'combo': {
        // Two measures over the same grouping: the primary aggregate renders
        // as bars, the secondary (measure2_*) as a line, merged by label.
        if (!cfg.group_by) return await rows()
        const primary = await runWidgetAggregate(widget, extraFilters, overrideFields)
        if (!cfg.measure2_type) return primary
        const w2 = { ...widget, dw_widget_config: {
          ...cfg, measure_type: cfg.measure2_type, measure_field: cfg.measure2_field || null,
        } }
        const second = await runWidgetAggregate(w2, extraFilters, overrideFields)
        return { ...primary, aggregatedSecondary: second.aggregated }
      }
      case 'filter': {
        // On-canvas filter widget: its "data" is the distinct-value option
        // list for the configured field (date-range filters need none).
        const { primaryObject, reportName } = await buildWidgetAggregateContext(widget, null, null)
        if (widget.dw_widget_type === 'filter_date_range' || !cfg.filter_field) {
          return { filterOptions: [], primaryObject, name: reportName }
        }
        const { data, error } = await supabase.rpc('dashboard_filter_distinct_values', {
          p_object: primaryObject, p_field: cfg.filter_field, p_limit: 200,
        })
        // A failed option fetch degrades to an empty list (free-text-less
        // filter), never to the full-report row fallback.
        return {
          filterOptions: error ? [] : (data || []).map(r => ({ value: r.value, label: r.value })),
          primaryObject, name: reportName,
        }
      }
      default:
        return await rows()
    }
  } catch {
    return await rows()
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

  // Replace widgets + filters atomically. The RPC soft-deletes the current set
  // and re-inserts the new set in ONE transaction (widget position row/col are
  // recomputed server-side from array order + column count, exactly as before),
  // so a failed re-insert can never leave the dashboard with its widgets
  // deleted. Safe on a new dashboard — the delete is a no-op with no children.
  const { error: childErr } = await supabase.rpc('save_dashboard_children', {
    p_dashboard_id: dashId,
    p_widgets:      widgets || [],
    p_filters:      filters || [],
    p_columns:      dashboard.dash_columns || 3,
  })
  if (childErr) throw childErr

  return dashId
}
