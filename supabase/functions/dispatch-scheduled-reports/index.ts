// =============================================================================
// dispatch-scheduled-reports
//
// Cron-driven dispatcher. Runs every 15 minutes via pg_cron. Finds
// scheduled_reports rows whose sr_next_send_at <= now() and sr_is_active
// is true, runs each report, builds a CSV attachment, emails it to the
// resolved recipient list, and audits the dispatch in scheduled_report_runs.
//
// If RESEND_API_KEY is not configured in Supabase secrets, the function
// runs in DRY-RUN mode: everything else happens normally (report is
// executed, CSV is built, recipients are resolved, audit row is written
// with status 'success_dry_run') but no email leaves the building. The
// moment the secret is added, real sends kick in with no code change.
//
// Authentication: service role key (this is a system job). Reports are
// executed with full database access — recipients see whatever the
// report query returns. This matches Salesforce's "scheduled reports
// run as the schedule owner" semantic. Authors creating schedules
// should be aware their schedule's recipients will see the data the
// owner has access to, regardless of the recipient's own RLS scope.
//
// Inputs (POST JSON, all optional):
//   { schedule_id?: <uuid>,    // run only this one (manual trigger)
//     dry_run_force?: boolean, // force dry-run even if RESEND_API_KEY is set
//     limit?: number }         // max schedules to process this invocation
//
// Outputs (200 JSON):
//   { processed: <int>, succeeded: <int>, failed: <int>, dry_run: <bool>,
//     runs: [{ schedule_id, status, ... }, ...] }
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ReqBody {
  schedule_id?:    string
  dry_run_force?:  boolean
  limit?:          number
}

interface ScheduledReport {
  id:                       string
  sr_record_number:         string
  sr_report_id:             string
  sr_name:                  string
  sr_frequency:             string
  sr_day_of_week:           number | null
  sr_day_of_month:          number | null
  sr_send_time:             string
  sr_timezone:              string
  sr_format:                string
  sr_subject_line:          string
  sr_message_body:          string | null
  sr_recipient_user_ids:    string[]
  sr_recipient_role_ids:    string[]
  sr_recipient_emails:      string[]
  sr_owner_user_id:         string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const body: ReqBody = await req.json().catch(() => ({}))

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const resendApiKey    = Deno.env.get("RESEND_API_KEY")
  const fromAddress     = Deno.env.get("RESEND_FROM_ADDRESS") || "EES Reports <reports@ees-wi.org>"
  const baseUrl         = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const dryRun = !resendApiKey || body.dry_run_force === true

  // ── Find due schedules ─────────────────────────────────────────────
  let query = supabase
    .from("scheduled_reports")
    .select("*")
    .eq("sr_is_active", true)
    .eq("is_deleted", false)

  if (body.schedule_id) {
    query = query.eq("id", body.schedule_id)
  } else {
    // Dispatcher mode: only schedules that are due. Allow a small
    // grace period so a schedule whose next_send_at landed mid-cron-
    // tick still fires this round.
    query = query.lte("sr_next_send_at", new Date().toISOString())
  }

  const limit = Math.min(body.limit || 100, 500)
  query = query.order("sr_next_send_at", { ascending: true, nullsFirst: true }).limit(limit)

  const { data: schedules, error: schedErr } = await query
  if (schedErr) return json({ error: `failed to load schedules: ${schedErr.message}` }, 500)

  const runs: any[] = []
  let succeeded = 0, failed = 0, warned = 0

  for (const s of (schedules || []) as ScheduledReport[]) {
    const result = await dispatchOne(supabase, s, {
      dryRun, resendApiKey, fromAddress, baseUrl,
    })
    runs.push(result)
    if (result.status === "success" || result.status === "success_dry_run") succeeded++
    else if (result.status === "success_with_warnings") { succeeded++; warned++ }
    else if (result.status === "report_error" || result.status === "send_error") failed++
  }

  return json({
    processed: schedules?.length || 0,
    succeeded,
    failed,
    warned,
    dry_run:   dryRun,
    runs,
  })
})

// ─── Per-schedule dispatch ────────────────────────────────────────────────

