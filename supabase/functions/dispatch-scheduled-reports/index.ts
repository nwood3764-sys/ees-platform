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

// Constant-time comparison so the auth gate doesn't leak the key via timing.
function timingSafeEqualStr(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")    return json({ error: "POST required" }, 405)

  const body: ReqBody = await req.json().catch(() => ({}))

  const supabaseUrl     = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const resendApiKey    = Deno.env.get("RESEND_API_KEY")
  const fromAddress     = Deno.env.get("RESEND_FROM_ADDRESS") || "EES Reports <reports@EES-WI.org>"
  const baseUrl         = Deno.env.get("APP_BASE_URL") || "https://ees-ops.netlify.app"

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server misconfiguration — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Authorization gate. This dispatcher runs reports with the service role
  // (RLS-bypassing) and emails their output to author-chosen recipients, so it
  // must NOT be reachable with the public anon key — otherwise any authenticated
  // user could POST {schedule_id} to force-send a schedule and read data their
  // own RLS forbids. The paired pg_cron job sends a shared secret in the
  // x-internal-cron-secret header; the secret lives in internal_cron_auth,
  // readable only by the service role (anon/authenticated are revoked). This
  // authenticates the cron without ever exposing the service-role key to it.
  const { data: cronAuth } = await supabase
    .from("internal_cron_auth").select("secret").eq("name", "dispatch").maybeSingle()
  const presentedSecret = req.headers.get("x-internal-cron-secret") || ""
  if (!cronAuth?.secret || !timingSafeEqualStr(presentedSecret, cronAuth.secret)) {
    return json({ error: "Unauthorized" }, 401)
  }

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
  let runResult: RunResult
  let reportName = s.sr_name
  let warnings: string[] = []
  try {
    runResult = await runReportSimple(supabase, s.sr_report_id)
    reportName = runResult.name || s.sr_name
    warnings = runResult.warnings || []
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
  const rows = runResult.rows
  const columns = runResult.columns

  // ── Build attachment ──────────────────────────────────────────────
  // Dispatch on sr_format. CSV is text via TextEncoder; XLSX is binary
  // via the SheetJS package (esm.sh); PDF is binary via pdf-lib (also
  // esm.sh). The PDF builder respects rpt_format (tabular | summary |
  // matrix); CSV/XLSX always emit flat tabular data regardless.
  const requestedFormat = (s.sr_format || "csv").toLowerCase()
  let attBytes:  Uint8Array
  let attMime:   string
  let attExt:    string
  try {
    const built = await buildAttachment(runResult, reportName, requestedFormat)
    attBytes = built.bytes
    attMime  = built.mime
    attExt   = built.ext
  } catch (err) {
    const msg = `attachment build failed (${requestedFormat}): ${(err as Error).message}`
    await updateRun(supabase, runId, {
      srr_status: "report_error", srr_completed_at: new Date().toISOString(),
      srr_error_message: msg, srr_recipient_count: recipients.length,
    })
    await advanceNextSend(supabase, s)
    return { schedule_id: s.id, status: "report_error", error: msg }
  }
  const attBase64 = base64Encode(attBytes)
  const filename = `${slugify(reportName)}_${new Date().toISOString().slice(0,10)}.${attExt}`

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
      srr_format:               attExt,
      srr_attachment_size:      attBytes.length,
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
      attachment:  { filename, contentBase64: attBase64, contentType: attMime },
    })
    await updateRun(supabase, runId, {
      srr_status:              successStatus,
      srr_completed_at:        new Date().toISOString(),
      srr_row_count:           rows.length,
      srr_recipient_count:     recipients.length,
      srr_recipients:          recipients,
      srr_format:              attExt,
      srr_attachment_size:     attBytes.length,
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
      srr_format:           attExt,
      srr_attachment_size:  attBytes.length,
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
//   • Direct fields and multi-hop via_path embeds (any depth)
//   • Operator-based filters on the primary object
//   • One-hop related-field filters (via PostgREST 'fk.field' syntax)
//   • Multi-hop related-field filters (slow path: in-memory eval)
//   • Custom filter logic expressions: '1 AND (2 OR 3)', NOT, parens
//     (slow path: fetch then evaluate via shunting-yard RPN)
//   • Cross-filters (rfilt_is_cross_filter) with 'with' / 'without'
//     semantics and sub-filters on the cross object
//   • Row-scope calculated fields (Salesforce-flavored formula evaluator;
//     arithmetic, comparison, logical, parens, functions like IF / ROUND /
//     CONCATENATE / DAYS_BETWEEN / etc.)
//   • Picklist label resolution for primary-object fields
//   • FK label auto-embeds for primary-object FK columns
//   • Sort by primary-object columns and one-hop related-object columns
//   • Multi-hop sorts (slow path: client-side comparator)
//
// Soft-degraded with warnings:
//   • Summary-scope calculated fields — dispatcher outputs flat tabular
//     data; summary calc fields belong to summary/matrix layouts only
//     and are silently skipped (a warning is recorded in srr_warnings).
//
// Hard-incompatible: none. The dispatcher is at full parity with the
// in-app runner's tabular output.

interface SimpleField {
  name: string
  table?: string
  label?: string
  via_path?: string[] | null
  type?: string
}

interface ReportGrouping {
  field_name:     string
  field_label:    string
  field_via_path: string[] | null
  sort_direction: string
  show_subtotal:  boolean
}

interface RunResult {
  rows:     any[]
  columns:  { name: string, label: string, via_path?: string[]|null, _is_calc?: boolean, _data_type?: string }[]
  name:     string
  warnings: string[]
  // Format-dependent fields. CSV/XLSX builders ignore these and render
  // flat tabular data. The PDF builder dispatches on `format` to
  // tabular | summary | matrix layouts.
  format:           string                                 // 'tabular' | 'summary' | 'matrix'
  groupings:        ReportGrouping[]                       // row-axis (summary + matrix)
  columnGroupings:  { name: string, label?: string, via_path?: string[]|null, sort_direction?: string }[]  // column-axis (matrix only)
  measure:          { type: string, field: string | null } // matrix cell measure
  primaryObject:    string
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

  // Cross-filters were previously hard-incompatible. They're now
  // supported via a pre-query that resolves each cross-filter to a
  // set of primary-object IDs, then with/without filter applied after
  // the main query returns. See resolveCrossFilters in runReportSimple.

  // Filter logic — complex expressions ('1 AND (2 OR 3)', NOT, etc.) are
  // now supported in the runner via applyFilterLogic (ported from the
  // in-app runner). 'all' (AND) and 'any' (OR) still use the DB-level
  // fast path; complex logic switches to fetch-then-filter. No error
  // here anymore.

  // Calculated fields — hard incompatible. Calc columns would be
  // missing or always-empty in the CSV.
  // Calculated fields were previously hard-incompatible. They're now
  // supported via a recursive-descent formula evaluator ported from
  // src/lib/reportFormulaEval.js. Row-scope calc fields appear as
  // additional columns in the CSV/XLSX output, evaluated per row after
  // FK label / picklist resolution. Summary-scope calc fields are
  // skipped since the dispatcher only outputs flat tabular data.
  // No error here anymore.
  // (validateReport keeps the calc-field metadata load so we can warn
  // about summary-scope fields being skipped if any are present.)
  const { data: calcRows, error: calcErr } = await supabase
    .from('report_calculated_fields')
    .select('rcf_scope, rcf_label')
    .eq('rcf_report_id', report.id)
    .eq('is_deleted', false)
  if (calcErr) {
    warnings.push(`Couldn't check for calculated fields: ${calcErr.message}`)
  } else {
    const summaryCalc = (calcRows || []).filter((c: any) => c.rcf_scope === 'summary')
    if (summaryCalc.length > 0) {
      warnings.push(`${summaryCalc.length} summary-scope calculated field${summaryCalc.length === 1 ? '' : 's'} skipped \u2014 the dispatcher outputs flat tabular data and summary calc fields belong to summary/matrix layouts only.`)
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }

  // Multi-hop via_path on columns is no longer a degrade case — the
  // runner builds recursive embeds.
  // Related-field filters/sorts are no longer degrade cases — one-hop
  // versions go through PostgREST's 'fk.field' syntax in the fast path,
  // and multi-hop versions trigger the slow-path fetch-then-filter.
  // (Both were soft warnings prior to v8.)

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

  // ── Build PostgREST select string with multi-hop embed support ────────
  //
  // The in-app runner's pattern (src/data/reportsService.js,
  // ensureEmbedNode + serializeEmbeds) walks a via_path chain of any
  // depth and produces nested embed syntax: 'fk1:t1(fk2:t2(field))'.
  // PostgREST supports this natively. Lifted here so the dispatcher
  // handles the same field shapes the in-app runner does — closing the
  // 'multi-hop columns appear empty' soft-warning case in
  // validateReport.
  //
  // embedTree shape:
  //   { [fk]: { table, fields: string[], children: embedTree } }
  // where 'table' is the joined table at this hop (only meaningful at
  // the leaf node — intermediate hops get inferred by PostgREST from
  // the FK constraint).
  const directFields: string[] = []
  const embedTree: Record<string, { table: string | null, fields: string[], children: any }> = {}

  function ensureEmbedNode(viaPath: string[], leafTable: string | undefined): { table: string | null, fields: string[], children: any } {
    let cur: any = embedTree
    for (let i = 0; i < viaPath.length; i++) {
      const fk = viaPath[i]
      if (!cur[fk]) {
        cur[fk] = {
          table:    i === viaPath.length - 1 ? (leafTable || null) : null,
          fields:   [],
          children: {},
        }
      }
      if (i === viaPath.length - 1 && leafTable && !cur[fk].table) {
        cur[fk].table = leafTable
      }
      if (i < viaPath.length - 1) cur = cur[fk].children
    }
    let leaf: any = embedTree
    for (let i = 0; i < viaPath.length - 1; i++) leaf = leaf[viaPath[i]].children
    return leaf[viaPath[viaPath.length - 1]]
  }

  for (const f of selectedFields) {
    if (!f.via_path || f.via_path.length === 0) {
      directFields.push(f.name)
    } else {
      const node = ensureEmbedNode(f.via_path, f.table)
      if (!node.fields.includes(f.name)) node.fields.push(f.name)
    }
  }

  if (!directFields.includes("id")) directFields.unshift("id")

  function serializeEmbeds(tree: Record<string, any>): string[] {
    const parts: string[] = []
    for (const [fk, node] of Object.entries(tree)) {
      const innerParts: string[] = [...(node as any).fields]
      innerParts.push(...serializeEmbeds((node as any).children))
      const tableSegment = (node as any).table ? `:${(node as any).table}` : ""
      parts.push(`${fk}${tableSegment}(${innerParts.join(", ")})`)
    }
    return parts
  }

  const selectParts: string[] = [...directFields, ...serializeEmbeds(embedTree)]
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

  // Filter logic dispatch + related-field filter handling:
  //
  // Fast path: simple logic ('all' / 'any' / '') AND all related-field
  //   filters/sorts are at most one hop deep. We apply everything at
  //   the DB layer. Related fields use PostgREST's embedded-table
  //   column syntax: 'fk.field' where 'fk' is via_path[0]. PostgREST
  //   walks the embed graph automatically. This is the same pattern
  //   the in-app runner uses for the same case.
  //
  // Slow path: complex logic, OR any filter/sort uses a multi-hop
  //   via_path (length > 1). We fetch all rows with no DB-level filters
  //   (just soft-delete) and evaluate everything client-side via
  //   applyFilterLogic / evalFilterOnRow / a sort comparator. Bounded
  //   by HARD_CEILING (50k rows).
  //
  // Detection:
  const logicExpr = (r.rpt_filter_logic || "").toString().trim()
  const logicLower = logicExpr.toLowerCase()
  const isComplexLogic = logicExpr && logicLower !== "all" && logicLower !== "any"

  const sortConfig = (r.rpt_sort_config || []) as any[]
  const hasMultiHopFilter = (filterRows || []).some((f: any) =>
    f.rfilt_field_via_path && f.rfilt_field_via_path.length > 1
  )
  const hasMultiHopSort = sortConfig.some(s => s.via_path && s.via_path.length > 1)
  const useSlowPath = isComplexLogic || hasMultiHopFilter || hasMultiHopSort

  if (!useSlowPath) {
    // Fast path: DB-level filters, including one-hop related-field
    // filters via 'fk.field' syntax.
    for (const filt of (filterRows || [])) {
      if (filt.rfilt_is_cross_filter) continue
      const isRelated = filt.rfilt_field_via_path && filt.rfilt_field_via_path.length === 1
      const col = isRelated
        ? `${filt.rfilt_field_via_path[0]}.${filt.rfilt_field_name}`
        : filt.rfilt_field_name
      q = applyFilter(q, col, filt.rfilt_operator, filt.rfilt_value)
    }
  }
  // Slow path: leave the query unfiltered apart from soft-delete. The
  // filter rows themselves get evaluated below after pagination.

  // Sort — fast path handles one-hop related sorts via the same 'fk.field'
  // syntax. Multi-hop sorts fall through to the slow path (client-side
  // comparator below).
  if (!useSlowPath) {
    for (const s of sortConfig) {
      if (!s.name) continue
      const col = (s.via_path && s.via_path.length === 1)
        ? `${s.via_path[0]}.${s.name}`
        : s.name
      q = q.order(col, { ascending: s.direction !== "desc" })
    }
  }

  // ── Cross-filter resolution ────────────────────────────────────────
  //
  // Cross-filters constrain primary rows by their relationship to a
  // *different* table. Shape on report_filters rows:
  //   rfilt_is_cross_filter: true
  //   rfilt_cross_object:    'work_orders'   (the related table)
  //   rfilt_cross_match:     'with' | 'without'
  //   rfilt_cross_subfilters: jsonb [{ field_name, operator, value }, ...]
  //
  // We resolve each cross-filter to a Set<uuid> of primary-object ids
  // *before* pagination so we don't pay the cost of pulling rows we'll
  // immediately drop. After pagination, primary rows survive only if
  // their id is in the set (for 'with') or NOT in the set (for 'without').
  //
  // Discovery: the cross_object must have a FK column pointing at the
  // primary object. We use describe_object_columns and pick the first
  // FK whose references_table matches.
  const crossFilterRows = (filterRows || []).filter((f: any) => f.rfilt_is_cross_filter)
  const crossFilterSets: Array<{ match: string, ids: Set<string> }> = []
  for (const cf of crossFilterRows) {
    if (!cf.rfilt_cross_object) continue
    try {
      const { data: crossCols, error: cErr } = await supabase.rpc("describe_object_columns", { p_table: cf.rfilt_cross_object })
      if (cErr) {
        console.warn(`cross-filter: describe_object_columns(${cf.rfilt_cross_object}) failed:`, cErr.message)
        continue
      }
      const linkCol = (crossCols || []).find((c: any) =>
        c.is_foreign_key && c.references_table === r.rpt_primary_object
      )
      if (!linkCol) {
        console.warn(`cross-filter: no FK from ${cf.rfilt_cross_object} to ${r.rpt_primary_object} \u2014 skipping`)
        continue
      }
      let crossQ: any = supabase.from(cf.rfilt_cross_object).select(linkCol.column_name)
      // Cross object's own soft-delete column (varies: prefixed vs 'is_deleted')
      const { data: crossMeta } = await supabase.rpc("ees_table_metadata", { p_table: cf.rfilt_cross_object })
      const crossSoftDel = (crossMeta as any)?.is_deleted_column
      if (crossSoftDel) crossQ = crossQ.eq(crossSoftDel, false)
      // Apply sub-filters with applyFilter (same operator set as the primary).
      for (const sf of (cf.rfilt_cross_subfilters || [])) {
        if (!sf.field_name || !sf.operator) continue
        crossQ = applyFilter(crossQ, sf.field_name, sf.operator, sf.value)
      }
      const { data: crossData, error: crossErr } = await crossQ.limit(50000)
      if (crossErr) {
        console.warn(`cross-filter query on ${cf.rfilt_cross_object} failed:`, crossErr.message)
        continue
      }
      const ids = new Set<string>(
        (crossData || []).map((row: any) => row[linkCol.column_name]).filter(Boolean)
      )
      crossFilterSets.push({
        match: cf.rfilt_cross_match || "with",
        ids,
      })
    } catch (err) {
      console.warn(`cross-filter resolution failed for ${cf.rfilt_cross_object}:`, (err as Error).message)
    }
  }

  // Paginate up to 50k rows
  const PAGE_SIZE = 1000, HARD_CEILING = 50000
  let pageStart = 0
  let rows: any[] = []
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

  // Apply cross-filter sets. For 'with', keep rows whose id is in the
  // set; for 'without', keep rows whose id is NOT in the set. Multiple
  // cross-filters AND together (per Salesforce semantics).
  for (const cs of crossFilterSets) {
    if (cs.match === "without") {
      rows = rows.filter((row: any) => !cs.ids.has(row.id))
    } else {
      rows = rows.filter((row: any) => cs.ids.has(row.id))
    }
  }

  // Slow-path filter logic + related-field filter + sort — all in memory.
  if (useSlowPath) {
    // Filters: complex logic uses applyFilterLogic (which evaluates
    // every filter row including related-field ones via evalFilterOnRow).
    // Simple logic with multi-hop filters: just AND all the filter rows
    // (or OR them if logic is 'any') using evalFilterOnRow directly.
    if (isComplexLogic && (filterRows || []).length > 0) {
      try {
        rows = applyFilterLogic(rows, filterRows || [], logicExpr)
      } catch (err) {
        throw new Error(`filter logic eval failed: ${(err as Error).message}`)
      }
    } else if ((filterRows || []).length > 0) {
      // Simple logic, but slow path because of multi-hop filter/sort.
      // Evaluate each non-cross filter row in turn.
      const isAny = logicLower === "any"
      rows = rows.filter((row: any) => {
        const results = (filterRows || [])
          .filter((f: any) => !f.rfilt_is_cross_filter)
          .map((f: any) => evalFilterOnRow(f, row))
        if (results.length === 0) return true
        return isAny ? results.some(Boolean) : results.every(Boolean)
      })
    }

    // Sort — apply client-side after filtering. Multi-hop sorts walk
    // the via_path chain; one-hop and direct sorts work too.
    if (sortConfig.length > 0) {
      rows.sort((a, b) => {
        for (const sc of sortConfig) {
          if (!sc.name) continue
          let av: any = a, bv: any = b
          for (const fk of (sc.via_path || [])) {
            av = av ? av[fk] : null
            bv = bv ? bv[fk] : null
          }
          av = av ? av[sc.name] : null
          bv = bv ? bv[sc.name] : null
          const desc = sc.direction === "desc"
          if (av == null && bv == null) continue
          if (av == null) return desc ? -1 : 1
          if (bv == null) return desc ? 1 : -1
          if (av < bv) return desc ? 1 : -1
          if (av > bv) return desc ? -1 : 1
        }
        return 0
      })
    }
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
  const columns: any[] = selectedFields.map(f => ({
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

  // ── Calculated fields ─────────────────────────────────────────────────
  //
  // Fetch row-scope calc fields and evaluate per row. The evaluator is a
  // port of src/lib/reportFormulaEval.js' evaluateRowExpression — same
  // tokenizer, parser, and AST evaluator. Supports literals, arithmetic,
  // comparison, logical ops, parens, and a Salesforce-flavored function
  // library (IF, ISNULL, ABS, ROUND, MIN/MAX, LEN, UPPER, LOWER, TRIM,
  // CONCATENATE, TEXT, YEAR/MONTH/DAY, DAYS_BETWEEN, TODAY, NOW).
  //
  // Summary-scope calc fields are deliberately skipped — the dispatcher
  // outputs flat tabular data, not grouped summaries. Summary calc
  // fields belong to summary/matrix layouts. A warning is emitted in
  // validateReport if any are present.
  //
  // The flat row context for each evaluation is the row itself (with
  // picklist labels already substituted). Field names in expressions
  // match the underlying column name (e.g. 'project_amount' not the
  // human label).
  const { data: calcFieldsRaw } = await supabase
    .from("report_calculated_fields")
    .select("rcf_label, rcf_scope, rcf_expression, rcf_data_type, rcf_display_order")
    .eq("rcf_report_id", r.id)
    .eq("is_deleted", false)
    .eq("rcf_scope", "row")
    .order("rcf_display_order")
  const rowCalcFields = calcFieldsRaw || []
  for (const cf of rowCalcFields) {
    const colKey = `_calc_${cf.rcf_label || "calc"}_${cf.rcf_display_order || 0}`
    columns.push({
      name:  colKey,
      label: cf.rcf_label || "(calc)",
      via_path: null,
      _is_calc: true,
      _data_type: cf.rcf_data_type,
    })
    // Build a flat row context for each row and evaluate.
    for (const row of rows) {
      // The expression sees primary-object fields by their original
      // column name. Picklist substitution has already replaced FK ids
      // with labels in row[col.name], which matches what the in-app
      // runner does (it builds resolvedRow from getRowValue).
      const ctxRow: any = {}
      for (const sf of selectedFields) {
        if (sf.via_path && sf.via_path.length > 0) {
          let cur: any = row
          for (const fk of sf.via_path) { if (cur == null) break; cur = cur[fk] }
          ctxRow[sf.name] = cur ? cur[sf.name] : null
        } else {
          ctxRow[sf.name] = row[sf.name]
        }
      }
      const v = evaluateRowExpression(cf.rcf_expression, ctxRow)
      row[colKey] = v
    }
  }

  // ── Groupings + column-axis ───────────────────────────────────────────
  // Used by the PDF builder for summary/matrix layouts. CSV/XLSX
  // builders ignore these. Same shape as the in-app runner's result
  // (src/data/reportsService.js — see groupings/columnGroupings/measure).
  const { data: grpRows } = await supabase
    .from("report_groupings")
    .select("rgr_field_name, rgr_field_label, rgr_field_via_path, rgr_sort_direction, rgr_show_subtotal, rgr_grouping_level")
    .eq("rgr_report_id", r.id)
    .eq("is_deleted", false)
    .order("rgr_grouping_level")
  const groupings: ReportGrouping[] = (grpRows || []).map((g: any) => ({
    field_name:     g.rgr_field_name,
    field_label:    g.rgr_field_label || g.rgr_field_name,
    field_via_path: g.rgr_field_via_path,
    sort_direction: g.rgr_sort_direction || "asc",
    show_subtotal:  g.rgr_show_subtotal !== false,
  }))
  const columnGroupings = Array.isArray(r.rpt_column_groupings) ? r.rpt_column_groupings : []
  const firstChart = Array.isArray(r.rpt_charts) ? r.rpt_charts[0] : null
  const measure = (firstChart && firstChart.measure_type)
    ? { type: firstChart.measure_type, field: firstChart.measure_field || null }
    : { type: "count", field: null }

  return {
    rows,
    columns,
    name:            r.rpt_name,
    warnings,
    format:          (r.rpt_format || "tabular").toLowerCase(),
    groupings,
    columnGroupings,
    measure,
    primaryObject:   r.rpt_primary_object,
  }
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

// ─── Filter logic evaluator (slow-path) ─────────────────────────────────
// Ported from src/data/reportsService.js: applyFilterLogic + evalFilterOnRow.
// Same tokenizer (numbers, AND, OR, NOT, parens) → shunting-yard RPN →
// per-row evaluation. Filter rows are indexed by rfilt_filter_index.
//
// Used when rpt_filter_logic is something other than 'all' / 'any' / ''.
// Operates on rows already fetched from PostgREST; via_path traversal
// happens inside evalFilterOnRow so multi-hop fields are handled the
// same way they are in CSV/XLSX output.

function applyFilterLogic(rows: any[], filters: any[], expression: string): any[] {
  const tokens: any[] = []
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
  const prec: Record<string, number> = { NOT: 3, AND: 2, OR: 1 }
  const output: any[] = []
  const stack: any[] = []
  for (const t of tokens) {
    if (t.type === 'num') output.push(t)
    else if (t.type === '(') stack.push(t)
    else if (t.type === ')') {
      while (stack.length && stack[stack.length-1].type !== '(') output.push(stack.pop())
      stack.pop()
    } else {
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

  // Index filters by rfilt_filter_index for O(1) lookup
  const filterByIdx = new Map<number, any>()
  for (const f of filters) filterByIdx.set(f.rfilt_filter_index, f)

  return rows.filter(row => {
    const evalStack: boolean[] = []
    for (const t of output) {
      if (t.type === 'num') {
        const f = filterByIdx.get(t.value)
        if (!f) { evalStack.push(false); continue }
        evalStack.push(evalFilterOnRow(f, row))
      } else if (t.type === 'NOT') {
        const a = evalStack.pop()
        evalStack.push(!a)
      } else if (t.type === 'AND') {
        const b = evalStack.pop(), a = evalStack.pop()
        evalStack.push(!!a && !!b)
      } else if (t.type === 'OR') {
        const b = evalStack.pop(), a = evalStack.pop()
        evalStack.push(!!a || !!b)
      }
    }
    return !!evalStack[0]
  })
}

// Evaluate a single filter against a row. Mirrors evalFilterOnRow in the
// in-app runner. via_path is supported at arbitrary depth (same chain
// walk as buildCsv/buildXlsx).
function evalFilterOnRow(f: any, row: any): boolean {
  let v: any
  if (f.rfilt_field_via_path && f.rfilt_field_via_path.length > 0) {
    let cur: any = row
    for (const fk of f.rfilt_field_via_path) {
      if (cur == null) { cur = null; break }
      cur = cur[fk]
    }
    v = cur ? cur[f.rfilt_field_name] : null
  } else {
    v = row[f.rfilt_field_name]
  }
  const target = f.rfilt_value
  switch (f.rfilt_operator) {
    case 'equals':           return v == target
    case 'not_equals':       return v != target
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

// ─── Calculated-field formula evaluator ─────────────────────────────────
//
// Port of src/lib/reportFormulaEval.js' evaluateRowExpression. Same
// recursive-descent parser, same AST evaluator, same function library.
// No eval(), no Function constructor. Pure parse-and-walk.
//
// Supports a Salesforce-flavored subset:
//   Literals:    numbers, strings (single or double quoted), true/false/null
//   Identifiers: field names (resolved via row context)
//   Arithmetic:  + - * / %
//   Comparison:  == != = <> < > <= >=
//   Logical:     AND OR NOT, also && || !
//   Grouping:    ( )
//   Functions:   TODAY, NOW, IF, ISNULL, ABS, ROUND, MIN, MAX, LEN,
//                UPPER, LOWER, TRIM, CONCATENATE, TEXT, YEAR, MONTH,
//                DAY, DAYS_BETWEEN

const CALC_TOK = {
  NUMBER: "number", STRING: "string", IDENT: "ident", BOOL: "bool", NULL: "null",
  PLUS: "+", MINUS: "-", STAR: "*", SLASH: "/", PERCENT: "%",
  LPAREN: "(", RPAREN: ")", COMMA: ",",
  EQ: "==", NEQ: "!=", LT: "<", GT: ">", LTE: "<=", GTE: ">=",
  AND: "AND", OR: "OR", NOT: "NOT", EOF: "eof",
} as const

function calcTokenize(input: string): any[] {
  const tokens: any[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(input[i+1] || ""))) {
      let j = i
      while (j < input.length && /[0-9.]/.test(input[j])) j++
      tokens.push({ type: CALC_TOK.NUMBER, value: parseFloat(input.slice(i, j)) })
      i = j; continue
    }
    if (c === '"' || c === "'") {
      const quote = c; let j = i + 1; let s = ""
      while (j < input.length && input[j] !== quote) {
        if (input[j] === "\\" && j+1 < input.length) { s += input[j+1]; j += 2 }
        else { s += input[j]; j++ }
      }
      tokens.push({ type: CALC_TOK.STRING, value: s })
      i = j + 1; continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++
      const word = input.slice(i, j); const upper = word.toUpperCase()
      if (upper === "AND")   tokens.push({ type: CALC_TOK.AND })
      else if (upper === "OR")  tokens.push({ type: CALC_TOK.OR })
      else if (upper === "NOT") tokens.push({ type: CALC_TOK.NOT })
      else if (upper === "TRUE")  tokens.push({ type: CALC_TOK.BOOL, value: true })
      else if (upper === "FALSE") tokens.push({ type: CALC_TOK.BOOL, value: false })
      else if (upper === "NULL")  tokens.push({ type: CALC_TOK.NULL })
      else tokens.push({ type: CALC_TOK.IDENT, value: word })
      i = j; continue
    }
    if (c === "=" && input[i+1] === "=") { tokens.push({ type: CALC_TOK.EQ }); i += 2; continue }
    if (c === "!" && input[i+1] === "=") { tokens.push({ type: CALC_TOK.NEQ }); i += 2; continue }
    if (c === "<" && input[i+1] === ">") { tokens.push({ type: CALC_TOK.NEQ }); i += 2; continue }
    if (c === "<" && input[i+1] === "=") { tokens.push({ type: CALC_TOK.LTE }); i += 2; continue }
    if (c === ">" && input[i+1] === "=") { tokens.push({ type: CALC_TOK.GTE }); i += 2; continue }
    if (c === "&" && input[i+1] === "&") { tokens.push({ type: CALC_TOK.AND }); i += 2; continue }
    if (c === "|" && input[i+1] === "|") { tokens.push({ type: CALC_TOK.OR }); i += 2; continue }
    switch (c) {
      case "+": tokens.push({ type: CALC_TOK.PLUS });    i++; continue
      case "-": tokens.push({ type: CALC_TOK.MINUS });   i++; continue
      case "*": tokens.push({ type: CALC_TOK.STAR });    i++; continue
      case "/": tokens.push({ type: CALC_TOK.SLASH });   i++; continue
      case "%": tokens.push({ type: CALC_TOK.PERCENT }); i++; continue
      case "(": tokens.push({ type: CALC_TOK.LPAREN });  i++; continue
      case ")": tokens.push({ type: CALC_TOK.RPAREN });  i++; continue
      case ",": tokens.push({ type: CALC_TOK.COMMA });   i++; continue
      case "=": tokens.push({ type: CALC_TOK.EQ });      i++; continue
      case "<": tokens.push({ type: CALC_TOK.LT });      i++; continue
      case ">": tokens.push({ type: CALC_TOK.GT });      i++; continue
      case "!": tokens.push({ type: CALC_TOK.NOT });     i++; continue
    }
    throw new Error(`Unexpected character: ${c}`)
  }
  tokens.push({ type: CALC_TOK.EOF })
  return tokens
}

class CalcParser {
  tokens: any[]; pos: number
  constructor(tokens: any[]) { this.tokens = tokens; this.pos = 0 }
  peek() { return this.tokens[this.pos] }
  consume() { return this.tokens[this.pos++] }
  check(t: string) { return this.peek().type === t }
  match(t: string) { if (this.check(t)) { this.pos++; return true } return false }
  parse() {
    const expr = this.parseOr()
    if (!this.check(CALC_TOK.EOF)) throw new Error("Unexpected trailing tokens")
    return expr
  }
  parseOr(): any { let left = this.parseAnd(); while (this.match(CALC_TOK.OR)) left = { type: "or", left, right: this.parseAnd() }; return left }
  parseAnd(): any { let left = this.parseNot(); while (this.match(CALC_TOK.AND)) left = { type: "and", left, right: this.parseNot() }; return left }
  parseNot(): any { if (this.match(CALC_TOK.NOT)) return { type: "not", operand: this.parseNot() }; return this.parseCmp() }
  parseCmp(): any {
    const left = this.parseAddSub()
    const cmpTypes: string[] = [CALC_TOK.EQ, CALC_TOK.NEQ, CALC_TOK.LT, CALC_TOK.GT, CALC_TOK.LTE, CALC_TOK.GTE]
    if (cmpTypes.includes(this.peek().type)) {
      const op = this.consume().type
      return { type: "cmp", op, left, right: this.parseAddSub() }
    }
    return left
  }
  parseAddSub(): any {
    let left = this.parseMulDiv()
    while (this.check(CALC_TOK.PLUS) || this.check(CALC_TOK.MINUS)) {
      const op = this.consume().type
      left = { type: "binop", op, left, right: this.parseMulDiv() }
    }
    return left
  }
  parseMulDiv(): any {
    let left = this.parseUnary()
    while ([CALC_TOK.STAR, CALC_TOK.SLASH, CALC_TOK.PERCENT].includes(this.peek().type)) {
      const op = this.consume().type
      left = { type: "binop", op, left, right: this.parseUnary() }
    }
    return left
  }
  parseUnary(): any {
    if (this.match(CALC_TOK.MINUS)) return { type: "neg", operand: this.parseUnary() }
    return this.parsePrimary()
  }
  parsePrimary(): any {
    const tk = this.peek()
    if (tk.type === CALC_TOK.NUMBER) { this.consume(); return { type: "num", value: tk.value } }
    if (tk.type === CALC_TOK.STRING) { this.consume(); return { type: "str", value: tk.value } }
    if (tk.type === CALC_TOK.BOOL)   { this.consume(); return { type: "bool", value: tk.value } }
    if (tk.type === CALC_TOK.NULL)   { this.consume(); return { type: "null" } }
    if (tk.type === CALC_TOK.LPAREN) {
      this.consume()
      const inner = this.parseOr()
      if (!this.match(CALC_TOK.RPAREN)) throw new Error("Expected closing )")
      return inner
    }
    if (tk.type === CALC_TOK.IDENT) {
      this.consume()
      if (this.check(CALC_TOK.LPAREN)) {
        this.consume()
        const args: any[] = []
        if (!this.check(CALC_TOK.RPAREN)) {
          args.push(this.parseOr())
          while (this.match(CALC_TOK.COMMA)) args.push(this.parseOr())
        }
        if (!this.match(CALC_TOK.RPAREN)) throw new Error("Expected closing ) after function args")
        return { type: "call", name: tk.value.toUpperCase(), args }
      }
      return { type: "ident", name: tk.value }
    }
    throw new Error(`Unexpected token: ${tk.type}`)
  }
}

function calcEval(node: any, ctx: any): any {
  switch (node.type) {
    case "num":  return node.value
    case "str":  return node.value
    case "bool": return node.value
    case "null": return null
    case "neg":  return -calcToNumber(calcEval(node.operand, ctx))
    case "not":  return !calcToBool(calcEval(node.operand, ctx))
    case "and":  return calcToBool(calcEval(node.left, ctx)) && calcToBool(calcEval(node.right, ctx))
    case "or":   return calcToBool(calcEval(node.left, ctx)) || calcToBool(calcEval(node.right, ctx))
    case "binop": {
      const a = calcEval(node.left, ctx)
      const b = calcEval(node.right, ctx)
      switch (node.op) {
        case CALC_TOK.PLUS:    return (typeof a === "string" || typeof b === "string") ? String(a) + String(b) : calcToNumber(a) + calcToNumber(b)
        case CALC_TOK.MINUS:   return calcToNumber(a) - calcToNumber(b)
        case CALC_TOK.STAR:    return calcToNumber(a) * calcToNumber(b)
        case CALC_TOK.SLASH:   { const d = calcToNumber(b); return d === 0 ? null : calcToNumber(a) / d }
        case CALC_TOK.PERCENT: { const d = calcToNumber(b); return d === 0 ? null : calcToNumber(a) % d }
      }
      return null
    }
    case "cmp": {
      const a = calcEval(node.left, ctx); const b = calcEval(node.right, ctx)
      switch (node.op) {
        case CALC_TOK.EQ:  return a == b
        case CALC_TOK.NEQ: return a != b
        case CALC_TOK.LT:  return calcToComparable(a) < calcToComparable(b)
        case CALC_TOK.GT:  return calcToComparable(a) > calcToComparable(b)
        case CALC_TOK.LTE: return calcToComparable(a) <= calcToComparable(b)
        case CALC_TOK.GTE: return calcToComparable(a) >= calcToComparable(b)
      }
      return null
    }
    case "ident": {
      const name = node.name
      if (ctx.row && Object.prototype.hasOwnProperty.call(ctx.row, name)) return ctx.row[name]
      return null
    }
    case "call": {
      const args = node.args.map((a: any) => calcEval(a, ctx))
      return calcCallFunction(node.name, args)
    }
  }
  return null
}

function calcCallFunction(name: string, args: any[]): any {
  switch (name) {
    case "TODAY": return new Date(new Date().toISOString().slice(0, 10))
    case "NOW":   return new Date()
    case "IF":    return calcToBool(args[0]) ? args[1] : args[2]
    case "ISNULL": return args[0] == null
    case "ABS":   return Math.abs(calcToNumber(args[0]))
    case "ROUND": {
      const digits = calcToNumber(args[1] ?? 0)
      const f = Math.pow(10, digits)
      return Math.round(calcToNumber(args[0]) * f) / f
    }
    case "MIN": return args.length === 0 ? null : Math.min(...args.map(calcToNumber))
    case "MAX": return args.length === 0 ? null : Math.max(...args.map(calcToNumber))
    case "LEN":   return String(args[0] ?? "").length
    case "UPPER": return String(args[0] ?? "").toUpperCase()
    case "LOWER": return String(args[0] ?? "").toLowerCase()
    case "TRIM":  return String(args[0] ?? "").trim()
    case "CONCATENATE": return args.map(a => a == null ? "" : String(a)).join("")
    case "TEXT":  return args[0] == null ? "" : String(args[0])
    case "YEAR":  { const d = calcToDate(args[0]); return d ? d.getFullYear() : null }
    case "MONTH": { const d = calcToDate(args[0]); return d ? d.getMonth() + 1 : null }
    case "DAY":   { const d = calcToDate(args[0]); return d ? d.getDate() : null }
    case "DAYS_BETWEEN": {
      const a = calcToDate(args[0]); const b = calcToDate(args[1])
      if (!a || !b) return null
      return Math.floor((a.getTime() - b.getTime()) / 86400000)
    }
  }
  throw new Error(`Unknown function: ${name}`)
}

function calcToNumber(v: any): number {
  if (v == null || v === "") return 0
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
function calcToBool(v: any): boolean {
  if (v == null) return false
  if (typeof v === "boolean") return v
  if (typeof v === "number") return v !== 0
  if (typeof v === "string") return v.length > 0 && v.toLowerCase() !== "false"
  return !!v
}
function calcToComparable(v: any): any {
  if (v instanceof Date) return v.getTime()
  if (typeof v === "string") {
    const d = new Date(v)
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(v)) return d.getTime()
  }
  return v
}
function calcToDate(v: any): Date | null {
  if (v == null) return null
  if (v instanceof Date) return v
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// Public entry point. Tokenize, parse, walk. Returns null on any error
// (logged for the schedule-run audit).
function evaluateRowExpression(expression: string, row: any): any {
  try {
    const tokens = calcTokenize(expression)
    const ast = new CalcParser(tokens).parse()
    return calcEval(ast, { row })
  } catch (err) {
    console.warn(`Calc-field eval failed for "${expression}":`, (err as Error).message)
    return null
  }
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
      // Walk the chain. PostgREST nests: row[fk1][fk2]...[fkN][field]. Each
      // hop is an object (or null if the FK resolved to null), so guard at
      // every step.
      let cur: any = row
      for (const fk of c.via_path) {
        if (cur == null) break
        cur = cur[fk]
      }
      return escape(cur ? cur[c.name] : null)
    }
    return escape(row[c.name])
  }).join(","))
  return [header, ...dataRows].join("\n")
}

// ─── Attachment dispatcher ────────────────────────────────────────────────
// Single entry point for all output formats. Each format returns
// { bytes, mime, ext }. The builder for the format is chosen at call time
// and the heavy package (SheetJS for xlsx, pdf-lib for pdf) is dynamically
// imported so unused formats don't hit the per-invocation cold-start of
// an esm.sh resolution.

async function buildAttachment(
  result: RunResult,
  reportName: string,
  format: string,
): Promise<{ bytes: Uint8Array, mime: string, ext: string }> {
  switch (format) {
    case "csv":
    case "":
    case undefined as any: {
      const csv = buildCsv(result.rows, result.columns)
      return {
        bytes: new TextEncoder().encode(csv),
        mime:  "text/csv",
        ext:   "csv",
      }
    }
    case "xlsx": {
      const bytes = await buildXlsx(result.rows, result.columns, reportName)
      return {
        bytes,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ext:  "xlsx",
      }
    }
    case "pdf": {
      const bytes = await buildPdf(result, reportName)
      return {
        bytes,
        mime: "application/pdf",
        ext:  "pdf",
      }
    }
    default:
      throw new Error(`Unknown format '${format}' — please pick CSV, XLSX, or PDF in the schedule editor.`)
  }
}

// ─── XLSX builder ─────────────────────────────────────────────────────────
// Uses SheetJS (xlsx package via esm.sh). Produces a single worksheet
// with header row and one row per record. Same getRowValue logic as CSV
// (one-hop FK embeds; primary-object picklist labels already substituted
// into rows by runReportSimple).

async function buildXlsx(rows: any[], columns: any[], reportName: string): Promise<Uint8Array> {
  // Dynamic import keeps the Deno cold-start cheap when CSV is requested.
  const XLSX = await import("https://esm.sh/xlsx@0.18.5")

  // Build a 2D array: [headers, ...data rows]. SheetJS aoa_to_sheet
  // handles all the cell-encoding work and is the path with the
  // narrowest API surface — JSON-driven sheet construction sometimes
  // bumps into edge cases with null/undefined values.
  const headerRow = columns.map(c => c.label || c.name || "")
  const dataRows = rows.map(row => columns.map(c => {
    let v: any
    if (c.via_path?.length) {
      // Walk the chain — same logic as buildCsv. PostgREST nests deeply
      // on multi-hop embeds; each level is an object or null.
      let cur: any = row
      for (const fk of c.via_path) {
        if (cur == null) break
        cur = cur[fk]
      }
      v = cur ? cur[c.name] : null
    } else {
      v = row[c.name]
    }
    if (v == null) return ""
    if (typeof v === "object") return JSON.stringify(v)
    return v
  }))
  const aoa = [headerRow, ...dataRows]

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Bold header row + auto-width columns. SheetJS doesn't compute widths
  // automatically; we estimate from header + sample data lengths.
  const colWidths: { wch: number }[] = []
  for (let c = 0; c < columns.length; c++) {
    let max = String(headerRow[c] || "").length
    // Sample up to 100 rows to keep this O(small) for big sheets
    const sample = Math.min(100, dataRows.length)
    for (let r = 0; r < sample; r++) {
      const cell = dataRows[r][c]
      if (cell != null) {
        const len = String(cell).length
        if (len > max) max = len
      }
    }
    // Cap at 50 so a single long cell doesn't blow up the layout
    colWidths.push({ wch: Math.min(50, Math.max(8, max + 2)) })
  }
  ws["!cols"] = colWidths

  // Header style — SheetJS supports per-cell style via cell.s when the
  // package is built with cell-styles; standard esm.sh build doesn't
  // ship those. Header bolding is a 'nice to have' that we're skipping
  // to keep the dependency lean. If the user wants a styled header
  // they can open in Excel and apply a table style in two clicks.

  const wb = XLSX.utils.book_new()
  // Sheet name has 31-char Excel limit + can't contain :\/?*[]
  const sheetName = reportName.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Report"
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  // Write to ArrayBuffer → Uint8Array. type: "array" returns a Uint8Array
  // directly in Deno; type: "buffer" returns a Node Buffer (not available
  // in Deno's V8 build). Use "array" for portability.
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" })
  return new Uint8Array(out)
}

// ─── PDF builder ──────────────────────────────────────────────────────────
// Renders the report as a PDF, respecting rpt_format:
//   • tabular — flat header + body, header repeats on page break
//   • summary — group tree with indented headers, subtotal per group, grand total
//   • matrix  — pivot with multi-level column-axis headers + measure cells
//
// Letter landscape (792 × 612 pt). pdf-lib via esm.sh — same package as
// generate-project-report. Dynamic import keeps CSV/XLSX cold-start
// unchanged. Page numbers stamped after content layout in a second pass.
//
// Soft-degraded: summary-scope calculated fields are not evaluated (same
// behavior as CSV/XLSX; warning already emitted by validateReport).

const PDF_PAGE_W = 792
const PDF_PAGE_H = 612
const PDF_MARGIN = 40
const PDF_TOP    = 56
const PDF_BOT    = 44
const PDF_CW     = PDF_PAGE_W - PDF_MARGIN * 2

// Colors in pdf-lib rgb(0..1). Matches the in-app design palette.
function rgb01(r: number, g: number, b: number) { return { r, g, b } }
const PDF_C = {
  textPrimary:   rgb01(13/255,  26/255,  46/255),
  textSecondary: rgb01(74/255,  94/255, 122/255),
  textMuted:     rgb01(143/255, 160/255, 184/255),
  border:        rgb01(228/255, 233/255, 242/255),
  borderDark:    rgb01(208/255, 216/255, 232/255),
  emerald:       rgb01(62/255,  207/255, 142/255),
  card:          rgb01(247/255, 249/255, 252/255),
  cardAlt:       rgb01(240/255, 243/255, 248/255),
  totalsBg:      rgb01(220/255, 228/255, 240/255),
  white:         rgb01(1, 1, 1),
}

interface PdfCursor {
  pdf: any
  font: any
  fontBold: any
  pages: any[]
  page: any
  y: number
  rgb: (r: number, g: number, b: number) => any
}

function newPdfPage(c: PdfCursor): any {
  const p = c.pdf.addPage([PDF_PAGE_W, PDF_PAGE_H])
  c.pages.push(p)
  c.page = p
  c.y = PDF_PAGE_H - PDF_TOP
  return p
}
function pdfEnsure(c: PdfCursor, needed: number) {
  if (c.y - needed < PDF_BOT) newPdfPage(c)
}
function pdfRgb(c: PdfCursor, color: {r:number,g:number,b:number}) {
  return c.rgb(color.r, color.g, color.b)
}

function pdfWrap(text: string, font: any, size: number, maxW: number): string[] {
  if (!text) return [""]
  const out: string[] = []
  for (const rawLine of String(text).split("\n")) {
    if (!rawLine) { out.push(""); continue }
    const words = rawLine.split(/\s+/)
    let line = ""
    for (const w of words) {
      const trial = line ? line + " " + w : w
      if (font.widthOfTextAtSize(trial, size) <= maxW) {
        line = trial
      } else {
        if (line) out.push(line)
        if (font.widthOfTextAtSize(w, size) > maxW) {
          let chunk = ""
          for (const ch of w) {
            const t2 = chunk + ch
            if (font.widthOfTextAtSize(t2, size) <= maxW) chunk = t2
            else { out.push(chunk); chunk = ch }
          }
          line = chunk
        } else line = w
      }
    }
    out.push(line)
  }
  return out
}

// Truncate to a single line with an ellipsis if it overflows maxW.
// Used inside table cells where rows must be uniform height.
function pdfFit(text: string, font: any, size: number, maxW: number): string {
  if (!text) return ""
  const s = String(text)
  if (font.widthOfTextAtSize(s, size) <= maxW) return s
  const ell = "…"
  let lo = 0, hi = s.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (font.widthOfTextAtSize(s.slice(0, mid) + ell, size) <= maxW) lo = mid
    else hi = mid - 1
  }
  return s.slice(0, lo) + ell
}

function pdfDrawText(c: PdfCursor, text: string, opts: {
  size?: number, color?: any, bold?: boolean, x?: number, maxW?: number, lh?: number
} = {}) {
  const size = opts.size ?? 10
  const color = opts.color ?? pdfRgb(c, PDF_C.textPrimary)
  const font = opts.bold ? c.fontBold : c.font
  const x = opts.x ?? PDF_MARGIN
  const maxW = opts.maxW ?? PDF_CW
  const lh = opts.lh ?? size * 1.4
  const lines = pdfWrap(text || "", font, size, maxW)
  for (const line of lines) {
    pdfEnsure(c, lh)
    c.page.drawText(line, { x, y: c.y - size, size, font, color })
    c.y -= lh
  }
}

function pdfDrawRect(c: PdfCursor, x: number, y: number, w: number, h: number, color: any) {
  c.page.drawRectangle({ x, y, width: w, height: h, color })
}
function pdfDrawLine(c: PdfCursor, x1: number, y1: number, x2: number, y2: number, color: any, thickness = 0.5) {
  c.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color })
}

// Format a cell value for PDF display. Mirrors src/modules/ReportRunner.jsx
// formatCellValue: booleans → Yes/No, dates → locale, numbers → toLocaleString,
// UUIDs → truncated. Returns a plain string (no React).
function pdfFormatCell(v: any, type?: string): string {
  if (v == null) return ""
  if (typeof v === "object") return "[obj]"
  if (type === "boolean" || type === "bool") return v ? "Yes" : "No"
  if (type === "timestamp with time zone" || type === "timestamptz" || type === "timestamp") {
    try { return new Date(v).toLocaleString() } catch { return String(v) }
  }
  if (type === "date") {
    try { return new Date(v).toLocaleDateString() } catch { return String(v) }
  }
  if (typeof v === "number") return v.toLocaleString()
  if (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return v.slice(0, 8) + "…"
  }
  return String(v)
}

// Walk via_path on a row to resolve a column's value. Mirrors the
// buildCsv / buildXlsx walk pattern. Picklist substitution is already
// applied to row[col.name] by runReportSimple for direct fields; for
// via_path fields the embedded record's columns are uncooked, but the
// label resolution is not the dispatcher's concern in v10.
function pdfResolveCell(row: any, col: any): any {
  if (col.via_path?.length) {
    let cur: any = row
    for (const fk of col.via_path) {
      if (cur == null) break
      cur = cur[fk]
    }
    return cur ? cur[col.name] : null
  }
  return row[col.name]
}

// Estimate per-column widths in points based on header label width and
// up to 60 sample row widths, then scale to fit PDF_CW. Each column gets
// a minimum width so very narrow columns are still labeled. Mirrors the
// xlsx builder's heuristic (sample up to 100; cap at 50 chars), tuned
// for PDF pt instead of Excel character units.
function pdfEstimateColWidths(rows: any[], columns: any[], font: any, fontBold: any, headerSize: number, bodySize: number, totalW: number): number[] {
  const minW = 40
  const maxW = 220
  const padding = 12
  const raws: number[] = []
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i]
    let max = fontBold.widthOfTextAtSize(c.label || c.name || "", headerSize)
    const sample = Math.min(60, rows.length)
    for (let r = 0; r < sample; r++) {
      const v = pdfFormatCell(pdfResolveCell(rows[r], c), c._data_type || c.type)
      const w = font.widthOfTextAtSize(String(v), bodySize)
      if (w > max) max = w
    }
    raws.push(Math.max(minW, Math.min(maxW, max + padding)))
  }
  // Scale to fit (or shrink if over)
  const sum = raws.reduce((a, b) => a + b, 0)
  if (sum <= totalW) return raws
  const scale = totalW / sum
  return raws.map(w => Math.max(minW, w * scale))
}

// ─── Tabular renderer ─────────────────────────────────────────────────────

function pdfRenderTabular(c: PdfCursor, result: RunResult) {
  const { rows, columns } = result
  if (columns.length === 0) {
    pdfDrawText(c, "No fields selected. Edit the report to add fields.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 })
    return
  }
  if (rows.length === 0) {
    pdfDrawText(c, "No matching rows.", { color: pdfRgb(c, PDF_C.textMuted), size: 11 })
    return
  }

  const headerSize = 9
  const bodySize   = 9
  const headerH    = 22
  const rowH       = 18
  const colWidths = pdfEstimateColWidths(rows, columns, c.font, c.fontBold, headerSize, bodySize, PDF_CW)

  const drawHeader = () => {
    pdfEnsure(c, headerH + rowH)
    pdfDrawRect(c, PDF_MARGIN, c.y - headerH, PDF_CW, headerH, pdfRgb(c, PDF_C.card))
    let x = PDF_MARGIN + 6
    for (let i = 0; i < columns.length; i++) {
      const label = pdfFit(columns[i].label || columns[i].name || "", c.fontBold, headerSize, colWidths[i] - 8)
      c.page.drawText(label, {
        x, y: c.y - headerH + 7, size: headerSize,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
      })
      x += colWidths[i]
    }
    c.y -= headerH
    pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.6)
  }

  drawHeader()
  for (let r = 0; r < rows.length; r++) {
    if (c.y - rowH < PDF_BOT) { newPdfPage(c); drawHeader() }
    const row = rows[r]
    if (r % 2 === 1) {
      pdfDrawRect(c, PDF_MARGIN, c.y - rowH, PDF_CW, rowH, pdfRgb(c, PDF_C.cardAlt))
    }
    let x = PDF_MARGIN + 6
    for (let i = 0; i < columns.length; i++) {
      const v = pdfFormatCell(pdfResolveCell(row, columns[i]), columns[i]._data_type || (columns[i] as any).type)
      c.page.drawText(pdfFit(v, c.font, bodySize, colWidths[i] - 8), {
        x, y: c.y - rowH + 5, size: bodySize,
        font: c.font, color: pdfRgb(c, PDF_C.textPrimary),
      })
      x += colWidths[i]
    }
    c.y -= rowH
    pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.border), 0.25)
  }
}

