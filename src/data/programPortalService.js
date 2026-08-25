// =============================================================================
// programPortalService — data layer for the Program Manager Portal.
//
// The Program Manager Portal (mounted at /program-portal) shows a program
// implementer — Everblue today — exactly the assessment and project records EES
// has explicitly shared with them, and nothing else. Access comes from
// portal_record_grants: there is no ownership, no assignment, and no implicit
// scope. The read is the SECURITY DEFINER RPC get_program_portal_data().
//
// Files are never addressed directly. Photos and reports arrive as IDs, and the
// program-portal-file edge function mints a short-lived signed URL after
// re-deriving the caller's scope server-side — and, for downloads, after
// checking both permission flags and writing portal_download_log.
// =============================================================================

import { supabase } from '../lib/supabase'

// ─── Portal-user session resolution ──────────────────────────────────────────
export async function fetchProgramPortalUserSelf() {
  const { data: sessionData } = await supabase.auth.getUser()
  const authUser = sessionData?.user
  if (!authUser) return null

  const { data, error } = await supabase
    .from('portal_users')
    .select('id, full_name, email, status, record_type, portal_role, role:portal_role ( picklist_label )')
    .eq('auth_user_id', authUser.id)
    .eq('is_deleted', false)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return { ...data, portalRoleLabel: data.role?.picklist_label || '' }
}

// ─── The tree ────────────────────────────────────────────────────────────────
export async function fetchProgramPortalData(viewAsPortalUserId = null) {
  const { data, error } = await supabase.rpc('get_program_portal_data', {
    p_view_as_portal_user_id: viewAsPortalUserId || null,
  })
  if (error) throw error
  const payload = data || {}
  if (payload.error) return { error: payload.error, properties: [] }

  const mapPhoto = (p) => ({
    id: p.id,
    caption: p.caption || '',
    type: p.type || '',
    takenAt: p.taken_at || null,
  })
  const mapStep = (s) => ({
    id: s.id,
    name: s.name || '',
    order: Number(s.order) || 0,
    status: s.status || '',
    notApplicableReason: s.not_applicable_reason || null,
    photos: (s.photos || []).map(mapPhoto),
  })
  const mapWorkOrder = (w) => ({
    id: w.id,
    name: w.name || '',
    recordType: w.record_type || '',
    status: w.status || '',
    workSteps: (w.work_steps || []).map(mapStep),
    reports: (w.reports || []).map((r) => ({ id: r.id, name: r.name || 'Energy Assessment Report', createdAt: r.created_at || null })),
  })
  const mapAssessment = (a) => ({
    id: a.id,
    recordNumber: a.record_number || '',
    name: a.name || '',
    recordType: a.record_type || '',
    status: a.status || '',
    assessmentDate: a.assessment_date || null,
    workOrders: (a.work_orders || []).map(mapWorkOrder),
  })

  return {
    portalUserId: payload.portal_user_id,
    organization: payload.organization || '',
    canDownload: payload.can_download === true,
    properties: (payload.properties || []).map((p) => ({
      id: p.id,
      name: p.name || 'Unnamed Property',
      recordNumber: p.record_number || '',
      city: p.city || '',
      state: p.state || '',
      buildings: (p.buildings || []).map((b) => ({
        id: b.id,
        name: b.name || 'Unnamed Building',
        recordNumber: b.record_number || '',
        address: b.address || '',
        assessments: (b.assessments || []).map(mapAssessment),
      })),
    })),
  }
}

