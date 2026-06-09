// ─── ai-assistant ─────────────────────────────────────────────────────────
// The general LEAP command assistant. Accepts a plain-English instruction plus
// optional record context, drives the Anthropic tool-use loop, and executes
// the chosen actions through LEAP's existing RPCs — never raw SQL, never the
// service role for user actions.
//
// Permission model (the whole point):
//   • The service-role client is used ONLY to resolve the caller (JWT sub →
//     public.users.id) and to write usage rows to flow_ai_usage.
//   • Every action and every data read the assistant performs on the user's
//     behalf goes through a USER-SCOPED client built from the caller's JWT,
//     so auth.uid() inside change_record_status / commit_screen_flow_run /
//     app_user_can resolves to the real user and all RLS + field + scope
//     gates fire exactly as they do in the UI. A technician's assistant can
//     do only what the technician can do.
//
// Confirmation model:
//   • Read-only tools (describe_object, query_records, run_report,
//     global_search, fuzzy_resolve) execute immediately and feed back into the
//     loop.
//   • Mutating tools (record_create, record_update, status_change, and the
//     curated Option-A actions) are NOT executed here. They are returned to
//     the client as a `proposed_actions` array for explicit user
//     confirmation. The client previews them and, on confirm, commits via
//     commit_screen_flow_run (which re-checks every permission server-side).
//   This satisfies the spec's hard rule: the assistant never mutates silently.
//
// Mock mode (no ANTHROPIC_API_KEY): returns a stub reply + logs a zero-cost
// 'mock' usage row, so the surface works before the key is provisioned.
//
// Tool catalog:
//   Option A (curated, high-value verbs):
//     create_work_order, change_status, run_report, create_contact,
//     create_report
//   Option B (generic, any object):
//     describe_object, query_records, create_record, update_record
//   Resolution helpers: global_search, fuzzy_resolve
//   All curated tools lower to the same {record_create|record_update|
//   status_change|report_create} proposed-action shape that
//   commit_screen_flow_run accepts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const MODEL = "claude-sonnet-4-20250514"
const PRICE_INPUT_PER_MTOK  = 3.00
const PRICE_OUTPUT_PER_MTOK = 15.00
const MAX_TURNS = 8   // tool-use loop ceiling per request

interface RecordContext {
  object?:      string   // table name of the record the user is viewing
  record_id?:   string   // uuid of that record
  record_label?: string  // human label for the prompt
}

interface ReqBody {
  message?:   string            // the user's plain-English instruction
  history?:   AnthropicMessage[]// prior turns in this assistant session
  context?:   RecordContext     // current-record context, if any
  flow_id?:   string
  run_id?:    string
}