async function dispatchOne(
  supabase: SupabaseClient,
  s: ScheduledReport,
  ctx: { dryRun: boolean, resendApiKey: string|undefined, fromAddress: string, baseUrl: string }
) {
  // Audit row, status 'running'
  const { data: runRow, error: runErr } = await supabase
    .from("scheduled_report_runs")
    .insert({
      srr_record_number:        "",
      srr_scheduled_report_id:  s.id,
      srr_report_id:            s.sr_report_id,
      srr_status:               "running",
    })
    .select("id")
    .single()
  if (runErr) {
    console.error("Failed to insert run audit row:", runErr.message)
    return { schedule_id: s.id, status: "audit_insert_failed", error: runErr.message }
  }
  const runId: string = runRow.id

  // ── Resolve recipient emails ──────────────────────────────────────
  const recipients = await resolveRecipients(supabase, s)
  if (recipients.length === 0) {
    await updateRun(supabase, runId, {
      srr_status: "no_recipients",
      srr_completed_at: new Date().toISOString(),
      srr_recipient_count: 0,
    })
    await advanceNextSend(supabase, s)
    return { schedule_id: s.id, status: "no_recipients" }
  }

  // ── Run the report ────────────────────────────────────────────────
  let rows: any[]
  let columns: { name: string, label: string, via_path?: string[]|null }[]
  let reportName = s.sr_name
  let warnings: string[] = []
  try {
    const r = await runReportSimple(supabase, s.sr_report_id)
    rows = r.rows
    columns = r.columns
    reportName = r.name || s.sr_name
    warnings = r.warnings || []
  } catch (err) {
    const msg = (err as Error).message
    await updateRun(supabase, runId, {
      srr_status: "report_error",
      srr_completed_at: new Date().toISOString(),
      srr_error_message: msg,
      srr_recipient_count: recipients.length,
    })
    await advanceNextSend(supabase, s)
    return { schedule_id: s.id, status: "report_error", error: msg }
  }

  // ── Build CSV ────────────────────────────────────────────────────
  // v1 supports CSV only. PDF/XLSX in a follow-up — pdf-lib + xlsx
  // both work in Deno but they're chunky imports for a per-row dispatch.
  const csv = buildCsv(rows, columns)
  const csvBytes = new TextEncoder().encode(csv)
  const csvBase64 = base64Encode(csvBytes)
  const filename = `${slugify(reportName)}_${new Date().toISOString().slice(0,10)}.csv`

  // Status downgrade: a successful run with soft warnings reports
  // 'success_with_warnings' instead of 'success'/'success_dry_run' so
  // the schedule owner sees them surfaced in the run history. Warnings
  // also go into srr_warnings either way.
  const hasWarnings = warnings.length > 0
  const successStatus       = hasWarnings ? "success_with_warnings" : "success"
  const successDryRunStatus = hasWarnings ? "success_with_warnings" : "success_dry_run"
  const warningsField = hasWarnings ? { srr_warnings: warnings } : {}

  // ── Send (or dry-run) ────────────────────────────────────────────
  if (ctx.dryRun) {
    await updateRun(supabase, runId, {
      srr_status:               successDryRunStatus,
      srr_completed_at:         new Date().toISOString(),
      srr_row_count:            rows.length,
      srr_recipient_count:      recipients.length,
      srr_recipients:           recipients,
      srr_format:               "csv",
      srr_attachment_size:      csvBytes.length,
      srr_email_provider:       "dry_run",
      ...warningsField,
    })
    await advanceNextSend(supabase, s)
    return {
      schedule_id: s.id, status: successDryRunStatus,
      row_count: rows.length, recipient_count: recipients.length,
      warnings: hasWarnings ? warnings : undefined,
    }
  }

  try {
    const messageId = await sendViaResend({
      apiKey:      ctx.resendApiKey!,
      from:        ctx.fromAddress,
      to:          recipients,
      subject:     s.sr_subject_line,
      bodyText:    buildEmailBody(s, reportName, rows.length, ctx.baseUrl),
      attachment:  { filename, contentBase64: csvBase64, contentType: "text/csv" },
    })
    await updateRun(supabase, runId, {
      srr_status:              successStatus,
      srr_completed_at:        new Date().toISOString(),
      srr_row_count:           rows.length,
      srr_recipient_count:     recipients.length,
      srr_recipients:          recipients,
      srr_format:              "csv",
      srr_attachment_size:     csvBytes.length,
      srr_email_provider:      "resend",
      srr_provider_message_id: messageId,
      ...warningsField,
    })
    await advanceNextSend(supabase, s)
    return {
      schedule_id: s.id, status: successStatus,
      row_count: rows.length, recipient_count: recipients.length,
      warnings: hasWarnings ? warnings : undefined,
    }
  } catch (err) {
    const msg = (err as Error).message
    await updateRun(supabase, runId, {
      srr_status:           "send_error",
      srr_completed_at:     new Date().toISOString(),
      srr_error_message:    msg,
      srr_row_count:        rows.length,
      srr_recipient_count:  recipients.length,
      srr_recipients:       recipients,
      srr_format:           "csv",
      srr_attachment_size:  csvBytes.length,
      ...warningsField,
    })
    // Don't advance next_send_at on send error — let it retry next cron tick.
    return { schedule_id: s.id, status: "send_error", error: msg }
  }
}

