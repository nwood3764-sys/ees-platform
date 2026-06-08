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
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: { message, history, context },
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
// assistant-initiated runs that the user has not saved as a named task. It is
// created once per tenant and reused. Saved tasks (future) pass their own
// flowId and bypass this.
let _adhocFlowIdCache = null
async function getOrCreateAdhocFlowId() {
  if (_adhocFlowIdCache) return _adhocFlowIdCache
  const { data: existing } = await supabase
    .from('flows')
    .select('id')
    .eq('flow_name', 'AI Assistant — Ad-hoc')
    .eq('is_deleted', false)
    .maybeSingle()
  if (existing?.id) { _adhocFlowIdCache = existing.id; return existing.id }

  const { data: created, error } = await supabase
    .from('flows')
    .insert({
      flow_record_number: '',
      flow_name: 'AI Assistant — Ad-hoc',
      flow_description: 'System flow anchoring ad-hoc AI assistant actions that were not saved as a named task.',
      flow_type: 'screen',
      flow_status: 'active',
    })
    .select('id')
    .single()
  if (error) throw error
  _adhocFlowIdCache = created.id
  return created.id
}