interface AnthropicMessage {
  role: "user" | "assistant"
  content: unknown
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

// ── Tool catalog ────────────────────────────────────────────────────────────
// Each tool has a JSON schema the model fills. `mutating: true` tools are not
// executed in this function; they are accumulated as proposed actions.
const TOOLS = [
  // ----- Option B: generic, any object -----
  {
    name: "describe_object",
    description: "List the columns, types, and picklist fields of a LEAP object (table) so you know what fields exist before reading or proposing writes. Always call this before create_record/update_record on an object you have not yet described in this conversation.",
    input_schema: {
      type: "object",
      properties: { object: { type: "string", description: "Table name, e.g. work_orders, contacts, opportunities" } },
      required: ["object"],
    },
  },
  {
    name: "query_records",
    description: "Read rows from a LEAP object the user has access to. Row-level security applies automatically. Use for lookups and 'show me' requests. Returns up to 'limit' rows.",
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string" },
        select: { type: "string", description: "Comma-separated column list, or '*'. Default '*'." },
        filters: { type: "array", description: "Equality filters", items: {
          type: "object", properties: { column: { type: "string" }, value: { type: "string" } }, required: ["column","value"] } },
        limit: { type: "integer", description: "Max rows, default 25, ceiling 100" },
      },
      required: ["object"],
    },
  },
  {
    name: "create_record",
    description: "Propose creating one row on any object. This does NOT execute immediately — it is shown to the user for confirmation. Provide the object and a flat map of column → value.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string" },
        values: { type: "object", description: "Map of column name to value" },
        summary: { type: "string", description: "One-line human summary of what this creates" },
      },
      required: ["object","values","summary"],
    },
  },
  {
    name: "update_record",
    description: "Propose updating one existing row on any object. Does NOT execute immediately — shown to the user for confirmation. Never use this to change a status column; use change_status instead.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string" },
        record_id: { type: "string" },
        values: { type: "object" },
        summary: { type: "string" },
      },
      required: ["object","record_id","values","summary"],
    },
  },
  {
    name: "change_status",
    description: "Propose moving a record to a new status. Does NOT execute immediately — shown to the user for confirmation. Status transition rules are validated server-side on commit.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string" },
        record_id: { type: "string" },
        status_field: { type: "string", description: "The status column, e.g. work_order_status. Omit to use the object's default." },
        to_status_id: { type: "string", description: "The picklist_values.id of the target status" },
        note: { type: "string" },
        summary: { type: "string" },
      },
      required: ["object","record_id","to_status_id","summary"],
    },
  },
  // ----- Option A: curated high-value verbs (lower to generic proposed actions) -----
  {
    name: "create_work_order",
    description: "Propose creating a work order. Curated shortcut for the common field-service request. Shown to the user for confirmation.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: { values: { type: "object", description: "work_orders column → value map" }, summary: { type: "string" } },
      required: ["values","summary"],
    },
  },
  {
    name: "create_contact",
    description: "Propose creating a contact. Curated shortcut. Shown to the user for confirmation.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: { values: { type: "object", description: "contacts column → value map" }, summary: { type: "string" } },
      required: ["values","summary"],
    },
  },
  {
    name: "run_report",
    description: "Run an existing saved report by id, or describe what a report would contain. Read-only.",
    input_schema: {
      type: "object",
      properties: { report_id: { type: "string" }, summary: { type: "string" } },
      required: [],
    },
  },
  {
    name: "create_report",
    description: "Propose creating a NEW saved report definition in the Reports module that persists for future use. Does NOT execute immediately — shown to the user for confirmation. Use this when the user asks to create, build, or save a report (not just run or query data). Before calling, ALWAYS use describe_object on the primary object (and any related object you group/filter through) so every column name is real. Supports tabular, summary (grouped with subtotals), and matrix (pivot) reports, plus groupings, calculated fields, charts, and cross-object filters. Pick only the pieces the user asked for; omit the rest.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Report name shown in the Reports module" },
        primary_object: { type: "string", description: "Primary object/table the report is built on, e.g. properties" },
        description: { type: "string" },
        format: { type: "string", description: "tabular (flat list), summary (grouped rows with subtotals), or matrix (pivot rows x columns). Default tabular. Use summary when the user wants grouping/subtotals, matrix when they want a pivot." },
        selected_fields: { type: "array", description: "Columns to include. Array of { field_name, field_table, label } using real column names from describe_object.", items: { type: "object" } },
        filter_logic: { type: "string", description: "How filters combine: 'all' (AND) or 'any' (OR). Default all." },
        filters: { type: "array", description: "Filters. Each: { field_name, field_table, operator (equals, not_equals, contains, greater_than, less_than, is_null, is_not_null, ...), value }. For a cross-object filter (records that DO or DON'T have related records), instead use { is_cross_filter: true, cross_object: '<related table>', cross_match: 'with'|'without', cross_subfilters: [ {field_name, operator, value} ] }.", items: { type: "object" } },
        groupings: { type: "array", description: "Row groupings for summary/matrix reports. Ordered outermost-first. Each: { field_name, field_table, field_label, sort_direction (asc|desc), show_subtotal (bool), date_granularity (day|week|month|quarter|year, for date fields) }.", items: { type: "object" } },
        column_groupings: { type: "array", description: "Matrix-only column axis (up to 3). Each: { name (column field), sort_direction (asc|desc) }.", items: { type: "object" } },
        charts: { type: "array", description: "Chart/measure config. For a summary measure or chart, provide one entry: { measure_type (count|sum|avg|min|max), measure_field (omit for count), chart_type (bar|line|pie|donut, optional) }.", items: { type: "object" } },
        calculated_fields: { type: "array", description: "Formula columns. Each: { label, scope ('row' per-row or 'summary' per-group), expression, data_type (number|currency|percent|date|datetime|text|boolean) }.", items: { type: "object" } },
        summary: { type: "string", description: "One-line human summary of the report being created" },
      },
      required: ["name", "primary_object", "summary"],
    },
  },
  {
    name: "global_search",
    description: "Search across LEAP objects for records matching a text query. Read-only. Use when the user refers to a record by name and you need its id.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        object_type: { type: "string", description: "Optional: restrict to one object" },
        limit_per_object: { type: "integer" },
      },
      required: ["query"],
    },
  },
  {
    name: "fuzzy_resolve",
    description:
      "Resolve a possibly-misspelled or voice-to-text term to a REAL value in LEAP, returning ranked candidates with a similarity score (0-1). Read-only. Use this whenever the user's wording for an entity might be misspelled, mis-heard, or approximate and it must map to an actual stored value before you act. Two kinds:\n" +
      "• kind='record' — match a record by name (uses global_search). Returns records with their id. Use for properties, contacts, accounts, work orders, opportunities, etc. (e.g. user says 'North Willo' → property 'North Willow').\n" +
      "• kind='picklist' — match a picklist/enum value such as a status, record type, or work type for a given object, optionally a specific field (e.g. object='work_orders', term='verifyed' → status 'Verified'). Returns the picklist value id (use as to_status_id for change_status when the field is a status).\n" +
      "Decision rule: if exactly one candidate scores >= 0.6 and clearly dominates, treat it as the match but STILL state the correction to the user ('I read \"North Willo\" as North Willow'). If several are close or the top score is low, present the top candidates and ask which they meant. Never silently substitute a guess.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "'record' or 'picklist'" },
        term: { type: "string", description: "The user's (possibly misspelled) term to resolve" },
        object: { type: "string", description: "Table/object to scope to. Required for kind='picklist'; optional filter for kind='record'." },
        field: { type: "string", description: "picklist only: restrict to one picklist field, e.g. work_order_status. Omit to search all fields on the object." },
        limit: { type: "integer", description: "Max candidates, default 5, ceiling 25" },
      },
      required: ["kind", "term"],
    },
  },
]