// ─── Recipient resolution ────────────────────────────────────────────────

async function resolveRecipients(supabase: SupabaseClient, s: ScheduledReport): Promise<string[]> {
  const set = new Set<string>()

  // Literal emails
  for (const e of (s.sr_recipient_emails || [])) {
    if (e && typeof e === "string") set.add(e.trim().toLowerCase())
  }

  // User IDs → look up email
  if (s.sr_recipient_user_ids?.length) {
    const { data, error } = await supabase
      .from("users")
      .select("id, user_email")
      .in("id", s.sr_recipient_user_ids)
      .eq("is_deleted", false)
    if (error) console.warn("user lookup failed:", error.message)
    for (const u of (data || [])) {
      if (u.user_email) set.add(u.user_email.trim().toLowerCase())
    }
  }

  // Role IDs → look up users with that role
  if (s.sr_recipient_role_ids?.length) {
    const { data, error } = await supabase
      .from("users")
      .select("id, user_email, role_id")
      .in("role_id", s.sr_recipient_role_ids)
      .eq("is_deleted", false)
    if (error) console.warn("role lookup failed:", error.message)
    for (const u of (data || [])) {
      if (u.user_email) set.add(u.user_email.trim().toLowerCase())
    }
  }

  return Array.from(set)
}

// ─── Simplified report runner for the dispatcher ─────────────────────────
// Supported features (full fidelity):
//   • Direct fields and one-hop via_path embeds
//   • Operator-based filters on the primary object
//   • Picklist label resolution for primary-object fields
//   • FK label auto-embeds for primary-object FK columns
//   • Sort by primary-object columns
//
// Soft-degraded with warnings (run still succeeds, warnings recorded):
//   • Multi-hop via_path (length > 1) — column rendered but value will be
//     null since the dispatcher's runner doesn't traverse beyond one hop
//   • Related-field filters (rfilt_field_via_path set) — silently dropped,
//     output may include rows that don't match
//   • Sort by related-object column — silently dropped
//
// Hard-incompatible (run fails with report_error before any query work):
//   • Cross-filters (rfilt_is_cross_filter) — without pre-querying the
//     cross-object set, the dispatcher would produce strictly wrong rows
//   • Filter logic expressions other than 'all' or 'any' — without the
//     parser, '1 AND (2 OR 3)' would silently AND everything
//   • Calculated fields (report_calculated_fields) — without the formula
//     evaluator, calc columns would be missing or wrong

interface SimpleField {
  name: string
  table?: string
  label?: string
  via_path?: string[] | null
  type?: string
}

interface RunResult {
  rows:     any[]
  columns:  { name: string, label: string, via_path?: string[]|null }[]
  name:     string
  warnings: string[]
}

