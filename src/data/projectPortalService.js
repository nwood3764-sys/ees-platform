// =============================================================================
// projectPortalService — data layer for the customer-facing Project Portal.
//
// The Project Portal is a standalone bypass surface (mounted at /project-portal
// in main.jsx) that lets a property owner / property manager track the status of
// their IRA program work. Access is governed entirely by explicit grants in
// portal_user_property_grants — there is NO inherited authority or account-level
// hierarchy. The read layer is the SECURITY DEFINER RPC
// get_portal_project_tracker().
//
// MODEL: everything is driven by OPPORTUNITY statuses, and opportunities are
// BUILDING-level. Properties have their own statuses elsewhere in LEAP, but the
// portal does NOT track them — here a property is just a container of buildings
// you click into. Each building carries its own opportunities (one per record
// type, e.g. an IRA HOMES and an IRA HEAR opportunity), each with its own
// data-driven stage list ([{ label, sortOrder }], from
// picklist_value_record_type_assignments) and stage_order. No unit tier, no
// property status. Nothing about programs or stage counts is hardcoded — the
// portal discovers the record types present and renders one track per type.
// =============================================================================

import { supabase } from '../lib/supabase'

// ─── Portal-user session resolution ──────────────────────────────────────────
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

// A "program" is simply an opportunity's record type (opp.program == the record
// type's picklist_label). The portal is NOT hardcoded to any program.
export function programLabel(opp) {
  return (opp && opp.program) || 'Program'
}

// ─── Project tracker tree ────────────────────────────────────────────────────
export async function fetchProjectTracker() {
  const { data, error } = await supabase.rpc('get_portal_project_tracker')
  if (error) throw error

  const payload = data || {}
  if (payload.error) return { error: payload.error, properties: [] }

  const mapOpp = (o) => ({
    id: o.id,
    recordNumber: o.record_number || '',
    name: o.name || '',
    program: o.program || '',            // the opportunity's record type label
    stageLabel: o.stage_label || 'Not Started',
    stageOrder: Number(o.stage_order) || 0,
    stages: (o.stages || []).map((s) => ({
      label: s.label || '',
      sortOrder: Number(s.sort_order) || 0,
    })),
  })

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
      opportunities: (b.opportunities || []).map(mapOpp),
    })),
  }))

  return { portalUserId: payload.portal_user_id, properties }
}

// ─── Stage math (data-driven; no fixed phase count) ──────────────────────────
export function stageCountOf(opportunity) {
  return (opportunity?.stages || []).length
}

export function opportunityPct(stageOrder, stageCount) {
  const total = Number(stageCount) || 0
  if (total <= 0) return 0
  return Math.round((Number(stageOrder) || 0) / total * 100)
}

export function oppPct(opportunity) {
  if (!opportunity) return 0
  return opportunityPct(opportunity.stageOrder, stageCountOf(opportunity))
}

// Bucket a single opportunity by lifecycle position.
export function oppBucket(opportunity) {
  if (!opportunity) return 'none'
  const count = stageCountOf(opportunity)
  const so = opportunity.stageOrder
  if (count > 0 && so >= count) return 'complete'
  if (so <= 0) return 'notStarted'
  if (count > 0 && so === count - 1) return 'submittal'
  return 'inProgress'
}

// ─── Program discovery (data-driven; no hardcoded program list) ──────────────
export function buildingOpps(building) {
  return (building?.opportunities) || []
}

// The opportunity on a building for a given program (record type label), or null.
export function oppForProgram(building, program) {
  return buildingOpps(building).find((o) => o.program === program) || null
}

// Distinct programs (record type labels) present anywhere under a property,
// in stable alphabetical order. Drives how many tracks render.
export function propertyPrograms(property) {
  const set = new Set()
  for (const b of property.buildings || []) {
    for (const o of b.opportunities || []) if (o.program) set.add(o.program)
  }
  return Array.from(set).sort()
}

// ─── Per-program rollups (keyed by record type label) ────────────────────────
export function buildingProgramPct(building, program) {
  const opp = oppForProgram(building, program)
  return opp ? oppPct(opp) : null
}

export function propertyProgramPct(property, program) {
  const vals = (property.buildings || [])
    .map((b) => buildingProgramPct(b, program))
    .filter((v) => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, v) => a + v, 0) / vals.length)
}

// A building's overall status, considering all its opportunities.
export function buildingStatus(building) {
  const opps = buildingOpps(building)
  if (!opps.length) return 'notStarted'
  const buckets = opps.map(oppBucket)
  if (buckets.every((b) => b === 'complete')) return 'complete'
  if (buckets.some((b) => b === 'submittal')) return 'submittal'
  if (buckets.every((b) => b === 'notStarted')) return 'notStarted'
  return 'inProgress'
}

export function allBuildings(property) {
  return property.buildings || []
}

// Property-level building counts by status bucket (drives the dashboard cards).
export function buildingStats(property) {
  const buildings = allBuildings(property)
  let complete = 0, inProgress = 0, submittal = 0, notStarted = 0
  for (const b of buildings) {
    switch (buildingStatus(b)) {
      case 'complete': complete++; break
      case 'submittal': submittal++; break
      case 'notStarted': notStarted++; break
      default: inProgress++; break
    }
  }
  return { total: buildings.length, complete, inProgress, submittal, notStarted }
}