const SYSTEM_PROMPT = `You are the LEAP assistant for Energy Efficiency Services of Wisconsin. LEAP is the company's operations platform (CRM, field service, incentives, inventory).

You help the signed-in user take actions by plain conversation: creating records, updating fields, changing statuses, running reports, looking things up. You operate strictly within the user's own permissions — if an action is refused, explain plainly and stop; never try to work around a permission.

Rules:
- Before proposing a create or update on an object, call describe_object for it (unless you already did this conversation) so you use real column names.
- When the user names a record (e.g. "the North Willow work order"), use global_search or query_records to resolve its id before acting on it. Never invent ids.
- The user is often typing fast, dictating by voice-to-text, or misspelling. Treat their wording for any entity as approximate. When a term that must map to a real value looks misspelled, mis-heard, or only approximate, call fuzzy_resolve to ground it:
    • kind='record' for record names (properties, contacts, work orders, …).
    • kind='picklist' for statuses, record types, work types, and other picklist values — pass the object, and the field when you know it (e.g. work_order_status).
  Then:
    • If one candidate clearly dominates (high score, no close rival), proceed with it but ALWAYS state the correction in plain words first — e.g. 'I read "North Willo" as North Willow' or 'I took "verifyed" to mean the Verified status'. Put corrections in your reply text and in each proposed action's summary, so the confirmation card shows exactly what you matched.
    • If several candidates are close, or the best score is weak, do NOT guess. List the top candidates and ask the user which they meant before proposing any action.
- For ordinary misspelled English words that are not entities (e.g. "verifyed", "shedule"), silently read them correctly, but reflect the corrected wording back in your reply and the action summary so the user can confirm you understood ('I read that as: verify work order WO-2841').
- Never set a status column with update_record. Use change_status, which validates transitions. For the target status, resolve it with fuzzy_resolve kind='picklist' and pass the returned id as to_status_id.
- Every mutating action you choose is shown to the user for explicit confirmation before it runs — you never execute changes yourself. Describe clearly what you are about to do and why, including any spelling/entity corrections you applied.
- Be concise and concrete. Use the record context provided if present.
- Never fabricate field values, dates, amounts, or names. If you don't know a value, ask the user or leave it out.`

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST only" }, 405)

  let body: ReqBody
  try { body = await req.json() } catch { return json({ error: "Invalid JSON body" }, 400) }
  if (!body.message && !(body.history && body.history.length)) {
    return json({ error: "Provide a message" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")
  const apiKey      = Deno.env.get("ANTHROPIC_API_KEY")
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Server misconfiguration: Supabase keys missing" }, 500)

  // Service-role client: caller resolution + usage logging ONLY.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const authHeader = req.headers.get("Authorization") || ""
  const callerUserId = await resolveCallerUserId(admin, authHeader)
  if (!callerUserId) return json({ error: "Caller is not a registered LEAP user" }, 401)

  // User-scoped client: ALL reads/actions on the user's behalf run through this.
  // Built from the ANON key + the caller's JWT so the user's role (not the
  // service role) is what Postgres sees — RLS and every app_user_* gate resolve
  // to auth.uid() = the caller. Using the service key here would bypass RLS and
  // defeat the permission model, so it is deliberately NOT used for actions.
  const jwt = authHeader.slice(7)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ── Mock mode ──────────────────────────────────────────────────────────────
  if (!apiKey) {
    await logUsage(admin, {
      userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
      model: "mock", inTok: 0, outTok: 0, cost: 0,
      outcome: "ok", message: "mock mode — ANTHROPIC_API_KEY not set",
    })
    return json({
      mock: true,
      reply: "The assistant is not active yet (API key not configured). Once the key is set I can create records, change statuses, run reports, and more — all within your permissions.",
      proposed_actions: [],
    })
  }

  // ── Build the running message list ──────────────────────────────────────────
  const messages: AnthropicMessage[] = [...(body.history || [])]
  if (body.message) {
    let userText = body.message
    if (body.context?.object) {
      userText += `\n\n[Current record context: object=${body.context.object}` +
        (body.context.record_id ? `, record_id=${body.context.record_id}` : "") +
        (body.context.record_label ? `, label="${body.context.record_label}"` : "") + "]"
    }
    messages.push({ role: "user", content: userText })
  }

  const proposedActions: unknown[] = []
  let totalIn = 0, totalOut = 0
  let finalText = ""
  let endedNaturally = false

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          tools: TOOLS.map(({ mutating, ...t }) => t),
          messages,
        }),
      })

      if (!resp.ok) {
        const errText = await resp.text()
        await logUsage(admin, {
          userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
          model: MODEL, inTok: 0, outTok: 0, cost: 0,
          outcome: "error", message: `Anthropic API ${resp.status}: ${errText.slice(0, 300)}`,
        })
        return json({ error: `Assistant call failed (${resp.status}).`, detail: errText.slice(0, 300) }, 502)
      }

      const data = await resp.json()
      totalIn  += data?.usage?.input_tokens  ?? 0
      totalOut += data?.usage?.output_tokens ?? 0

      const blocks: any[] = data?.content ?? []
      const textBlocks = blocks.filter(b => b.type === "text").map(b => b.text)
      if (textBlocks.length) finalText = textBlocks.join("\n")

      const toolUses = blocks.filter(b => b.type === "tool_use")
      if (toolUses.length === 0) { endedNaturally = true; break }   // model is done

      // Record the assistant turn, then answer each tool_use.
      messages.push({ role: "assistant", content: blocks })
      const toolResults: unknown[] = []

      for (const tu of toolUses) {
        const toolDef = TOOLS.find(t => t.name === tu.name)
        const isMutating = !!(toolDef as any)?.mutating
        let resultText: string

        if (isMutating) {
          // Lower curated verbs to generic proposed-action shape; accumulate.
          const action = lowerToAction(tu.name, tu.input)
          proposedActions.push(action)
          resultText = JSON.stringify({
            status: "proposed",
            note: "Action queued for user confirmation; not yet executed.",
            action,
          })
        } else {
          resultText = await runReadTool(userClient, tu.name, tu.input)
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: resultText,
        })
      }

      messages.push({ role: "user", content: toolResults })
      // Loop: model sees tool results and continues or finishes.
    }

    // If the loop exhausted MAX_TURNS while still mid-tool-use, the model never
    // composed a closing answer — finalText holds only interim narration. Make
    // one more call with tool_choice:none to force a text-only final reply.
    if (!endedNaturally) {
      const closeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          tools: TOOLS.map((t) => { const c = { ...t }; delete (c as any).mutating; return c }),
          tool_choice: { type: "none" },
          messages: [...messages, { role: "user", content: "Give your final answer now in plain text, using what you have already gathered. Do not call any more tools." }],
        }),
      })
      if (closeResp.ok) {
        const cd = await closeResp.json()
        totalIn  += cd?.usage?.input_tokens  ?? 0
        totalOut += cd?.usage?.output_tokens ?? 0
        const closeText = (cd?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
        if (closeText) finalText = closeText
      }
    }
  } catch (e) {
    await logUsage(admin, {
      userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
      model: MODEL, inTok: totalIn, outTok: totalOut, cost: 0,
      outcome: "error", message: `Request error: ${(e as Error).message}`,
    })
    return json({ error: "Assistant request failed." }, 502)
  }

  const cost = (totalIn / 1_000_000) * PRICE_INPUT_PER_MTOK
             + (totalOut / 1_000_000) * PRICE_OUTPUT_PER_MTOK

  await logUsage(admin, {
    userId: callerUserId, flowId: body.flow_id, runId: body.run_id,
    model: MODEL, inTok: totalIn, outTok: totalOut, cost,
    outcome: "ok", message: proposedActions.length ? `${proposedActions.length} action(s) proposed` : null,
  })

  return json({
    mock: false,
    reply: finalText,
    proposed_actions: proposedActions,
    usage: { input_tokens: totalIn, output_tokens: totalOut, estimated_cost_usd: cost },
  })
})