// Inspect a report's definition + filter rows + calc fields. If any
// hard-incompatible feature is used, throw with a clear message that
// becomes the audit row's srr_error_message. Otherwise return the
// list of soft warnings to emit alongside a successful run.
async function validateReport(
  supabase: SupabaseClient,
  report: any,
  filterRows: any[],
): Promise<string[]> {
  const errors: string[] = []
  const warnings: string[] = []

  // Cross-filters — hard incompatible. Producing rows without the cross-
  // filter applied would silently break "open work orders without a
  // photo attached" style reports.
  const crossFilters = filterRows.filter(f => f.rfilt_is_cross_filter)
  if (crossFilters.length > 0) {
    errors.push(`This report uses ${crossFilters.length} cross-filter${crossFilters.length === 1 ? '' : 's'} (with/without related records). The scheduled-report dispatcher's runner can't apply cross-filters yet. Either remove them, or run the report manually until the dispatcher supports them.`)
  }

  // Filter logic — hard incompatible if it's anything other than the
  // default 'all' or 'any'. Front-end stores parsed expressions like
  // '1 AND (2 OR 3)' in rpt_filter_logic.
  const logic = (report.rpt_filter_logic || '').toString().trim().toLowerCase()
  if (logic && logic !== 'all' && logic !== 'any' && logic !== '') {
    errors.push(`This report uses a custom filter logic expression ('${report.rpt_filter_logic}'). The dispatcher's runner only supports 'all' (default AND) and 'any' (default OR). Either simplify the logic or run manually.`)
  }

  // Calculated fields — hard incompatible. Calc columns would be
  // missing or always-empty in the CSV.
  const { data: calcRows, error: calcErr } = await supabase
    .from('report_calculated_fields')
    .select('id')
    .eq('rcf_report_id', report.id)
    .eq('is_deleted', false)
    .limit(1)
  if (calcErr) {
    // Don't fail the report on a metadata-load failure; just warn
    warnings.push(`Couldn't check for calculated fields: ${calcErr.message}`)
  } else if ((calcRows || []).length > 0) {
    errors.push(`This report has calculated fields. The dispatcher's runner can't evaluate formulas yet. Either remove them or run manually.`)
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }

  // Soft warnings — multi-hop via_path
  const fields: SimpleField[] = report.rpt_selected_fields || []
  const multiHop = fields.filter(f => f.via_path && f.via_path.length > 1)
  if (multiHop.length > 0) {
    warnings.push(`${multiHop.length} multi-hop column${multiHop.length === 1 ? '' : 's'} (${multiHop.map(f => f.label || f.name).slice(0, 3).join(', ')}${multiHop.length > 3 ? '…' : ''}) will appear empty — the dispatcher only traverses one FK hop.`)
  }

  // Soft warnings — related-field filters
  const relatedFilters = filterRows.filter(f => !f.rfilt_is_cross_filter && f.rfilt_field_via_path?.length)
  if (relatedFilters.length > 0) {
    warnings.push(`${relatedFilters.length} filter${relatedFilters.length === 1 ? '' : 's'} target related-object fields and were skipped. Output may include rows that wouldn't pass these filters in the live runner.`)
  }

  // Soft warnings — related-field sorts
  const sortConfig = report.rpt_sort_config || []
  const relatedSorts = sortConfig.filter((s: any) => s.via_path?.length)
  if (relatedSorts.length > 0) {
    warnings.push(`${relatedSorts.length} sort criteri${relatedSorts.length === 1 ? 'on' : 'a'} target related-object fields and were skipped — rows ordered by primary-object sorts only.`)
  }

  return warnings
}

