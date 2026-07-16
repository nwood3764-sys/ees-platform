// assistantService — client bridge to the ai-assistant edge function and the
// commit_screen_flow_run RPC.
//
// Flow:
//   sendAssistantMessage()  → calls the edge function, returns { reply,
//     proposed_actions, history } so the panel can keep a running session.
//   commitAssistantActions() → after the user confirms, runs the proposed
//     actions through commit_screen_flow_run, which re-checks every
//     permission server-side. The assistant never writes directly.
//
// The supabase client persists the session, so functions.invoke automatically
// attaches the user's JWT — the edge function resolves the caller and runs all
// actions under that user's permissions.

import { supabase } from '../lib/supabase'

// Send one user turn. `history` is the accumulated [{role,content}] list from
// prior turns in this session (assistant + tool turns the edge function
// returns are opaque to us; we only append our own user text and the prior
// assistant reply text for continuity). Returns the parsed response.
export async function sendAssistantMessage({ message, history = [], context = null }) {
  // The site origin so the assistant can quote real, shareable record URLs
  // (<origin>/<table>/<id>) instead of refusing or inventing an example id.
  const appBaseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: { message, history, context, app_base_url: appBaseUrl },
  })
  if (error) {
    // Edge function returned non-2xx. Surface a usable message.
    let detail = ''
    try { detail = (await error.context?.json?.())?.error || '' } catch { /* ignore */ }
    throw new Error(detail || error.message || 'Assistant request failed')
  }
  return data || {}
}

// Commit the actions the user confirmed. Each action already carries the shape
// commit_screen_flow_run expects: {type, object, record_id?, values?,
// to_status_id?, status_field?, note?}. We strip the display-only `summary`
// before sending. `flowId` ties the run to a saved task when one exists; for
// ad-hoc assistant actions we pass a sentinel by creating no flow — but
// commit_screen_flow_run requires a real flow row, so ad-hoc commits use the
// shared "AI Assistant — Ad-hoc" flow, resolved/created on demand.
export async function commitAssistantActions({ actions, context = null, aiAssisted = true, flowId = null }) {
  const cleanActions = (actions || []).map(({ summary, ...rest }) => rest)
  const resolvedFlowId = flowId || await getOrCreateAdhocFlowId()
  const { data, error } = await supabase.rpc('commit_screen_flow_run', {
    p_flow_id: resolvedFlowId,
    p_context: context || {},
    p_actions: cleanActions,
    p_ai_assisted: aiAssisted,
  })
  if (error) throw error
  return data
}

// The ad-hoc assistant flow is a single shared flow row that anchors
// assistant-initiated runs the user has not saved as a named task. Resolved
// (and created once) server-side by resolve_adhoc_assistant_flow, which is
// SECURITY DEFINER and sets owner_id to the current app user — the client
// never inserts into flows directly (owner_id is NOT NULL and RLS-guarded).
let _adhocFlowIdCache = null
async function getOrCreateAdhocFlowId() {
  if (_adhocFlowIdCache) return _adhocFlowIdCache
  const { data, error } = await supabase.rpc('resolve_adhoc_assistant_flow')
  if (error) throw error
  _adhocFlowIdCache = data
  return data
}

// ─── Persistent conversation memory ──────────────────────────────────────────
// The assistant no longer starts blank every day. Each turn (the user's
// message, the assistant's reply, and the system "created records" notes) is
// persisted per user via save_assistant_message; on open the panel reloads the
// recent window via load_assistant_messages so both the visible thread and the
// context sent to the model carry across sessions and days. Both RPCs are
// SECURITY DEFINER and owner-scoped — a user only ever sees their own history.

// Persist one turn. role is 'user' or 'assistant'; context is optional JSON
// (the current-record context). Fire-and-forget at call sites — a failed save
// must never break the chat, so callers swallow errors.
export async function saveAssistantMessage({ role, content, context = null }) {
  const text = (content || '').trim()
  if (!text) return null
  const { data, error } = await supabase.rpc('save_assistant_message', {
    p_role: role, p_content: text, p_context: context || null,
  })
  if (error) throw error
  return data // new message id
}

// Load the current user's recent assistant history (default last 2 days),
// oldest-first, for replay into the panel and the model.
export async function loadAssistantMessages({ days = 2, limit = 60 } = {}) {
  const { data, error } = await supabase.rpc('load_assistant_messages', {
    p_days: days, p_limit: limit,
  })
  if (error) throw error
  return data || [] // [{ id, role, content, context, created_at }]
}

// ─── Saved tasks (guided screen flows) ───────────────────────────────────────
// A saved task captures a confirmed assistant action as a reusable, shareable
// guided flow: optional question steps (yes/no, single-select, free text) plus
// the action template(s). All writes go through save_assistant_task
// (SECURITY DEFINER) so owner_id is set server-side. Action templates may carry
// {{question_key}} placeholders resolved at run time from the user's answers.

// Persist a task. `task` = { name, description?, launch_object?, questions?, actions }.
export async function saveAssistantTask(task) {
  const { data, error } = await supabase.rpc('save_assistant_task', { p_task: task })
  if (error) throw error
  return data // new flow id
}

// List active tasks available on a given object (object-scoped + global).
export async function listAssistantTasks(launchObject = null) {
  const { data, error } = await supabase.rpc('list_assistant_tasks', { p_launch_object: launchObject })
  if (error) throw error
  return data || []
}

// Fetch one task's published snapshot for the guided runner.
export async function getAssistantTask(flowId) {
  const { data, error } = await supabase.rpc('get_assistant_task', { p_flow_id: flowId })
  if (error) throw error
  return data || null
}

// Resolve {{question_key}} placeholders in an action template against the
// answers the runner collected. Walks strings recursively through the action
// object so placeholders work in any value position.
export function resolveTaskPlaceholders(actions, answers) {
  const sub = (val) => {
    if (typeof val === 'string') {
      return val.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => (answers?.[k] ?? ''))
    }
    if (Array.isArray(val)) return val.map(sub)
    if (val && typeof val === 'object') {
      const out = {}
      for (const [k, v] of Object.entries(val)) out[k] = sub(v)
      return out
    }
    return val
  }
  return (actions || []).map(sub)
}

// Run a saved task: resolve placeholders with the collected answers, then
// commit the resolved actions through commit_screen_flow_run anchored to the
// task's own flow id (not the ad-hoc flow).
export async function runAssistantTask({ flowId, snapshot, answers, context = null }) {
  const resolved = resolveTaskPlaceholders(snapshot?.actions || [], answers)
  const cleanActions = resolved.map(({ summary, ...rest }) => rest)
  const { data, error } = await supabase.rpc('commit_screen_flow_run', {
    p_flow_id: flowId,
    p_context: context || {},
    p_actions: cleanActions,
    p_ai_assisted: true,
  })
  if (error) throw error
  return data
}
