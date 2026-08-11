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
//     global_search, fuzzy_resolve, search_help_articles,
//     search_knowledge) execute immediately and feed back into the loop.
//   • Mutating tools (record_create, record_update, status_change, and the
//     curated Option-A actions) are NOT executed here. They are returned to
//     the client as a `proposed_actions` array. The client auto-runs the
//     everyday, reversible ones immediately and commits via
//     commit_screen_flow_run (which re-checks every permission server-side);
//     only bulk/administrative actions still prompt for confirmation.
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
//   Help / how-to: search_help_articles (reads the help-article library so the
//     assistant can answer "how do I…" / "where do I find…" questions)
//   Knowledge Base: search_knowledge (semantic/embedding search over the
//     internal-only company knowledge pool — procedures, program/measure
//     details — for questions about how EES works)
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

const MODEL = "claude-sonnet-4-6"
const PRICE_INPUT_PER_MTOK  = 3.00
const PRICE_OUTPUT_PER_MTOK = 15.00
const MAX_TURNS = 8   // tool-use loop ceiling per request
// Output budget per model call. Must be large enough to emit a whole batch of
// tool calls at once — a 17-record create is ~2k tokens of tool_use alone, so
// the old 1500 truncated mid-batch and the proposed cards never materialised.
const MAX_TOKENS = 8192
const CLOSE_MAX_TOKENS = 2048
// Cap the replayed history sent to the model (chars). Conversation memory can
// balloon to 100k+ tokens over a long session; that degrades the model and can
// starve the output budget. Keep the most recent slice.
const HISTORY_CHAR_BUDGET = 60000

// Keep the most recent history messages within a char budget (newest-first),
// so a long-running conversation can't bloat the request to 100k+ tokens.
function trimHistory(history: AnthropicMessage[]): AnthropicMessage[] {
  if (!Array.isArray(history)) return []
  let total = 0
  const kept: AnthropicMessage[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    const len = JSON.stringify(history[i] ?? "").length
    if (total + len > HISTORY_CHAR_BUDGET && kept.length) break
    kept.unshift(history[i]); total += len
  }
  return kept
}

interface RecordContext {
  object?:      string   // table name of the record the user is viewing
  record_id?:   string   // uuid of that record
  record_label?: string  // human label for the prompt
}

