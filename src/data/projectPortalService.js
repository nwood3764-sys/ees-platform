// =============================================================================
// projectPortalService — data layer for the customer-facing Project Portal.
//
// The Project Portal is a standalone bypass surface (mounted at /project-portal
// in main.jsx) that lets a property owner / property manager track the stage of
// their IRA program work at the property → building → unit level. Access is
// governed entirely by explicit grants in portal_user_property_grants — there is
// NO inherited authority or account-level hierarchy. The read layer is the
// SECURITY DEFINER RPC get_portal_project_tracker(), which resolves the
// authenticated portal user to their grants and returns the in-scope
// property → building → unit → opportunity tree. Each opportunity carries its
// record type's full ordered stage list (stages: [{ label, sortOrder }], from
// picklist_value_record_type_assignments) plus stage_order (the rank of its
// current stage). Nothing about the stage count is hardcoded.
//
// A unit typically runs two program opportunities — HOMES and HEAR — surfaced
// here as unit.homes / unit.hear for convenience.
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

// ─── Program helpers ──────────────────────────────────────────────────────────
// A "program" is simply an opportunity's record type, surfaced by the RPC as
// opp.program (the record type's picklist_label, e.g. "WI-IRA-MF-HOMES"). The
// portal is NOT hardcoded to any particular program — it discovers the distinct
// record types present in the data and renders one track per record type.
export function programLabel(opp) {
  return (opp && opp.program) || 'Program'
}

// ─── Project tracker tree ────────────────────────────────────────────────────
export async function fetchProjectTracker() {
  const { data, error } = await supabase.rpc('get_portal_project_tracker')
  if (error) throw error

  const payload = data || {}
  if (payload.error) {
    return { error: payload.error, properties: [] }
  }

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
    buildings: (p.buildings || []).map((b) => {
      const units = (b.units || []).map((u) => ({
        id: u.id,
        name: u.name || '',
        unitNumber: u.unit_number || '',
        recordNumber: u.record_number || '',
        opportunities: (u.opportunities || []).map(mapOpp),
      }))
      return {
        id: b.id,
        name: b.name || 'Unnamed Building',
        recordNumber: b.record_number || '',
        address: b.address || '',
        totalUnits: b.total_units ?? units.length,
        units,
        // building-level (non-unit) opportunities, if any
        opportunities: (b.opportunities || []).map(mapOpp),
      }
    }),
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
//   complete   — at (or past) its last stage
//   submittal  — exactly one stage from the end (docs/payment-request territory)
//   inProgress — somewhere in between
//   notStarted — no stage yet
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
export function unitOpps(unit) {
  return (unit?.opportunities) || []
}

// The opportunity on a unit for a given program (record type label), or null.
export function oppForProgram(unit, program) {
  return unitOpps(unit).find((o) => o.program === program) || null
}

// Distinct programs (record type labels) present anywhere under a property,
// in stable alphabetical order. This is what drives how many tracks render.
export function propertyPrograms(property) {
  const set = new Set()
  for (const b of property.buildings || []) {
    for (const u of b.units || []) for (const o of u.opportunities || []) if (o.program) set.add(o.program)
    for (const o of b.opportunities || []) if (o.program) set.add(o.program)
  }
  return Array.from(set).sort()
}

// ─── Per-program rollups (keyed by record type label) ────────────────────────
export function unitProgramPct(unit, program) {
  const opp = oppForProgram(unit, program)
  return opp ? oppPct(opp) : null
}

export function buildingProgramPct(building, program) {
  const vals = (building.units || [])
    .map((u) => unitProgramPct(u, program))
    .filter((v) => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, v) => a + v, 0) / vals.length)
}

export function propertyProgramPct(property, program) {
  const vals = (property.buildings || [])
    .map((b) => buildingProgramPct(b, program))
    .filter((v) => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, v) => a + v, 0) / vals.length)
}

// A unit's overall status, considering all its program opportunities.
export function unitStatus(unit) {
  const opps = unitOpps(unit)
  if (!opps.length) return 'notStarted'
  const buckets = opps.map(oppBucket)
  if (buckets.every((b) => b === 'complete')) return 'complete'
  if (buckets.some((b) => b === 'submittal')) return 'submittal'
  if (buckets.every((b) => b === 'notStarted')) return 'notStarted'
  return 'inProgress'
}

export function allUnits(property) {
  const out = []
  for (const b of property.buildings || []) {
    for (const u of b.units || []) out.push({ ...u, buildingId: b.id, buildingName: b.name })
  }
  return out
}

// Property-level unit counts by status bucket (drives the dashboard stat cards).
export function unitStats(property) {
  const units = allUnits(property)
  let complete = 0, inProgress = 0, submittal = 0, notStarted = 0
  for (const u of units) {
    switch (unitStatus(u)) {
      case 'complete': complete++; break
      case 'submittal': submittal++; break
      case 'notStarted': notStarted++; break
      default: inProgress++; break
    }
  }
  return { total: units.length, complete, inProgress, submittal, notStarted }
}