// Lower a curated tool call (or a generic one) to the proposed-action shape
// that commit_screen_flow_run understands: record_create | record_update |
// status_change.
function lowerToAction(name: string, input: any): Record<string, unknown> {
  switch (name) {
    case "create_work_order":
      return { type: "record_create", object: "work_orders", values: input.values, summary: input.summary }
    case "create_contact":
      return { type: "record_create", object: "contacts", values: input.values, summary: input.summary }
    case "create_record":
      return { type: "record_create", object: input.object, values: input.values, summary: input.summary }
    case "update_record":
      return { type: "record_update", object: input.object, record_id: input.record_id, values: input.values, summary: input.summary }
    case "change_status":
      return {
        type: "status_change", object: input.object, record_id: input.record_id,
        status_field: input.status_field || null, to_status_id: input.to_status_id,
        note: input.note || null, summary: input.summary,
      }
    case "create_report":
      return {
        type: "report_create",
        report: {
          name: input.name,
          primary_object: input.primary_object,
          description: input.description || null,
          format: input.format || "tabular",
          selected_fields: input.selected_fields || [],
          filter_logic: input.filter_logic || "all",
          filters: input.filters || [],
          groupings: input.groupings || [],
          column_groupings: input.column_groupings || [],
          charts: input.charts || [],
          calculated_fields: input.calculated_fields || [],
        },
        summary: input.summary,
      }
    default:
      return { type: "unknown", name, input }
  }
}