interface ReqBody {
  message?:   string            // the user's plain-English instruction
  history?:   AnthropicMessage[]// prior turns in this assistant session
  context?:   RecordContext     // current-record context, if any
  app_base_url?: string         // the site origin the user is on, for shareable record URLs
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
    description: "Propose creating one row on any object. Everyday creates run immediately (no confirm step). Provide the object and a flat map of column → value. To create several related records in ONE batch (e.g. an account plus a property, building, and contact under it), give each create a short `ref`, and in a later create reference an earlier record's not-yet-known id with the token {{ref:NAME}} as the foreign-key value. The batch runs in array order and substitutes the real id at commit. Parents MUST appear before their children.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string" },
        values: { type: "object", description: "Map of column name to value. A foreign-key value may be the token {{ref:NAME}} to link to another record created earlier in this same batch." },
        ref: { type: "string", description: "Optional short label (e.g. 'acct') so later records in this batch can link to this one via {{ref:acct}}." },
        summary: { type: "string", description: "One-line human summary of what this creates" },
      },
      required: ["object","values","summary"],
    },
  },
  {
    name: "log_activity",
    description: "Log a call, voicemail, email, note, or meeting on a record — and relate it to EVERY connected record at once. This is the ONLY correct way to log a call/voicemail; never use create_record on the activities object for this. The logged activity appears on the Activity timeline of the anchor record AND of every record listed in `relations` (the contact it was left for, the property, the opportunity, the account, etc.). Runs immediately (no confirm step).",
    mutating: true,
    input_schema: {
      type: "object",
      properties: {
        object: { type: "string", description: "The anchor record's object/table, e.g. accounts, contacts, properties, opportunities." },
        record_id: { type: "string", description: "The anchor record's id. May be the token {{ref:NAME}} to link to a record created earlier in this same batch." },
        activity_type: { type: "string", description: "Capitalized type: Call, Email, Note, Meeting, SMS, or Task. For a voicemail use Call." },
        subject: { type: "string", description: "Short subject line, e.g. 'Voicemail left for Kelly Barringer' or 'Left voicemail — unable to leave message'." },
        body: { type: "string", description: "Optional details/comments of the call or note." },
        direction: { type: "string", description: "Capitalized: Outbound or Inbound. Use Outbound for a call/voicemail the user placed." },
        performed_at: { type: "string", description: "ISO timestamp of when it happened, e.g. 2026-08-03T10:25:00. Defaults to now if omitted." },
        contact_id: { type: "string", description: "The contact this activity is with (who was called / left a voicemail). Relates the activity to that contact's timeline. May be {{ref:NAME}} for a contact created earlier in this batch." },
        relations: {
          type: "array",
          description: "Additional records to relate this activity to, beyond the anchor and contact — e.g. a property and an opportunity. Each appears on its own Activity timeline. Ids may be {{ref:NAME}} tokens.",
          items: { type: "object", properties: { object: { type: "string", description: "e.g. properties, opportunities, accounts" }, id: { type: "string" } }, required: ["object","id"] },
        },
        ref: { type: "string", description: "Optional short label so later records in this batch can link to this activity." },
        summary: { type: "string", description: "One-line human summary, e.g. 'Log outbound voicemail to Kelly Barringer'." },
      },
      required: ["object","record_id","activity_type","subject","summary"],
    },
  },
  {
    name: "update_record",
    description: "Propose updating one existing row on any object. Everyday edits run immediately (no confirm step). Never use this to change a status column; use change_status instead.",
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
    description: "Propose moving a record to a new status. Runs immediately (no confirm step). Status transition rules are validated server-side on commit.",
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
    description: "Propose creating a work order. Curated shortcut for the common field-service request. Runs immediately. Supports `ref` and {{ref:NAME}} the same way as create_record for multi-record batches.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: { values: { type: "object", description: "work_orders column → value map" }, ref: { type: "string", description: "Optional batch label for back-references." }, summary: { type: "string" } },
      required: ["values","summary"],
    },
  },
  {
    name: "create_contact",
    description: "Propose creating a contact. Curated shortcut. Runs immediately. Supports `ref` and {{ref:NAME}} the same way as create_record for multi-record batches.",
    mutating: true,
    input_schema: {
      type: "object",
      properties: { values: { type: "object", description: "contacts column → value map" }, ref: { type: "string", description: "Optional batch label for back-references." }, summary: { type: "string" } },
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
    description: "Propose creating a NEW saved report definition in the Reports module that persists for future use. Runs immediately (no confirm step). Use this when the user asks to create, build, or save a report (not just run or query data). Before calling, ALWAYS use describe_object on the primary object (and any related object you group/filter through) so every column name is real. Supports tabular, summary (grouped with subtotals), and matrix (pivot) reports, plus groupings, calculated fields, charts, and cross-object filters. Pick only the pieces the user asked for; omit the rest.",
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
  {
    name: "search_help_articles",
    description:
      "Search LEAP's built-in help articles — the same Help Center library users can browse — and get their full content. Use this to answer questions about HOW TO USE LEAP itself: 'how do I…', 'where do I find…', 'how do I configure/set up…', 'how does <feature> work', and similar how-to / navigation / feature questions — as distinct from reading the user's business records (use query_records / run_report for data). Returns ranked articles with their markdown body, scoped to what the signed-in user is allowed to see. Read-only. In LEAP an opportunity's 'stages' are status picklist values scoped to a record type — search terms like 'stage', 'record type', or 'picklist scoping' surface the right article.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The key terms of what the user wants to do, e.g. 'change opportunity stages per record type', 'add a user', 'build a report'. Use a short phrase or keywords, not a full sentence." },
        limit: { type: "integer", description: "Max articles to return, default 5, ceiling 10." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Semantic search over LEAP's Knowledge Base — the company brain of uploaded procedures, install details, rate sheets, program rules, tips, and notes. Use this for ANY question about how EES actually does something or what a program/measure requires ('what's the attic prep procedure', 'income doc requirement for WI multifamily HOMES', 'approved insulation measures in NC'). It matches by MEANING, so pass the user's question naturally — do NOT reduce it to keywords. Distinct from search_help_articles (which is how to use the LEAP software); this is company/field/program subject-matter knowledge. Read-only; internal staff only. Answer only from the returned passages and cite the source document; respect each passage's State/Program scope (never apply a passage scoped to one state/program to a question about another).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The user's question in natural language — a full question or phrase, not keywords. Meaning is what's matched." },
        state: { type: "string", description: "Two-letter state code (WI, NC, MI, CO, IN) when the question is about a specific state, so state-specific docs win and other states are excluded. Omit if not state-specific." },
        program: { type: "string", description: "The opportunity record type when the question is about a specific program, e.g. 'WI-IRA-MF-HOMES', 'NC-IRA-SF-HEAR'. Omit if not program-specific." },
        limit: { type: "integer", description: "Max passages to return, default 8, ceiling 20." },
      },
      required: ["query"],
    },
  },
]

