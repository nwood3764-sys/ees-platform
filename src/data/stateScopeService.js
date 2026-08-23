import { supabase } from '../lib/supabase'
import { normalizeStateCode } from '../lib/stateScope'

// ---------------------------------------------------------------------------
// stateScopeService — geographic (state) record access.
//
// LEAP's object-level security (roles, permission sets, resolved by
// app_user_can) answers "may this user read Properties at all". This is the
// record-level layer beside it: which states' records a user may see.
//
// The rule lives in the database, not here:
//
//   • user_state_scopes           — the grants (USS-)
//   • record_state_scope_sources  — how each object resolves to a state (RSSS-)
//   • a RESTRICTIVE policy per object, generated from that registry
//
// A user with NO grants is unrestricted and sees everything their role allows,
// which is every existing user. A user WITH grants sees only records that
// positively resolve to one of those states — and cannot create or edit
// outside them either, because the same predicate is the policy's WITH CHECK.
//
// This file only reads and writes the grants; it never re-implements the rule.
// ---------------------------------------------------------------------------

const SCOPE_COLUMNS =
  'id, uss_record_number, uss_user_id, uss_state_code, uss_notes, uss_created_at'

// ─── Reading grants ────────────────────────────────────────────────────────

// Every active grant, keyed by user id. Used by the Users list so each row can
// show its geographic access without a query per row.
export async function fetchStateScopesByUser() {
  const { data, error } = await supabase
    .from('user_state_scopes')
    .select(SCOPE_COLUMNS)
    .eq('uss_is_deleted', false)
    .order('uss_state_code', { ascending: true })
  if (error) throw error

  const byUser = {}
  for (const row of data || []) {
    ;(byUser[row.uss_user_id] ||= []).push(row)
  }
  return byUser
}

export async function fetchStateScopesForUser(userId) {
  if (!userId) return []
  const { data, error } = await supabase
    .from('user_state_scopes')
    .select(SCOPE_COLUMNS)
    .eq('uss_user_id', userId)
    .eq('uss_is_deleted', false)
    .order('uss_state_code', { ascending: true })
  if (error) throw error
  return data || []
}

// ─── Changing grants ───────────────────────────────────────────────────────

export async function grantStateToUser(userId, stateCode, notes) {
  const code = normalizeStateCode(stateCode)
  if (!code) {
    throw new Error(`"${stateCode}" is not a two-letter state code.`)
  }

  // A revoked grant is a soft-deleted row, and the unique index only covers
  // active ones — so re-granting a state revives the original row rather than
  // leaving a trail of duplicates.
  const { data: revoked, error: findError } = await supabase
    .from('user_state_scopes')
    .select('id')
    .eq('uss_user_id', userId)
    .eq('uss_state_code', code)
    .eq('uss_is_deleted', true)
    .limit(1)
  if (findError) throw findError

  if (revoked?.length) {
    const { error } = await supabase
      .from('user_state_scopes')
      .update({
        uss_is_deleted: false,
        uss_deleted_at: null,
        uss_deleted_by: null,
        uss_deletion_reason: null,
        uss_notes: notes || null,
      })
      .eq('id', revoked[0].id)
    if (error) throw error
    return
  }

  const { error } = await supabase
    .from('user_state_scopes')
    .insert({ uss_user_id: userId, uss_state_code: code, uss_notes: notes || null })
  if (error) throw error
}

export async function revokeStateFromUser(scopeId, reason) {
  const { error } = await supabase
    .from('user_state_scopes')
    .update({
      uss_is_deleted: true,
      uss_deleted_at: new Date().toISOString(),
      uss_deletion_reason: reason || 'Geographic access revoked in LEAP Admin.',
    })
    .eq('id', scopeId)
  if (error) throw error
}

// ─── Options and preview ───────────────────────────────────────────────────

// The states are read from the properties that exist, never hardcoded.
export async function fetchStateScopeOptions() {
  const { data, error } = await supabase.rpc('list_state_scope_options')
  if (error) throw error
  return (data || []).map(r => ({
    stateCode: r.state_code,
    propertyCount: Number(r.property_count) || 0,
  }))
}

// What this user can actually see, object by object, computed with the same
// predicate the policies use. Administrator-only on the server.
export async function previewUserStateAccess(userId) {
  const { data, error } = await supabase.rpc('preview_user_state_scope_access', {
    p_user_id: userId,
  })
  if (error) throw error
  return (data || []).map(r => ({
    objectName: r.object_name,
    resolutionKind: r.resolution_kind,
    recordsTotal: r.records_total === null ? null : Number(r.records_total),
    recordsVisible: r.records_visible === null ? null : Number(r.records_visible),
    note: r.note || null,
  }))
}

// ─── Display helpers ───────────────────────────────────────────────────────
// Re-exported from the pure module so callers have one import for this
// feature; the rules themselves live in src/lib/stateScope.js and are tested
// by scripts/state-scope-fixture.mjs.
export { describeStateAccess, isStateScoped, normalizeStateCode } from '../lib/stateScope'