// ─── Summary renderer ─────────────────────────────────────────────────────
// Builds the group tree exactly like SummaryLayout in src/modules/ReportRunner.jsx:
// recursive bucketing by each grouping field, sorted per grouping direction,
// then walked to emit group headers, leaf rows under leaves, and subtotal
// rows on the way back up.
//
// Summary-scope calculated fields are not evaluated here — same soft-degrade
// as CSV/XLSX. validateReport already warned the operator if any are present.

interface SummaryNode {
  leafRows?: any[]
  groupingLevel?: number
  children?: { value: any, level: number, rows: any[], child: SummaryNode }[]
}

function pdfBuildSummaryTree(rows: any[], groupings: ReportGrouping[], level: number): SummaryNode {
  if (level >= groupings.length) return { leafRows: rows }
  const g = groupings[level]
  const buckets = new Map<any, any[]>()
  for (const row of rows) {
    const fieldDef = { name: g.field_name, via_path: g.field_via_path }
    const key = pdfResolveCell(row, fieldDef as any)
    const k = key ?? "(blank)"
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(row)
  }
  const dir = g.sort_direction === "desc" ? -1 : 1
  const sorted = Array.from(buckets.entries()).sort((a, b) => {
    if (a[0] === b[0]) return 0
    return (a[0] < b[0] ? -1 : 1) * dir
  })
  return {
    groupingLevel: level,
    children: sorted.map(([key, rs]) => ({
      value: key, level, rows: rs,
      child: pdfBuildSummaryTree(rs, groupings, level + 1),
    })),
  }
}