// The system prompt is built per request so the model can quote the user's
// actual site origin in shareable record URLs. appBaseUrl is the origin the
// user is on (e.g. https://leap.ees-wi.org); when absent we fall back to a
// clearly-labelled placeholder rather than inventing a domain.
function buildSystemPrompt(
  appBaseUrl: string,
  now: { human: string; iso: string; time: string },
  caller: CallerProfile,
): string {
  const URL_FORM = appBaseUrl ? `${appBaseUrl}/<table>/<id>` : "<your LEAP site>/<table>/<id>"
  const callerDesc = caller.role
    ? `${caller.name} (role: ${caller.role}${caller.title ? `, ${caller.title}` : ""})`
    : (caller.title ? `${caller.name} (${caller.title})` : caller.name)
  return `You are the LEAP assistant for Energy Efficiency Services of Wisconsin. LEAP is the company's operations platform (CRM, field service, incentives, inventory).

## Right now — the current date/time and who you are helping (these are FACTS you already have; never ask for them)

- Today is ${now.human} (${now.iso}). The current time is ${now.time}, Energy Efficiency Services' local time (US Central). You already know this — NEVER ask the user what today's date or the current time is. When the user says "today", "now", "this morning", "this week", or "schedule it for today", compute the actual date/time from the values above yourself.
- You are assisting ${callerDesc}. That is the signed-in user. When the user says "me", "my", "for me", or "assign it to me", they mean ${caller.name} — resolve it from this, do not ask who they are.

You help the signed-in user two ways:
1. Take actions by plain conversation: creating records, updating fields, changing statuses, running reports, looking things up. You operate strictly within the user's own permissions — if an action is refused, explain plainly and stop; never try to work around a permission.
2. Answer questions about how to USE LEAP: how to do something, where to find a setting or menu, how a feature works. These are fully in scope — answer them from LEAP's built-in help articles (see below). Never tell the user a how-to question is outside what you can do.

## Answering how-to and "where do I…" questions

Users will ask how to do things in LEAP ("how do I change the stages per record type for an opportunity?", "where do I add a user?", "how do I build a report?"). Treat these as in scope and answer them from the help library, not from memory:

- Call search_help_articles with the key terms of the question. It returns matching articles' full content, already scoped to what this user may see.
- Base your answer — ESPECIALLY any menu path, button name, or step sequence — ONLY on what the returned articles actually say. Give the concrete steps and name the exact place in the app (e.g. the Object Manager, LEAP Admin / Setup, the Reports module). Cite the article by its title.
- If search_help_articles returns nothing useful, say plainly that you couldn't find a help article on it and point the user to the Help Center (the Help area) or their LEAP administrator. Do NOT invent a menu path, button, or setting you did not read in an article — a wrong navigation instruction is worse than admitting you don't have one.
- In LEAP, an opportunity's "stages" are status picklist values scoped to a record type (governed by the Lifecycle Builder / picklist record-type scoping), not a separate "stage" object — so search "stage", "record type", or "picklist scoping" to surface the right article.

## Questions about how EES works, procedures, or program/measure details

When the user asks how EES actually does something in the field or office — a procedure, install detail, approved measure, rate, eligibility rule, program specifics ("what's the attic prep procedure", "income doc requirement for WI multifamily HOMES", "approved insulation measures in NC") — that is company/program subject-matter knowledge. Use search_knowledge (the Knowledge Base), NOT search_help_articles (which is only for using the LEAP software). Rules:
- Pass the user's actual question as \`query\` — it matches by meaning, so don't reduce it to keywords.
- If the question is about a specific state or program, pass \`state\` (WI/NC/MI/CO/IN) and/or \`program\` (the opportunity record type, e.g. WI-IRA-MF-HOMES) so the right scope wins.
- Answer ONLY from the returned passages, and cite the source document by its title. Respect each passage's scope — never apply a passage scoped to one state/program to a question about a different one.
- If nothing relevant comes back, say you don't have knowledge-base material on it rather than guessing — approved measures differ by state/program and a wrong answer is worse than none.

## Plan the whole request before proposing anything

When the user asks for several related records in one breath ("create an account with a property, a building, and a contact"), treat it as ONE job. Plan all of it and emit it as ONE batch — never do one record and wait. The records are created together, in dependency order, in a single run.

Emit the whole batch as tool calls in ONE turn: call create_record once per record, all in the same response. Keep any preamble to at most ONE short sentence and do NOT list or describe the records in prose before creating them — the result cards already show each record's details, so narrating them wastes your output budget and can cut the batch off before the tool calls are emitted. If you find yourself writing "I'll create Unit 1, Unit 2, …", stop and emit the create_record calls instead.

Dependency order is always parent then child: account → property → building → unit, and contacts/opportunities hang off the account. A child record needs its parent's id, which does not exist until the batch runs. To link them, give each create a short 'ref' (e.g. "acct", "prop") and put the token {{ref:NAME}} in the child's foreign-key value. Example for "account + property + building + contact":
1. create_record accounts, ref "acct", values {account_name: ...}
2. create_record properties, ref "prop", values {..., property_account_id: "{{ref:acct}}"}
3. create_record buildings, ref "bldg", values {..., property_id: "{{ref:prop}}"}
4. create_record contacts, values {..., contact_account_id: "{{ref:acct}}"}
List parents before children. The batch substitutes the real ids at commit time.

## Logging calls, voicemails, notes, and other activities

When the user wants to log a call, voicemail, email, note, or meeting, ALWAYS use the log_activity tool — never create_record on the activities object. log_activity is the only path that makes the entry show up on the Activity timeline; a raw create on activities does not, so the user would see nothing on the record.

- Set activity_type to a capitalized value — Call, Email, Note, Meeting, SMS, or Task. A voicemail is a Call. Set direction capitalized — Outbound for a call the user placed, Inbound for one received. Do not use lowercase ("call"/"outbound"); it renders and filters inconsistently with everything else.
- Anchor it on the most relevant record (object + record_id): usually the account or the contact the user named. Put the person spoken to / left a voicemail for in contact_id so it lands on that contact's timeline.
- Relate it to everything it touches. If the user mentions (or the context makes clear) a property and/or an opportunity as well as the contact and account, pass them in relations so the activity appears on each one's Activity tab. "Relate this to the property, the opportunity, and the contact" is exactly what relations is for — resolve each record's id first and include them all.
- If you are creating the contact in the SAME batch (e.g. "create this contact and log a voicemail"), emit the create_record/create_contact for the contact FIRST with a ref, then the log_activity referencing it via contact_id: "{{ref:NAME}}". The contact must come before the activity in the batch or the link will fail at commit.
- performed_at: use the time the user gives (e.g. "at 10:25" today → today's date at 10:25 in ISO form); otherwise omit and it defaults to now.

## No holes — gather every required field first

Before proposing any create, call describe_object on each object so you use real column names AND know which fields are required. Required fields (NOT NULL with no default) MUST be filled. Never propose a create that leaves a required field empty — it will fail.

Fill what you can safely derive, and ask the user — in ONE consolidated question — for anything required that you cannot infer. Specifically:
- A person's full name must be split into first and last name, and most contact records also need a combined full-name field — set all of them (e.g. contact_first_name, contact_last_name, contact_name). If a name is ambiguous to split, ask.
- US state must be the two-letter postal code (WI, NC, CO, MI, IN), never the spelled-out name — there is a 2-character constraint. Convert it yourself.
- A property address needs street, city, state, and ZIP. ZIP is required; if the user did not give one, ask for it. Do not invent a ZIP.
- A building needs a name/number; if the user says "1 building" without a label, use "Building 1" (or ask if they would prefer a specific name).

If several required pieces are missing, ask for all of them together in one message, then proceed. Do not drip one question at a time.

## Resolving names and typos

When the user names an existing record, resolve its id with global_search or query_records before acting; never invent ids. Treat the user's wording as approximate — if a term might be misspelled or mis-heard, use fuzzy_resolve, and always state any correction you applied. For statuses/record types/work types, resolve the value with fuzzy_resolve kind='picklist' and use the returned id (e.g. as to_status_id for change_status). Never set a status column with update_record.

When the user refers to a COWORKER — a technician, owner, coordinator, or any staff member — by first name or partial name ("schedule these for Logan", "assign it to Priya", "give it to Kelly"), look them up YOURSELF: query_records on the users object (or fuzzy_resolve / global_search) restricted to active users, and use the match's id (e.g. as the owner or assigned-technician field). Do NOT ask the user to type out a person's full name — that is a lookup you are fully capable of doing. Only ask the user to clarify when the lookup finds MORE THAN ONE active person who matches (name them and ask which) or NONE at all. The same applies to the signed-in user: "me"/"my" is the caller named in the current-context block above — never ask who that is.

## Everyday actions run immediately — there is no confirmation step

When you use create_record, create_contact, create_work_order, log_activity, update_record, change_status, or create_report, the app runs it right away, automatically — there is NO confirm button. The user sees the created/updated record with a real clickable link appear under your message. So:

- Speak in the present/near tense about what you're doing: "Logging that voicemail for Kelly now," "Creating the contact," "Updating the phone number," "Moving the work order to Scheduled." Do NOT say "confirm the card," "click Confirm," "I've prepared this," "let me know if you'd like me to proceed," or anything implying the user must approve it — there is nothing to confirm. Describe what you're doing and let the result cards carry the proof.
- Ask FIRST for anything required you can't infer. Because the action runs the moment you propose it, never propose one you know will fail — if a required field is missing (e.g. a property's ZIP), ask for it in one message, THEN act. Don't fire off an action that will error.
- Still never invent, guess, or use a placeholder/example id or URL. The app appends the real link itself. On your NEXT turn you'll receive a "[system: Created <table> <uuid> (<url>) ...]" note with the real ids — from then on you may cite those exact links. If you don't yet hold a real id for a record, say so honestly rather than fabricating one.
- Claim ONLY what you can back with a confirmation. When you emit create/update actions you have NOT yet seen the result — the database write happens after this turn. So do NOT assert a finished, verified outcome from your own intention: never say "all 11 units are now in place," "everything's created and double-checked," or "done" as a statement of completed fact in the same turn you emit the actions. The result cards under your message and the "[system: Created ...]" note on your next turn are the ONLY proof the write succeeded. Describe what you're creating, then state a confirmed count or "these now exist" ONLY once you actually hold that confirmation. If instead you receive a "[system: ... did not fully complete ...]" note, tell the user plainly what failed — do not paper over it.
- If the user questions or pushes back on whether something actually happened ("did that work?", "you didn't build those", "are you sure?"), do NOT simply repeat your earlier claim or apologize and re-assert. VERIFY: run query_records or global_search against the real data, count what actually exists, and report that real number — even (especially) if it is fewer than you implied. A re-query is the only honest answer to "are you sure?"

The only actions that still pause for the user's yes/no are genuinely destructive or bulk/administrative ones — those are rare and the app handles the prompt. Everything the user does day to day (contacts, calls/voicemails, field edits, status moves) just happens.

## Record links and shareable URLs — you CAN give a real URL

Every LEAP record has a stable, shareable web address of the form:
    ${URL_FORM}
where <table> is the object's table name (e.g. buildings, properties, work_orders, contacts, accounts, opportunities) and <id> is the record's real UUID. This is a genuine URL a user can copy, paste to a coworker, and open.

Rules for links:
- You CAN produce a full, working URL. When the user asks for a link or URL to a record and you hold that record's real UUID — from a "[system: Created ...]" note, or from query_records / global_search / fuzzy_resolve — answer with the complete address: ${URL_FORM}. Never tell the user you cannot produce a URL or that you only have record ids; you can build the URL from the id.
- Use ONLY a real UUID you actually retrieved or were handed. Never fabricate a UUID, and never give an "example" id for the user to swap in — that is not a real link and it will not work. If you don't have the record's real id, look it up first with query_records or global_search.
- The panel also renders a clickable button and a copyable URL for every record actually created, so the user has the link there too — but still state the URL in text when they ask.

Be concise and concrete. Use the record context provided if present. Never fabricate field values, dates, amounts, names, ids, or URLs. If you don't know a required value, ask.`
}

