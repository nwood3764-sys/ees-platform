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
//     global_search) execute immediately and feed back into the loop.
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
//     schedule_crew, provision_technician, add_custom_field
//   Option B (generic, any object):
//     describe_object, query_records, create_record, update_record
//   All curated tools lower to the same {record_create|record_update|
//   status_change} proposed-action shape that commit_screen_flow_run accepts.

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
const MAX_TURNS = 6   // tool-use loop ceiling per request

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
]

const SYSTEM_PROMPT = `You are the LEAP assistant for Energy Efficiency Services of Wisconsin. LEAP is the company's operations platform (CRM, field service, incentives, inventory).

You help the signed-in user take actions by plain conversation: creating records, updating fields, changing statuses, running reports, looking things up. You operate strictly within the user's own permissions — if an action is refused, explain plainly and stop; never try to work around a permission.

Rules:
- Before proposing a create or update on an object, call describe_object for it (unless you already did this conversation) so you use real column names.
- When the user names a record (e.g. "the North Willow work order"), use global_search or query_records to resolve its id before acting on it. Never invent ids.
- Never set a status column with update_record. Use change_status, which validates transitions.
- Every mutating action you choose is shown to the user for explicit confirmation before it runs — you never execute changes yourself. Describe clearly what you are about to do and why.
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
      if (toolUses.length === 0) break   // model is done

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
      return JSON.stringify({ object: input.object, columns: data })
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