function pdfRenderSummary(c: PdfCursor, result: RunResult) {
  const { rows, columns, groupings } = result
  if (groupings.length === 0) {
    pdfDrawText(c, "Summary reports require at least one grouping. Edit the report to add groupings.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 })
    return
  }
  if (rows.length === 0) {
    pdfDrawText(c, "No matching rows.", { color: pdfRgb(c, PDF_C.textMuted), size: 11 })
    return
  }
  if (columns.length === 0) {
    pdfDrawText(c, "No fields selected. Edit the report to add fields.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 })
    return
  }

  const headerSize = 9
  const bodySize   = 9
  const headerH    = 22
  const rowH       = 18
  const groupHdrH  = 22
  const subtotalH  = 20
  const indent     = 14
  const colWidths = pdfEstimateColWidths(rows, columns, c.font, c.fontBold, headerSize, bodySize, PDF_CW)

  const drawHeader = () => {
    pdfEnsure(c, headerH + rowH)
    pdfDrawRect(c, PDF_MARGIN, c.y - headerH, PDF_CW, headerH, pdfRgb(c, PDF_C.card))
    let x = PDF_MARGIN + 6
    for (let i = 0; i < columns.length; i++) {
      const label = pdfFit(columns[i].label || columns[i].name || "", c.fontBold, headerSize, colWidths[i] - 8)
      c.page.drawText(label, {
        x, y: c.y - headerH + 7, size: headerSize,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
      })
      x += colWidths[i]
    }
    c.y -= headerH
    pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.6)
  }

  drawHeader()

  const walk = (node: SummaryNode, depth: number) => {
    if (node.leafRows) {
      for (let r = 0; r < node.leafRows.length; r++) {
        if (c.y - rowH < PDF_BOT) { newPdfPage(c); drawHeader() }
        const row = node.leafRows[r]
        let xx = PDF_MARGIN + 6
        for (let i = 0; i < columns.length; i++) {
          const v = pdfFormatCell(pdfResolveCell(row, columns[i]), columns[i]._data_type || (columns[i] as any).type)
          const indentX = (i === 0) ? depth * indent : 0
          c.page.drawText(pdfFit(v, c.font, bodySize, colWidths[i] - 8 - indentX), {
            x: xx + indentX, y: c.y - rowH + 5, size: bodySize,
            font: c.font, color: pdfRgb(c, PDF_C.textPrimary),
          })
          xx += colWidths[i]
        }
        c.y -= rowH
        pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.border), 0.25)
      }
      return
    }
    if (!node.children) return
    for (const child of node.children) {
      // Group header row
      if (c.y - groupHdrH < PDF_BOT) { newPdfPage(c); drawHeader() }
      pdfDrawRect(c, PDF_MARGIN, c.y - groupHdrH, PDF_CW, groupHdrH, pdfRgb(c, PDF_C.card))
      pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.8)
      const g = groupings[child.level]
      const groupLabel = `${g.field_label}: ${String(child.value)}`
      const countLabel = ` (${child.rows.length})`
      const xText = PDF_MARGIN + 6 + child.level * indent
      const groupMaxW = PDF_CW - (xText - PDF_MARGIN) - c.font.widthOfTextAtSize(countLabel, bodySize) - 8
      c.page.drawText(pdfFit(groupLabel, c.fontBold, bodySize + 0.5, groupMaxW), {
        x: xText, y: c.y - groupHdrH + 7, size: bodySize + 0.5,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textPrimary),
      })
      const groupLabelW = c.fontBold.widthOfTextAtSize(pdfFit(groupLabel, c.fontBold, bodySize + 0.5, groupMaxW), bodySize + 0.5)
      c.page.drawText(countLabel, {
        x: xText + groupLabelW, y: c.y - groupHdrH + 7, size: bodySize,
        font: c.font, color: pdfRgb(c, PDF_C.textMuted),
      })
      c.y -= groupHdrH

      walk(child.child, child.level + 1)

      // Subtotal row
      const g2 = groupings[child.level]
      if (g2.show_subtotal !== false) {
        if (c.y - subtotalH < PDF_BOT) { newPdfPage(c); drawHeader() }
        pdfDrawRect(c, PDF_MARGIN, c.y - subtotalH, PDF_CW, subtotalH, pdfRgb(c, PDF_C.cardAlt))
        const subLabel = `Subtotal — ${g2.field_label}: ${String(child.value)} (${child.rows.length} rows)`
        c.page.drawText(pdfFit(subLabel, c.fontBold, bodySize, PDF_CW - 12), {
          x: PDF_MARGIN + 6 + child.level * indent,
          y: c.y - subtotalH + 6, size: bodySize,
          font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
        })
        c.y -= subtotalH
        pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.4)
      }
    }
  }

  const tree = pdfBuildSummaryTree(rows, groupings, 0)
  walk(tree, 0)

  // Grand total
  const grandH = 24
  if (c.y - grandH < PDF_BOT) { newPdfPage(c) }
  pdfDrawRect(c, PDF_MARGIN, c.y - grandH, PDF_CW, grandH, pdfRgb(c, PDF_C.totalsBg))
  c.page.drawText(`Grand Total — ${rows.length} rows`, {
    x: PDF_MARGIN + 6, y: c.y - grandH + 8, size: bodySize + 1,
    font: c.fontBold, color: pdfRgb(c, PDF_C.textPrimary),
  })
  c.y -= grandH
}