// Execute a read-only tool through the USER-SCOPED client.
async function runReadTool(userClient: SupabaseClient, name: string, input: any): Promise<string> {
  try {
    if (name === "describe_object") {
      const { data, error } = await userClient.rpc("describe_object_columns", { p_table: input.object })
      if (error) return JSON.stringify({ error: error.message })
      // Trim to essentials — full metadata can be tens of KB and bloats the
      // loop's context, burning turns. Keep name/type/fk/label only.
      const cols = (Array.isArray(data) ? data : []).map((c: any) => ({
        column: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === "YES",
        pk: c.is_primary_key || undefined,
        fk: c.is_foreign_key ? (c.references_table || true) : undefined,
      }))
      return JSON.stringify({ object: input.object, columns: cols })
    }
    if (name === "query_records") {
      const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100)
      let q = userClient.from(input.object).select(input.select || "*").limit(limit)
      for (const f of (input.filters || [])) q = q.eq(f.column, f.value)
      const { data, error } = await q
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({ rows: data, row_count: (data || []).length })
    }
    if (name === "global_search") {
      const { data, error } = await userClient.rpc("global_search", {
        p_query: input.query,
        p_limit_per_object: Math.min(Number(input.limit_per_object) || 5, 20),
        p_object_type: input.object_type || null,
      })
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({ results: data })
    }
    if (name === "run_report") {
      if (!input.report_id) return JSON.stringify({ note: "No report_id provided; ask the user which saved report to run." })
      const { data, error } = await userClient.from("reports").select("*").eq("id", input.report_id).maybeSingle()
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({ report: data })
    }
    if (name === "fuzzy_resolve") {
      const term = String(input.term ?? "").trim()
      if (!term) return JSON.stringify({ error: "Provide a term to resolve." })
      const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 25)
      const kind = input.kind === "picklist" ? "picklist" : "record"

      if (kind === "picklist") {
        if (!input.object) return JSON.stringify({ error: "kind='picklist' requires an object." })
        const { data, error } = await userClient.rpc("fuzzy_resolve_picklist", {
          p_object: input.object,
          p_term: term,
          p_field: input.field || null,
          p_limit: limit,
        })
        if (error) return JSON.stringify({ error: error.message })
        const candidates = (Array.isArray(data) ? data : []).map((r: any) => ({
          id: r.id, field: r.picklist_field, value: r.value, label: r.label,
          score: Math.round((Number(r.score) || 0) * 100) / 100,
        }))
        return JSON.stringify({ kind, term, object: input.object, field: input.field || null, candidates })
      }

      // kind === 'record': lean on global_search (RLS-scoped record matching).
      const { data, error } = await userClient.rpc("global_search", {
        p_query: term,
        p_limit_per_object: limit,
        p_object_type: input.object || null,
      })
      if (error) return JSON.stringify({ error: error.message })
      const candidates = (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id, object: r.table_name, object_label: r.object_label,
        label: r.primary_label, secondary: r.secondary_label || undefined,
        record_number: r.record_number || undefined, match_rank: r.match_rank,
      }))
      return JSON.stringify({ kind, term, object: input.object || null, candidates })
    }
    return JSON.stringify({ error: `Unknown read tool ${name}` })
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message })
  }
}

interface UsageLog {
  userId: string; flowId?: string; runId?: string
  model: string; inTok: number; outTok: number; cost: number
  outcome: string; message: string | null
}

async function logUsage(admin: SupabaseClient, u: UsageLog) {
  try {
    await admin.from("flow_ai_usage").insert({
      fau_record_number: "",
      fau_user_id: u.userId,
      fau_flow_id: u.flowId || null,
      fau_run_id: u.runId || null,
      fau_purpose: "assistant",
      fau_model: u.model,
      fau_input_tokens: u.inTok,
      fau_output_tokens: u.outTok,
      fau_estimated_cost_usd: u.cost,
      fau_outcome: u.outcome,
      fau_outcome_message: u.message,
    })
  } catch {
    // Usage logging must never break the assistant response.
  }
}

async function resolveCallerUserId(admin: SupabaseClient, authHeader: string): Promise<string | null> {
  if (!authHeader.startsWith("Bearer ")) return null
  const jwt = authHeader.slice(7)
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
    const authUserId = payload.sub as string
    if (!authUserId) return null
    const { data: u } = await admin
      .from("users")
      .select("id")
      .eq("auth_user_id", authUserId)
      .maybeSingle()
    return u?.id || null
  } catch {
    return null
  }
}