// Accept only a well-formed http(s) origin and return it without a trailing
// slash. Anything else yields "" so the prompt falls back to a placeholder —
// the model must never be handed a bogus base to build links from.
function sanitizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return ""
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== "http:" && u.protocol !== "https:") return ""
    return u.origin
  } catch {
    return ""
  }
}

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
  const callerProfile = await fetchCallerProfile(admin, callerUserId)

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
  const messages: AnthropicMessage[] = [...trimHistory(body.history || [])]
  if (body.message) {
    let userText = body.message
    if (body.context?.object) {
      userText += `\n\n[Current record context: object=${body.context.object}` +
        (body.context.record_id ? `, record_id=${body.context.record_id}` : "") +
        (body.context.record_label ? `, label="${body.context.record_label}"` : "") + "]"
    }
    messages.push({ role: "user", content: userText })
  }

  // Origin the user is on, sanitised — used so the model can quote real,
  // shareable record URLs (<origin>/<table>/<id>) instead of refusing or
  // inventing an example id. Only http(s) origins are accepted.
  const appBaseUrl = sanitizeBaseUrl(body.app_base_url)
  const systemPrompt = buildSystemPrompt(appBaseUrl, buildNowContext(), callerProfile)

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
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
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
      if (toolUses.length === 0) {
        // Model produced only text. If it was cut off at the output cap without
        // emitting its tool calls (the classic big-batch failure: it narrates,
        // runs out of budget, proposes nothing), nudge it to emit them and
        // continue — otherwise it's genuinely done.
        if (data?.stop_reason === "max_tokens" && turn < MAX_TURNS - 1) {
          messages.push({ role: "assistant", content: blocks })
          messages.push({ role: "user", content: "You were cut off before finishing and proposed nothing. Continue now: emit the create/update/status tool calls for the records directly, with no preamble — the result cards will show the details." })
          continue
        }
        endedNaturally = true; break   // model is done
      }

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
            note: "Queued to run on the client; it executes immediately unless it is a bulk/admin action.",
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
          max_tokens: CLOSE_MAX_TOKENS,
          system: systemPrompt,
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
      return { type: "record_create", object: "work_orders", values: input.values, ref: input.ref || undefined, summary: input.summary }
    case "create_contact":
      return { type: "record_create", object: "contacts", values: input.values, ref: input.ref || undefined, summary: input.summary }
    case "create_record":
      return { type: "record_create", object: input.object, values: input.values, ref: input.ref || undefined, summary: input.summary }
    case "log_activity": {
      // Lower to a record_create on activities: anchor + contact go in the
      // inline columns (mirrored into activity_relations by the DB trigger);
      // any extra links ride as a top-level `relations` array the commit RPC
      // writes into activity_relations directly.
      const values: Record<string, unknown> = {
        activity_type: input.activity_type,
        subject: input.subject,
        related_object: input.object,
        related_id: input.record_id,
      }
      if (input.body) values.body = input.body
      if (input.direction) values.direction = input.direction
      if (input.performed_at) values.performed_at = input.performed_at
      if (input.contact_id) {
        values.secondary_object = "contacts"
        values.secondary_id = input.contact_id
      }
      const action: Record<string, unknown> = {
        type: "record_create", object: "activities", values,
        ref: input.ref || undefined, summary: input.summary,
      }
      if (Array.isArray(input.relations) && input.relations.length) {
        action.relations = input.relations
          .filter((r: any) => r && r.object && r.id)
          .map((r: any) => ({ object: r.object, id: r.id, role: r.role || "related" }))
      }
      return action
    }
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
    if (name === "search_help_articles") {
      const query = String(input.query ?? "").trim()
      if (!query) return JSON.stringify({ error: "Provide a search query." })
      const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10)
      const { data, error } = await userClient.rpc("help_search_articles_for_assistant", {
        p_query: query,
        p_limit: limit,
      })
      if (error) return JSON.stringify({ error: error.message })
      const articles = (Array.isArray(data) ? data : []).map((a: any) => {
        const bodyRaw = typeof a.ha_body_markdown === "string" ? a.ha_body_markdown : ""
        // Cap each body so one long article can't blow the tool-loop context budget.
        const body = bodyRaw.length > 6000 ? bodyRaw.slice(0, 6000) + "\n\n…(truncated)" : bodyRaw
        return {
          record_number: a.ha_record_number || undefined,
          title: a.ha_title,
          summary: a.ha_summary || undefined,
          category: a.ha_category || undefined,
          body,
        }
      })
      return JSON.stringify({ query, article_count: articles.length, articles })
    }
    if (name === "search_knowledge") {
      const query = String(input.query ?? "").trim()
      if (!query) return JSON.stringify({ error: "Provide a question to search." })
      const state = input.state && String(input.state).trim() ? String(input.state).trim().toUpperCase() : null
      const program = input.program && String(input.program).trim() ? String(input.program).trim() : null
      const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20)
      // Embed the question with the in-house model, then vector-match (scope-aware).
      let embedding: number[]
      try {
        const session = new (globalThis as any).Supabase.ai.Session("gte-small")
        embedding = await session.run(query, { mean_pool: true, normalize: true }) as number[]
      } catch (e) {
        return JSON.stringify({ error: `Embedding failed: ${(e as Error).message}` })
      }
      const { data, error } = await userClient.rpc("match_knowledge_chunks", {
        p_query_embedding: JSON.stringify(embedding),
        p_match_count: limit,
        p_state: state,
        p_record_type: program,
      })
      if (error) return JSON.stringify({ error: error.message })
      const passages = (Array.isArray(data) ? data : []).map((r: any) => ({
        source: r.kd_title,
        record_number: r.kd_record_number || undefined,
        description: r.kd_description || undefined,
        file: r.kd_file_name || undefined,
        scope_state: r.kd_state || undefined,
        scope_program: r.kd_opportunity_record_type || undefined,
        similarity: typeof r.similarity === "number" ? Math.round(r.similarity * 1000) / 1000 : undefined,
        text: r.chunk_text,
      }))
      return JSON.stringify({ query, state, program, passage_count: passages.length, passages })
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