// ─── Matrix renderer ──────────────────────────────────────────────────────
// Pivot output: row-axis groupings × column-axis groupings. Mirrors
// MatrixLayout in src/modules/ReportRunner.jsx. Multi-level column
// headers are drawn as a header band with cells spanning their leaf
// descendants; row-axis labels fill the leftmost columns; data cells
// hold the measure applied to (row-leaf, col-leaf) row intersections.
//
// If the combined column count overflows the page width, the right-most
// data columns are truncated and a "+N more" indicator is rendered.

interface AxisNode {
  level?: number
  leafRows?: any[]
  children?: { key: any, level: number, child: AxisNode }[]
}

function pdfBuildAxisTree(
  rows: any[],
  groupings: { name: string, via_path?: string[]|null, sort?: string }[],
  level: number,
): AxisNode {
  if (level >= groupings.length) return { leafRows: rows }
  const g = groupings[level]
  const buckets = new Map<any, any[]>()
  for (const row of rows) {
    const v = pdfResolveCell(row, { name: g.name, via_path: g.via_path } as any)
    const k = v ?? "(blank)"
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)!.push(row)
  }
  const dir = g.sort === "desc" ? -1 : 1
  const sorted = Array.from(buckets.entries()).sort((a, b) => {
    if (a[0] === b[0]) return 0
    return (a[0] < b[0] ? -1 : 1) * dir
  })
  return {
    level,
    children: sorted.map(([key, rs]) => ({
      key, level, child: pdfBuildAxisTree(rs, groupings, level + 1),
    })),
  }
}