async function runReportSimple(supabase: SupabaseClient, reportId: string): Promise<RunResult> {
  const { data: r, error: rErr } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("is_deleted", false)
    .single()
  if (rErr) throw new Error(`report load failed: ${rErr.message}`)
  if (!r) throw new Error("report not found")

  const { data: filterRows, error: fErr } = await supabase
    .from("report_filters")
    .select("*")
    .eq("rfilt_report_id", reportId)
    .eq("is_deleted", false)
    .order("rfilt_filter_index")
  if (fErr) throw new Error(`filter load failed: ${fErr.message}`)

  // Validate the report's feature usage. Hard-incompatible features
  // (cross-filters, custom filter logic, calc fields) throw here and
  // bubble up to dispatchOne as a 'report_error'. Soft-degraded
  // features (multi-hop via_path, related-field filters/sorts) are
  // collected as warnings and returned in the result for the audit row.
  const warnings = await validateReport(supabase, r, filterRows || [])

  const selectedFields: SimpleField[] = r.rpt_selected_fields || []

  // Build select string with one-hop embeds
  const directFields: string[] = []
  const embedMap: Record<string, { table: string, fields: string[] }> = {}
  for (const f of selectedFields) {
    if (!f.via_path || f.via_path.length === 0) {
      directFields.push(f.name)
    } else if (f.via_path.length === 1 && f.table) {
      const fk = f.via_path[0]
      if (!embedMap[fk]) embedMap[fk] = { table: f.table, fields: [] }
      embedMap[fk].fields.push(f.name)
    }
  }
  if (!directFields.includes("id")) directFields.unshift("id")

  const selectParts = [...directFields]
  for (const [fk, embed] of Object.entries(embedMap)) {
    selectParts.push(`${fk}:${embed.table}(${embed.fields.join(", ")})`)
  }
  const selectStr = selectParts.join(", ")

  // Build query
  let q = supabase.from(r.rpt_primary_object).select(selectStr)

  // Soft-delete filter — consult ees_table_metadata since different
  // tables use different column names ('is_deleted' vs prefixed).
  const { data: meta } = await supabase.rpc("ees_table_metadata", { p_table: r.rpt_primary_object })
  const softDeleteCol = (meta as any)?.is_deleted_column
  if (softDeleteCol) {
    q = q.eq(softDeleteCol, false)
  }

  for (const filt of (filterRows || [])) {
    if (filt.rfilt_is_cross_filter) continue
    if (filt.rfilt_field_via_path?.length) continue  // related-field filters not supported here
    q = applyFilter(q, filt.rfilt_field_name, filt.rfilt_operator, filt.rfilt_value)
  }

  // Sort
  for (const s of (r.rpt_sort_config || [])) {
    if (!s.name) continue
    if (s.via_path?.length) continue
    q = q.order(s.name, { ascending: s.direction !== "desc" })
  }

  // Paginate up to 50k rows
  const PAGE_SIZE = 1000, HARD_CEILING = 50000
  let pageStart = 0
  const rows: any[] = []
  while (pageStart < HARD_CEILING) {
    const pageEnd = Math.min(pageStart + PAGE_SIZE - 1, HARD_CEILING - 1)
    const requested = pageEnd - pageStart + 1
    const { data, error } = await q.range(pageStart, pageEnd)
    if (error) throw new Error(`query failed: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < requested) break
    pageStart += PAGE_SIZE
    if (rows.length >= HARD_CEILING) break
  }

  // Picklist label resolution for primary-object picklist columns
  const picklistByObjectField: Map<string, Map<string, string>> = new Map()
  // First, find which selected fields are picklist FKs on the primary
  const { data: cols } = await supabase.rpc("describe_object_columns", { p_table: r.rpt_primary_object })
  const picklistColumns = (cols || []).filter((c: any) =>
    c.is_foreign_key && c.references_table === "picklist_values"
  ).map((c: any) => c.column_name)
  const picklistFieldsOnReport = selectedFields.filter(f =>
    (!f.via_path || f.via_path.length === 0) && picklistColumns.includes(f.name)
  )
  if (picklistFieldsOnReport.length > 0) {
    const { data: pvs } = await supabase
      .from("picklist_values")
      .select("id, picklist_field, picklist_value, picklist_label")
      .eq("picklist_object", r.rpt_primary_object)
      .in("picklist_field", picklistFieldsOnReport.map(f => f.name))
    const valueMap = new Map<string, string>()
    for (const pv of (pvs || [])) {
      valueMap.set(pv.id, pv.picklist_label || pv.picklist_value)
    }
    picklistByObjectField.set(r.rpt_primary_object, valueMap)
  }

  // Annotate columns + resolve picklist values inline in rows
  const columns = selectedFields.map(f => ({
    name: f.name,
    label: f.label || f.name,
    via_path: f.via_path,
  }))

  const valueMap = picklistByObjectField.get(r.rpt_primary_object) || new Map()
  for (const row of rows) {
    for (const f of selectedFields) {
      if (f.via_path && f.via_path.length > 0) continue
      if (!picklistColumns.includes(f.name)) continue
      const id = row[f.name]
      if (id && valueMap.has(id)) {
        row[f.name] = valueMap.get(id)
      }
    }
  }

  return { rows, columns, name: r.rpt_name, warnings }
}

function applyFilter(q: any, field: string, op: string, value: any) {
  switch (op) {
    case "equals":           return q.eq(field, value)
    case "not_equals":       return q.neq(field, value)
    case "greater_than":     return q.gt(field, value)
    case "less_than":        return q.lt(field, value)
    case "greater_or_equal": return q.gte(field, value)
    case "less_or_equal":    return q.lte(field, value)
    case "in":
      return q.in(field, Array.isArray(value) ? value : String(value).split(",").map(s => s.trim()))
    case "not_in":
      return q.not(field, "in", `(${(Array.isArray(value) ? value : String(value).split(",").map(s => s.trim())).map(x => `"${x}"`).join(",")})`)
    case "contains":    return q.ilike(field, `%${value}%`)
    case "starts_with": return q.ilike(field, `${value}%`)
    case "ends_with":   return q.ilike(field, `%${value}`)
    case "is_null":     return q.is(field, null)
    case "is_not_null": return q.not(field, "is", null)
    case "in_last_n_days": {
      const n = parseInt(value, 10)
      if (Number.isFinite(n) && n > 0) {
        const cutoff = new Date(Date.now() - n * 86400000).toISOString()
        return q.gte(field, cutoff)
      }
      return q
    }
    case "this_month": {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const end   = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString()
      return q.gte(field, start).lt(field, end)
    }
    case "this_year": {
      const now = new Date()
      const start = new Date(now.getFullYear(), 0, 1).toISOString()
      const end   = new Date(now.getFullYear()+1, 0, 1).toISOString()
      return q.gte(field, start).lt(field, end)
    }
  }
  return q
}

// ─── CSV builder ──────────────────────────────────────────────────────────

function buildCsv(rows: any[], columns: any[]): string {
  const escape = (v: any): string => {
    if (v == null) return ""
    if (typeof v === "object") v = JSON.stringify(v)
    const s = String(v)
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const header = columns.map(c => escape(c.label)).join(",")
  const dataRows = rows.map(row => columns.map(c => {
    if (c.via_path?.length) {
      // One-hop: row[fk] is a nested object
      const nested = row[c.via_path[0]]
      return escape(nested ? nested[c.name] : null)
    }
    return escape(row[c.name])
  }).join(","))
  return [header, ...dataRows].join("\n")
}

// ─── Email sending via Resend ─────────────────────────────────────────────

async function sendViaResend(opts: {
  apiKey: string,
  from: string,
  to: string[],
  subject: string,
  bodyText: string,
  attachment: { filename: string, contentBase64: string, contentType: string }
}): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.apiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    opts.from,
      to:      opts.to,
      subject: opts.subject,
      text:    opts.bodyText,
      attachments: [{
        filename: opts.attachment.filename,
        content:  opts.attachment.contentBase64,
      }],
    }),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => "(empty body)")
    throw new Error(`Resend API ${res.status}: ${errBody.slice(0, 500)}`)
  }
  const data = await res.json().catch(() => ({}))
  return data.id || ""
}

function buildEmailBody(s: ScheduledReport, reportName: string, rowCount: number, baseUrl: string): string {
  const reportUrl = `${baseUrl}/reports/${s.sr_report_id}`
  const customMessage = (s.sr_message_body || "").trim()
  return [
    customMessage ? customMessage + "\n\n" : "",
    `Report: ${reportName}`,
    `Rows:   ${rowCount.toLocaleString()}`,
    `When:   ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
    "",
    `View the live report: ${reportUrl}`,
    "",
    "— EES Reports",
  ].join("\n")
}

// ─── Schedule advancement ────────────────────────────────────────────────

async function advanceNextSend(supabase: SupabaseClient, s: ScheduledReport) {
  const { data, error } = await supabase.rpc("compute_next_send_at", {
    p_frequency:    s.sr_frequency,
    p_day_of_week:  s.sr_day_of_week,
    p_day_of_month: s.sr_day_of_month,
    p_send_time:    s.sr_send_time,
    p_timezone:     s.sr_timezone,
    p_anchor:       new Date().toISOString(),
  })
  if (error) {
    console.warn(`compute_next_send_at failed for ${s.id}: ${error.message}`)
    return
  }
  await supabase.from("scheduled_reports").update({
    sr_last_sent_at: new Date().toISOString(),
    sr_next_send_at: data,
  }).eq("id", s.id)
}

async function updateRun(supabase: SupabaseClient, runId: string, patch: Record<string, any>) {
  const { error } = await supabase.from("scheduled_report_runs").update(patch).eq("id", runId)
  if (error) console.warn(`failed to update run ${runId}:`, error.message)
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function json(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...cors },
  })
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60)
}

function base64Encode(bytes: Uint8Array): string {
  // Deno's btoa wants a string. For UTF-8 safety we use the chunked
  // String.fromCharCode pattern that handles arbitrary byte sequences.
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}
