// Service layer for the Reports module. Reads/writes report folders,
// reports, schedules, and per-report metadata (filters, groupings,
// calculated fields). Folder access is layered on top of the standard
// app_user_can() gating via the app_user_folder_access(folder_id) RPC,
// which returns the highest level (manager > editor > viewer) the
// calling user holds — Admin always returns 'manager'.
//
// All fetchers follow the existing list-pane convention: each row carries
// `id` (display key — record number) and `_id` (the real UUID) for routing
// into RecordDetail.

import { supabase } from '../lib/supabase'

// ─── Folders ──────────────────────────────────────────────────────────────

export async function fetchReportFolders() {
  const { data, error } = await supabase
    .from('report_folders')
    .select(`
      id, rf_record_number, rf_name, rf_description, rf_is_public,
      rf_parent_folder_id, rf_owner_user_id, updated_at,
      owner:users!report_folders_rf_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('rf_name', { ascending: true })

  if (error) throw error

  // Resolve folder access in a batch. The RPC is called per row — small N
  // so the round-trips are cheap. If folder counts ever grow large, switch
  // to a single batch RPC.
  const rows = data || []
  const accessLevels = await Promise.all(
    rows.map(r => supabase.rpc('app_user_folder_access', { p_folder_id: r.id }))
  )

  return rows.map((r, idx) => {
    const accessLevel = accessLevels[idx]?.data || null
    return {
      id:           r.rf_record_number || r.id.slice(0, 8).toUpperCase(),
      _id:          r.id,
      name:         r.rf_name,
      description:  r.rf_description || '—',
      isPublic:     r.rf_is_public ? 'Public' : 'Private',
      parentId:     r.rf_parent_folder_id,
      ownerId:      r.rf_owner_user_id,
      ownerName:    r.owner?.user_name || '—',
      accessLevel:  accessLevel,
      updatedAt:    r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
    }
  }).filter(f => f.accessLevel != null)  // hide folders the user can't access
}

// ─── Reports ──────────────────────────────────────────────────────────────

export async function fetchReports({ folderId = null } = {}) {
  let q = supabase
    .from('reports')
    .select(`
      id, rpt_record_number, rpt_name, rpt_description, rpt_format,
      rpt_primary_object, rpt_folder_id, rpt_owner_user_id,
      rpt_last_run_at, updated_at,
      folder:report_folders(id, rf_name),
      owner:users!reports_rpt_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })

  if (folderId) q = q.eq('rpt_folder_id', folderId)

  const { data, error } = await q
  if (error) throw error

  return (data || []).map(r => ({
    id:            r.rpt_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:           r.id,
    name:          r.rpt_name,
    description:   r.rpt_description || '—',
    format:        r.rpt_format ? r.rpt_format.charAt(0).toUpperCase() + r.rpt_format.slice(1) : '—',
    primaryObject: r.rpt_primary_object || '—',
    folder:        r.folder?.rf_name || '—',
    folderId:      r.rpt_folder_id,
    owner:         r.owner?.user_name || '—',
    ownerId:       r.rpt_owner_user_id,
    lastRun:       r.rpt_last_run_at ? new Date(r.rpt_last_run_at).toLocaleString() : 'Never',
    updatedAt:     r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—',
  }))
}

// ─── Scheduled reports ────────────────────────────────────────────────────

export async function fetchScheduledReports() {
  const { data, error } = await supabase
    .from('scheduled_reports')
    .select(`
      id, sr_record_number, sr_name, sr_frequency, sr_format,
      sr_send_time, sr_timezone, sr_is_active,
      sr_last_sent_at, sr_next_send_at, sr_owner_user_id,
      report:reports(id, rpt_name),
      owner:users!scheduled_reports_sr_owner_user_id_fkey(id, user_name)
    `)
    .eq('is_deleted', false)
    .order('sr_next_send_at', { ascending: true, nullsFirst: false })

  if (error) throw error

  return (data || []).map(s => ({
    id:        s.sr_record_number || s.id.slice(0, 8).toUpperCase(),
    _id:       s.id,
    name:      s.sr_name,
    report:    s.report?.rpt_name || '—',
    reportId:  s.report?.id,
    frequency: s.sr_frequency ? s.sr_frequency.charAt(0).toUpperCase() + s.sr_frequency.slice(1) : '—',
    format:    s.sr_format ? s.sr_format.toUpperCase() : '—',
    sendTime:  s.sr_send_time || '—',
    timezone:  s.sr_timezone || '—',
    active:    s.sr_is_active ? 'Active' : 'Paused',
    lastSent:  s.sr_last_sent_at ? new Date(s.sr_last_sent_at).toLocaleString() : 'Never',
    nextSend:  s.sr_next_send_at ? new Date(s.sr_next_send_at).toLocaleString() : '—',
    owner:     s.owner?.user_name || '—',
    ownerId:   s.sr_owner_user_id,
  }))
}
