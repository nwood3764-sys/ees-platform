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

  const mapWorkStep = (s) => ({
    id: s.id,
    name: s.name || '',
    status: s.status || '',              // work_step_status label
    order: Number(s.order) || 0,
    photoUrl: s.photo_url || null,       // work_step_reference_photo_url
    photos: (s.photos || []).map((p) => ({
      id: p.id,
      url: p.url || '',
      thumb: p.thumb || p.url || '',
      caption: p.caption || '',
      type: p.type || '',
    })),
  })
  const mapWorkOrder = (w) => ({
    id: w.id,
    name: w.name || '',
    recordType: w.record_type || '',     // work_order_record_type label
    status: w.status || '',              // work_order_status label
    unitId: w.unit_id || null,
    unitNumber: w.unit_number || '',
    workSteps: (w.work_steps || []).map(mapWorkStep),
  })
  const mapProject = (pr) => ({
    id: pr.id,
    name: pr.name || '',
    recordType: pr.record_type || '',    // project_record_type label
    status: pr.status || '',             // project_status label
    workOrders: (pr.work_orders || []).map(mapWorkOrder),
  })
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
    projects: (o.projects || []).map(mapProject),
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
      unitCount: Number(b.unit_count) || 0,
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

// ─── Property dashboard rollups ──────────────────────────────────────────────
// Top-line counts across the property's whole tree.
export function propertyCounts(property) {
  let buildings = 0, units = 0, opportunities = 0, projects = 0, workOrders = 0
  for (const b of property?.buildings || []) {
    buildings++
    units += b.unitCount || 0
    for (const o of b.opportunities || []) {
      opportunities++
      for (const pr of o.projects || []) {
        projects++
        workOrders += (pr.workOrders || []).length
      }
    }
  }
  return { buildings, units, opportunities, projects, workOrders }
}

// Iterate every work order under a property.
function eachWorkOrder(property, fn) {
  for (const b of property?.buildings || [])
    for (const o of b.opportunities || [])
      for (const pr of o.projects || [])
        for (const w of pr.workOrders || []) fn(w)
}

function eachProject(property, fn) {
  for (const b of property?.buildings || [])
    for (const o of b.opportunities || [])
      for (const pr of o.projects || []) fn(pr)
}

// Count work orders by their status label → [{ status, count }] (most first).
export function workOrderStatusCounts(property) {
  const m = new Map()
  eachWorkOrder(property, (w) => { const k = w.status || 'Unknown'; m.set(k, (m.get(k) || 0) + 1) })
  return Array.from(m, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
}

export function projectStatusCounts(property) {
  const m = new Map()
  eachProject(property, (pr) => { const k = pr.status || 'Unknown'; m.set(k, (m.get(k) || 0) + 1) })
  return Array.from(m, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
}

// Count opportunities by their current stage label → [{ status, count }].
export function opportunityStageCounts(property) {
  const m = new Map()
  for (const b of property?.buildings || [])
    for (const o of b.opportunities || []) {
      const k = o.stageLabel || 'Not Started'
      m.set(k, (m.get(k) || 0) + 1)
    }
  return Array.from(m, ([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count)
}

// ─── Projects / work orders ──────────────────────────────────────────────────
export function buildingProjects(building) {
  const out = []
  for (const o of building?.opportunities || []) {
    for (const pr of o.projects || []) out.push({ ...pr, opportunity: o })
  }
  return out
}

export function findProject(building, projectId) {
  for (const o of building?.opportunities || []) {
    const pr = (o.projects || []).find((p) => p.id === projectId)
    if (pr) return { project: pr, opportunity: o }
  }
  return null
}

// Distinct units in a building (derived from its work orders), for the tree.
export function buildingUnits(building) {
  const m = new Map()
  for (const o of building?.opportunities || [])
    for (const pr of o.projects || [])
      for (const w of pr.workOrders || [])
        if (w.unitId && !m.has(w.unitId)) m.set(w.unitId, { unitId: w.unitId, unitNumber: w.unitNumber })
  return Array.from(m.values()).sort((a, b) =>
    String(a.unitNumber || '').localeCompare(String(b.unitNumber || ''), undefined, { numeric: true }))
}

// A single unit's work orders, with their project + program context.
export function unitWorkOrders(building, unitId) {
  const out = []
  for (const o of building?.opportunities || [])
    for (const pr of o.projects || [])
      for (const w of pr.workOrders || [])
        if (w.unitId === unitId) out.push({ ...w, program: o.program, projectName: pr.name, projectRecordType: pr.recordType })
  return out
}

// Group a project's work orders by unit (for the per-unit work-order view).
export function workOrdersByUnit(project) {
  const map = new Map()
  for (const w of project?.workOrders || []) {
    const k = w.unitId || 'none'
    if (!map.has(k)) map.set(k, { unitId: w.unitId, unitNumber: w.unitNumber, workOrders: [] })
    map.get(k).workOrders.push(w)
  }
  return Array.from(map.values()).sort((a, b) =>
    String(a.unitNumber || '').localeCompare(String(b.unitNumber || ''), undefined, { numeric: true }))
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