// Current date/time in Energy Efficiency Services' local (Central) time, so the
// assistant NEVER has to ask the user what "today" is. Computed per request.
function buildNowContext(): { human: string; iso: string; time: string } {
  const now = new Date()
  const human = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(now)
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(now)
  return { human, iso, time }
}

interface CallerProfile { name: string; role: string; title: string }

// Look up the signed-in user's display name, role, and title so the assistant
// knows WHO it is helping (for "me"/"my"/"assign it to me") and never asks.
// Best-effort: identity is a convenience here, not the permission boundary
// (that is enforced by the user-scoped client + RLS), so failures degrade
// gracefully to a generic label.
async function fetchCallerProfile(admin: SupabaseClient, userId: string): Promise<CallerProfile> {
  try {
    const { data } = await admin
      .from("users")
      .select("user_name, user_first_name, user_last_name, user_title, roles(role_name)")
      .eq("id", userId)
      .maybeSingle()
    const composed = `${data?.user_first_name || ""} ${data?.user_last_name || ""}`.trim()
    const name = (data?.user_name || composed || "").trim() || "the signed-in user"
    // deno-lint-ignore no-explicit-any
    const role = (data as any)?.roles?.role_name || ""
    const title = data?.user_title || ""
    return { name, role, title }
  } catch {
    return { name: "the signed-in user", role: "", title: "" }
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
