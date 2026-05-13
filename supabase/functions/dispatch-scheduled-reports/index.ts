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

  // ── Build attachment ──────────────────────────────────────────────
  // Dispatch on sr_format. CSV is text via TextEncoder; XLSX is binary
  // via the SheetJS package (esm.sh). PDF is still deferred — it needs
  // real page layout work and a separate session to do well.
  const requestedFormat = (s.sr_format || "csv").toLowerCase()
  let attBytes:  Uint8Array
  let attMime:   string
  let attExt:    string
  try {
    const built = await buildAttachment(rows, columns, reportName, requestedFormat)
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
//   • Picklist label resolution for primary-object fields
//   • FK label auto-embeds for primary-object FK columns
//   • Sort by primary-object columns and one-hop related-object columns
//   • Multi-hop sorts (slow path: client-side comparator)
//
// Hard-incompatible (run fails with report_error before any query work):
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
// and the package is dynamically imported so unused formats don't hit the
// per-invocation cold-start of an esm.sh resolution.

async function buildAttachment(
  rows: any[],
  columns: any[],
  reportName: string,
  format: string,
): Promise<{ bytes: Uint8Array, mime: string, ext: string }> {
  switch (format) {
    case "csv":
    case "":
    case undefined as any: {
      const csv = buildCsv(rows, columns)
      return {
        bytes: new TextEncoder().encode(csv),
        mime:  "text/csv",
        ext:   "csv",
      }
    }
    case "xlsx": {
      const bytes = await buildXlsx(rows, columns, reportName)
      return {
        bytes,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ext:  "xlsx",
      }
    }
    case "pdf": {
      // PDF still deferred — needs page-layout work and a separate session
      // to do well. Fail loudly here so the schedule's audit row gets a
      // clear error message rather than a malformed file.
      throw new Error("PDF format is not supported yet — please pick CSV or XLSX in the schedule editor.")
    }
    default:
      throw new Error(`Unknown format '${format}' — please pick CSV or XLSX in the schedule editor.`)
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
