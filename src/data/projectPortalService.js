// =============================================================================
// projectPortalService — data layer for the customer-facing Project Portal.
//
// The Project Portal is a standalone bypass surface (mounted at /project-portal
// in main.jsx) that lets a property owner / property manager track the stage of
// their IRA program opportunities at the property and building level. Access is
// governed entirely by explicit grants in portal_user_property_grants — there is
// NO inherited authority or account-level hierarchy. The read layer is the
// SECURITY DEFINER RPC get_portal_project_tracker(), which resolves the
// authenticated portal user to their grants and returns the in-scope
// property -> building -> opportunity tree with each opportunity's stage label
// and ordinal (picklist_sort_order, 1..10) for the progress bar.
// =============================================================================

import { supabase } from '../lib/supabase'

// ─── Portal-user session resolution ──────────────────────────────────────────
// A Project Portal user authenticates with Supabase Auth (email/password or
// magic link). Their portal_users row is linked by auth_user_id. We surface the
// portal_users row so the portal can show the user's name and confirm they are
// an active portal user before calling the tracker RPC.
export async function fetchPortalUserSelf() {
  const { data: sessionData } = await supabase.auth.getUser()
  const authUser = sessionData?.user
  if (!authUser) return null

  const { data, error } = await supabase
    .from('portal_users')
    .select('id, full_name, email, portal_role, status, record_type')
    .eq('auth_user_id', authUser.id)
    .eq('is_deleted', false)
    .maybeSingle()

  if (error) throw error
  return data || null
}

// ─── Project tracker tree ────────────────────────────────────────────────────
// Calls the SECURITY DEFINER RPC. Returns a normalized shape:
//   { portalUserId, properties: [ { id, name, recordNumber, city, state,
//       totalUnits, totalBuildings, buildings: [ { id, name, recordNumber,
//       address, totalUnits, opportunities: [ { id, recordNumber, name,
//       program, stageLabel, stageOrder } ] } ] } ] }
// stageOrder is the picklist_sort_order (1..10); the progress bar is
// stageOrder / 10 * 100, matching the demo.
export async function fetchProjectTracker() {
  const { data, error } = await supabase.rpc('get_portal_project_tracker')
  if (error) throw error

  // The RPC returns jsonb. supabase-js gives it back already parsed.
  const payload = data || {}
  if (payload.error) {
    // e.g. 'no_portal_user' — the authenticated user is not a portal user.
    return { error: payload.error, properties: [] }
  }

  const properties = (payload.properties || []).map((p) => ({
    id: p.id,
    name: p.name || 'Unnamed Property',
    recordNumber: p.record_number || '',
    city: p.city || '',
    state: p.state || '',
    totalUnits: p.total_units ?? null,
    totalBuildings: p.total_buildings ?? null,
    buildings: (p.buildings || []).map((b) => ({
      id: b.id,
      name: b.name || 'Unnamed Building',
      recordNumber: b.record_number || '',
      address: b.address || '',
      totalUnits: b.total_units ?? null,
      opportunities: (b.opportunities || []).map((o) => ({
        id: o.id,
        recordNumber: o.record_number || '',
        name: o.name || '',
        program: o.program || '',
        stageLabel: o.stage_label || 'Not Started',
        stageOrder: Number(o.stage_order) || 0,
      })),
    })),
  }))

  return { portalUserId: payload.portal_user_id, properties }
}

// ─── Rollup helpers (mirror the demo's stats/bldgPct logic) ──────────────────
// A property's program completion is derived from its opportunities' stage
// ordinals. Total phases is fixed at 10, matching the per-record-type stage
// lifecycles authored for MF-HOMES and MF-HEAR.
export const TOTAL_PHASES = 10

export function opportunityPct(stageOrder) {
  return Math.round((Number(stageOrder) || 0) / TOTAL_PHASES * 100)
}

// Aggregate an array of opportunities into the four demo buckets:
// complete (ord 10), inProgress (1..9), notStarted (0).
export function rollupOpportunities(opportunities) {
  let complete = 0, inProgress = 0, notStarted = 0
  for (const o of opportunities) {
    if (o.stageOrder >= TOTAL_PHASES) complete++
    else if (o.stageOrder > 0) inProgress++
    else notStarted++
  }
  return { total: opportunities.length, complete, inProgress, notStarted }
}

// Flatten all opportunities under a property (across its buildings).
export function allOpportunities(property) {
  const out = []
  for (const b of property.buildings || []) {
    for (const o of b.opportunities || []) {
      out.push({ ...o, buildingId: b.id, buildingName: b.name })
    }
  }
  return out
}