// ─── Files ───────────────────────────────────────────────────────────────────
// `action` is 'view' (inline, watermarked where available, not logged) or
// 'download' (the original, permission-gated, always logged).
export async function fetchProgramPortalFileUrl({ fileObject, fileId, action = 'view', viewAsPortalUserId = null }) {
  const { data, error } = await supabase.functions.invoke('program-portal-file', {
    body: {
      file_object: fileObject,
      file_id: fileId,
      action,
      view_as_portal_user_id: viewAsPortalUserId || null,
    },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

// ─── Counts, for the portal's own summaries ─────────────────────────────────
export function assessmentCounts(assessment) {
  let steps = 0, photos = 0, reports = 0
  for (const w of assessment?.workOrders || []) {
    reports += (w.reports || []).length
    for (const s of w.workSteps || []) {
      steps++
      photos += (s.photos || []).length
    }
  }
  return { steps, photos, reports }
}

export function propertyCounts(property) {
  let buildings = 0, assessments = 0, photos = 0, reports = 0
  for (const b of property?.buildings || []) {
    buildings++
    for (const a of b.assessments || []) {
      assessments++
      const c = assessmentCounts(a)
      photos += c.photos
      reports += c.reports
    }
  }
  return { buildings, assessments, photos, reports }
}

// =============================================================================
// Internal side — choosing which records a program manager may see.
// =============================================================================

// Assessments and projects an admin can share, with enough context to pick the
// right one. Deliberately shows EVERY assessment: which ones get exposed, and
// when, is a business decision made record by record.
export async function searchShareableRecords(objectName, query = '') {
  const q = (query || '').trim()

  if (objectName === 'assessments') {
    let req = supabase
      .from('assessments')
      .select(`id, assessment_record_number, assessment_name, assessment_date, project_id,
               properties:property_id ( property_name, property_city, property_state ),
               buildings:building_id ( building_name )`)
      .eq('assessment_is_deleted', false)
      .order('assessment_record_number', { ascending: false })
      .limit(200)
    if (q) req = req.or(`assessment_record_number.ilike.%${q}%,assessment_name.ilike.%${q}%`)
    const { data, error } = await req
    if (error) throw error
    return (data || []).map((r) => ({
      id: r.id,
      recordNumber: r.assessment_record_number,
      name: r.assessment_name || '',
      date: r.assessment_date,
      context: [r.properties?.property_name, r.buildings?.building_name].filter(Boolean).join(' · '),
      hasProject: !!r.project_id,
    }))
  }

  let req = supabase
    .from('projects')
    .select(`id, project_record_number, project_name,
             buildings:building_id ( building_name, properties:property_id ( property_name ) )`)
    .eq('project_is_deleted', false)
    .order('project_record_number', { ascending: false })
    .limit(200)
  if (q) req = req.or(`project_record_number.ilike.%${q}%,project_name.ilike.%${q}%`)
  const { data, error } = await req
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    recordNumber: r.project_record_number,
    name: r.project_name || '',
    date: null,
    context: [r.buildings?.properties?.property_name, r.buildings?.building_name].filter(Boolean).join(' · '),
    hasProject: true,
  }))
}

export async function fetchRecordGrants(portalUserId) {
  const { data, error } = await supabase
    .from('portal_record_grants')
    .select('id, prg_record_number, prg_object, prg_record_id, prg_created_at')
    .eq('prg_portal_user_id', portalUserId)
    .eq('prg_is_deleted', false)
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    recordNumber: r.prg_record_number,
    object: r.prg_object,
    recordId: r.prg_record_id,
    createdAt: r.prg_created_at,
  }))
}

export async function grantRecord(portalUserId, objectName, recordId, currentUserId) {
  const { error } = await supabase.from('portal_record_grants').insert({
    prg_record_number: '',
    prg_portal_user_id: portalUserId,
    prg_object: objectName,
    prg_record_id: recordId,
    prg_owner: currentUserId || null,
    prg_created_by: currentUserId || null,
    prg_updated_by: currentUserId || null,
  })
  if (error) throw error
}

// Soft-delete, like everything else in LEAP — a revoked grant stays on the
// record so it is auditable that it once existed.
export async function revokeRecordGrant(grantId, currentUserId, reason = 'Revoked from Manage Shared Records') {
  const { error } = await supabase
    .from('portal_record_grants')
    .update({
      prg_is_deleted: true,
      prg_deleted_at: new Date().toISOString(),
      prg_deleted_by: currentUserId || null,
      prg_deletion_reason: reason,
      prg_updated_by: currentUserId || null,
    })
    .eq('id', grantId)
  if (error) throw error
}