function pdfFlattenAxisLeaves(node: AxisNode, prefix: any[] = []): { values: any[] }[] {
  if (node.leafRows || !node.children) return [{ values: prefix }]
  const out: { values: any[] }[] = []
  for (const c of node.children) out.push(...pdfFlattenAxisLeaves(c.child, [...prefix, c.key]))
  return out
}

function pdfCountLeaves(node: AxisNode): number {
  if (node.leafRows || !node.children) return 1
  return node.children.reduce((s, c) => s + pdfCountLeaves(c.child), 0)
}

function pdfApplyMeasure(cellRows: any[], measure: { type: string, field: string | null }): number | null {
  if (cellRows.length === 0) return null
  if (measure.type === "count") return cellRows.length
  if (!measure.field) return null
  const values: number[] = []
  for (const r of cellRows) {
    const v = pdfResolveCell(r, { name: measure.field } as any)
    const n = typeof v === "number" ? v : parseFloat(v)
    if (Number.isFinite(n)) values.push(n)
  }
  if (values.length === 0) return null
  switch (measure.type) {
    case "sum": return values.reduce((a, b) => a + b, 0)
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length
    case "min": return Math.min(...values)
    case "max": return Math.max(...values)
  }
  return null
}

function pdfRenderMatrix(c: PdfCursor, result: RunResult) {
  const { rows, groupings, columnGroupings, measure } = result
  if (groupings.length === 0) {
    pdfDrawText(c, "Matrix reports need at least one row grouping.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 }); return
  }
  if (columnGroupings.length === 0) {
    pdfDrawText(c, "Matrix reports need at least one column grouping.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 }); return
  }
  if (rows.length === 0) {
    pdfDrawText(c, "No matching rows.",
      { color: pdfRgb(c, PDF_C.textMuted), size: 11 }); return
  }

  const rowAxisDefs = groupings.map(g => ({ name: g.field_name, via_path: g.field_via_path, label: g.field_label, sort: g.sort_direction }))
  const colAxisDefs = columnGroupings.map(c2 => ({ name: c2.name, via_path: c2.via_path ?? null, label: c2.label || c2.name, sort: c2.sort_direction }))

  const rowAxis = pdfBuildAxisTree(rows, rowAxisDefs, 0)
  const colAxis = pdfBuildAxisTree(rows, colAxisDefs, 0)
  const rowLeaves = pdfFlattenAxisLeaves(rowAxis)
  const colLeaves = pdfFlattenAxisLeaves(colAxis)

  const bodySize = 9
  const hdrSize  = 9
  const rowH     = 18
  const headerLevelH = 20

  // Row-axis label column widths
  const rowLabelWs = rowAxisDefs.map((d, i) => {
    let max = c.fontBold.widthOfTextAtSize(d.label || d.name || "", hdrSize)
    for (const rl of rowLeaves) {
      const v = String(rl.values[i] ?? "")
      const w = c.font.widthOfTextAtSize(v, bodySize)
      if (w > max) max = w
    }
    return Math.max(60, Math.min(160, max + 12))
  })
  const totalRowLabelW = rowLabelWs.reduce((a, b) => a + b, 0)

  // Data column widths — base on header text + measure value width sample.
  // Compute cell measures up front into a Map for both layout sizing and rendering.
  const cellMap = new Map<string, number | null>()
  for (let ri = 0; ri < rowLeaves.length; ri++) {
    for (let ci = 0; ci < colLeaves.length; ci++) {
      const cellRows = rows.filter(row => {
        for (let i = 0; i < rowLeaves[ri].values.length; i++) {
          const v = pdfResolveCell(row, { name: rowAxisDefs[i].name, via_path: rowAxisDefs[i].via_path } as any)
          if ((v ?? "(blank)") !== rowLeaves[ri].values[i]) return false
        }
        for (let i = 0; i < colLeaves[ci].values.length; i++) {
          const v = pdfResolveCell(row, { name: colAxisDefs[i].name, via_path: colAxisDefs[i].via_path } as any)
          if ((v ?? "(blank)") !== colLeaves[ci].values[i]) return false
        }
        return true
      })
      cellMap.set(ri + "###" + ci, pdfApplyMeasure(cellRows, measure))
    }
  }

  const dataColMinW = 50
  const dataColMaxW = 110
  const allDataColWs: number[] = colLeaves.map((cl, ci) => {
    const lastKey = String(cl.values[cl.values.length - 1] ?? "")
    let max = c.fontBold.widthOfTextAtSize(lastKey, hdrSize)
    for (let ri = 0; ri < rowLeaves.length; ri++) {
      const v = cellMap.get(ri + "###" + ci)
      const s = v == null ? "—" : pdfFormatCell(v, "number")
      const w = c.font.widthOfTextAtSize(s, bodySize)
      if (w > max) max = w
    }
    return Math.max(dataColMinW, Math.min(dataColMaxW, max + 14))
  })

  // Fit to page width: drop trailing columns until total fits, render "+N more"
  let availW = PDF_CW - totalRowLabelW
  let visibleColCount = colLeaves.length
  let runningW = 0
  for (let i = 0; i < allDataColWs.length; i++) {
    runningW += allDataColWs[i]
    if (runningW > availW) { visibleColCount = Math.max(1, i); break }
  }
  const truncatedCols = colLeaves.length - visibleColCount

  // ── Multi-level column-axis header band ──────────────────────────────
  const headerLevels = colAxisDefs.length
  const headerBandH = headerLevels * headerLevelH
  pdfEnsure(c, headerBandH + rowH * 2)

  // Top-left corner block (row-axis labels) spans all header levels
  pdfDrawRect(c, PDF_MARGIN, c.y - headerBandH, totalRowLabelW, headerBandH, pdfRgb(c, PDF_C.card))
  {
    let lx = PDF_MARGIN + 6
    for (let i = 0; i < rowAxisDefs.length; i++) {
      const lbl = pdfFit(rowAxisDefs[i].label || rowAxisDefs[i].name, c.fontBold, hdrSize, rowLabelWs[i] - 8)
      c.page.drawText(lbl, {
        x: lx, y: c.y - headerBandH + 6, size: hdrSize,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
      })
      lx += rowLabelWs[i]
    }
  }

  // Emit each header level. For each level, walk the colAxis tree and
  // draw cells centered above the columns they span. The bottom-most
  // level has cells one-to-one with leaves; upper levels span groups.
  const emitLevel = (lvl: number) => {
    const yTop = c.y - lvl * headerLevelH
    let leafIdx = 0
    const visit = (node: AxisNode) => {
      if (!node.children) {
        leafIdx++
        return
      }
      for (const child of node.children) {
        const span = pdfCountLeaves(child.child)
        if (child.level === lvl) {
          // Determine the span in visible columns only
          const visStart = leafIdx
          const visEnd   = leafIdx + span
          const visStartClamped = Math.max(0, visStart)
          const visEndClamped   = Math.min(visibleColCount, visEnd)
          const visSpan = visEndClamped - visStartClamped
          if (visSpan > 0) {
            // x position = data-cols start + sum of preceding visible col widths
            let xStart = PDF_MARGIN + totalRowLabelW
            for (let i = 0; i < visStartClamped; i++) xStart += allDataColWs[i]
            let cellW = 0
            for (let i = visStartClamped; i < visEndClamped; i++) cellW += allDataColWs[i]
            pdfDrawRect(c, xStart, yTop - headerLevelH, cellW, headerLevelH, pdfRgb(c, PDF_C.card))
            const txt = pdfFit(String(child.key), c.fontBold, hdrSize, cellW - 8)
            const txtW = c.fontBold.widthOfTextAtSize(txt, hdrSize)
            c.page.drawText(txt, {
              x: xStart + (cellW - txtW) / 2, y: yTop - headerLevelH + 6,
              size: hdrSize, font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
            })
            // Divider line at the right edge
            pdfDrawLine(c, xStart, yTop - headerLevelH, xStart, yTop, pdfRgb(c, PDF_C.border), 0.4)
          }
          leafIdx += span
        } else {
          visit(child.child)
        }
      }
    }
    visit(colAxis)
  }
  for (let lvl = 0; lvl < headerLevels; lvl++) emitLevel(lvl)

  c.y -= headerBandH
  pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.6)

  // ── Body rows ─────────────────────────────────────────────────────────
  const drawBodyHeader = () => {
    pdfEnsure(c, headerBandH + rowH)
    // Redraw a condensed single-row header on continuation pages: just the
    // bottom level (data columns) + the row-axis label corner.
    pdfDrawRect(c, PDF_MARGIN, c.y - headerLevelH, totalRowLabelW, headerLevelH, pdfRgb(c, PDF_C.card))
    let lx = PDF_MARGIN + 6
    for (let i = 0; i < rowAxisDefs.length; i++) {
      const lbl = pdfFit(rowAxisDefs[i].label || rowAxisDefs[i].name, c.fontBold, hdrSize, rowLabelWs[i] - 8)
      c.page.drawText(lbl, {
        x: lx, y: c.y - headerLevelH + 6, size: hdrSize,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
      })
      lx += rowLabelWs[i]
    }
    let dx = PDF_MARGIN + totalRowLabelW
    for (let ci = 0; ci < visibleColCount; ci++) {
      const w = allDataColWs[ci]
      pdfDrawRect(c, dx, c.y - headerLevelH, w, headerLevelH, pdfRgb(c, PDF_C.card))
      const leaf = colLeaves[ci]
      const txt = pdfFit(String(leaf.values[leaf.values.length - 1] ?? ""), c.fontBold, hdrSize, w - 8)
      const txtW = c.fontBold.widthOfTextAtSize(txt, hdrSize)
      c.page.drawText(txt, {
        x: dx + (w - txtW) / 2, y: c.y - headerLevelH + 6,
        size: hdrSize, font: c.fontBold, color: pdfRgb(c, PDF_C.textSecondary),
      })
      pdfDrawLine(c, dx, c.y - headerLevelH, dx, c.y, pdfRgb(c, PDF_C.border), 0.4)
      dx += w
    }
    c.y -= headerLevelH
    pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.borderDark), 0.6)
  }

  for (let ri = 0; ri < rowLeaves.length; ri++) {
    if (c.y - rowH < PDF_BOT) { newPdfPage(c); drawBodyHeader() }
    if (ri % 2 === 1) pdfDrawRect(c, PDF_MARGIN, c.y - rowH, PDF_CW, rowH, pdfRgb(c, PDF_C.cardAlt))
    // Row-axis label cells
    let x = PDF_MARGIN + 6
    for (let i = 0; i < rowAxisDefs.length; i++) {
      const lbl = pdfFit(String(rowLeaves[ri].values[i] ?? ""), c.fontBold, bodySize, rowLabelWs[i] - 8)
      c.page.drawText(lbl, {
        x, y: c.y - rowH + 5, size: bodySize,
        font: c.fontBold, color: pdfRgb(c, PDF_C.textPrimary),
      })
      x += rowLabelWs[i]
    }
    // Data cells
    let dx = PDF_MARGIN + totalRowLabelW
    for (let ci = 0; ci < visibleColCount; ci++) {
      const w = allDataColWs[ci]
      const v = cellMap.get(ri + "###" + ci)
      const s = v == null ? "—" : pdfFormatCell(v, "number")
      const color = v == null ? pdfRgb(c, PDF_C.textMuted) : pdfRgb(c, PDF_C.textPrimary)
      const txt = pdfFit(s, c.font, bodySize, w - 8)
      const txtW = c.font.widthOfTextAtSize(txt, bodySize)
      c.page.drawText(txt, {
        x: dx + w - txtW - 6, y: c.y - rowH + 5,
        size: bodySize, font: c.font, color,
      })
      dx += w
    }
    c.y -= rowH
    pdfDrawLine(c, PDF_MARGIN, c.y, PDF_PAGE_W - PDF_MARGIN, c.y, pdfRgb(c, PDF_C.border), 0.25)
  }

  if (truncatedCols > 0) {
    pdfEnsure(c, rowH)
    c.y -= 6
    c.page.drawText(`+ ${truncatedCols} more column${truncatedCols === 1 ? "" : "s"} not shown — too wide for the page. Open this report in the app for the full pivot.`, {
      x: PDF_MARGIN, y: c.y - bodySize, size: bodySize - 0.5,
      font: c.font, color: pdfRgb(c, PDF_C.textMuted),
    })
    c.y -= rowH
  }
}

// ─── Top-level PDF builder ────────────────────────────────────────────────

async function buildPdf(result: RunResult, reportName: string): Promise<Uint8Array> {
  // Dynamic import — keeps the dispatcher's cold-start cheap when CSV/XLSX
  // are the requested format. pdf-lib is the same package used by
  // generate-project-report (esm.sh resolves it once per region).
  const { PDFDocument, StandardFonts, rgb } = await import("https://esm.sh/pdf-lib@1.17.1")

  const pdf = await PDFDocument.create()
  const font     = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const cur: PdfCursor = {
    pdf, font, fontBold, pages: [], page: null as any, y: 0, rgb,
  }
  newPdfPage(cur)

  // Header band — report name + format + row count + run timestamp
  pdfDrawText(cur, reportName || "Report", { size: 16, bold: true })
  const meta = `${(result.rows || []).length.toLocaleString()} row${result.rows.length === 1 ? "" : "s"} · ${result.format} · ${result.primaryObject} · ${new Date().toLocaleString()}`
  pdfDrawText(cur, meta, { size: 9, color: pdfRgb(cur, PDF_C.textMuted) })
  cur.y -= 6
  pdfDrawLine(cur, PDF_MARGIN, cur.y, PDF_PAGE_W - PDF_MARGIN, cur.y, pdfRgb(cur, PDF_C.borderDark), 0.6)
  cur.y -= 10

  // Dispatch on format
  switch (result.format) {
    case "summary": pdfRenderSummary(cur, result); break
    case "matrix":  pdfRenderMatrix(cur,  result); break
    default:        pdfRenderTabular(cur, result); break
  }

  // Page numbers — second pass after content layout. Stamp at bottom-center.
  const total = cur.pages.length
  for (let i = 0; i < total; i++) {
    const p = cur.pages[i]
    const label = `Page ${i + 1} of ${total}`
    const w = font.widthOfTextAtSize(label, 8.5)
    p.drawText(label, {
      x: (PDF_PAGE_W - w) / 2, y: 22,
      size: 8.5, font, color: rgb(143/255, 160/255, 184/255),
    })
  }

  const bytes = await pdf.save()
  return new Uint8Array(bytes)
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
