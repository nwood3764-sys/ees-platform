// WorkOrderScheduleModal — single-WO scheduling for the internal dispatcher.
//
// Mirror of ServiceAppointmentRescheduleModal but for the *forward* path:
// the dispatcher has a brand-new Work Order in 'To Be Scheduled' status
// (typically an add-on or one-off outside the bulk Project plan) and needs
// to commit it to a Team Lead + start time without running the 3-step
// Project Scheduler wizard.
//
// Engine: reuses bulk_schedule_work_orders via a one-element WO array plus
// a pinned_placements entry at the chosen start. Skills/cert gate, working-
// hour boundaries, conflict detection — all enforced server-side, identical
// to the bulk path. The day window is the chosen date only.
//
// Layout: header with WO #, work-type / property / unit context line, then a
// small form: Team Lead picker (qualified-only), start datetime, computed
// end datetime (read-only, work-type-dictated duration).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C } from '../../data/constants'
import { Icon } from '../UI'
import { useToast } from '../Toast'
import {
  bulkScheduleWorkOrders,
  fetchTeamLeads,
  describePlacementError,
} from '../../data/projectScheduler'

// ── Date helpers (lifted from ServiceAppointmentRescheduleModal — same
// browser-local <input type='datetime-local'> handling) ──────────────────
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToISO(local) {
  if (!local) return null
  return new Date(local).toISOString()
}
function addMinutesToLocalInput(local, minutes) {
  if (!local || !minutes) return ''
  const d = new Date(local)
  d.setMinutes(d.getMinutes() + minutes)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
// YYYY-MM-DD slice of a local input value (engine expects a date string
// for p_start_date / p_end_date, not an ISO timestamp).
function localInputToYMD(local) {
  if (!local) return null
  return local.slice(0, 10)
}
// Default the initial start to 'tomorrow 7:00 AM local' — the engine's
// daily window opens at 07:00, so this is the earliest legal pin and a
// sensible nudge for the dispatcher.
function defaultStartLocal() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(7, 0, 0, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function WorkOrderScheduleModal({
  workOrderId,
  onClose,
  onScheduled,
}) {
  const toast = useToast()
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [wo, setWo]                 = useState(null)
  const [leads, setLeads]           = useState([])
  const [startLocal, setStartLocal] = useState(defaultStartLocal())
  const [newLeadId, setNewLeadId]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Load WO + qualified Team Leads list. Status guard is also enforced by
  // the RPC, but checking client-side gives a cleaner error before submit.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true); setError(null)
        const { data, error: woErr } = await supabase
          .from('work_orders')
          .select(`
            id, work_order_record_number, work_order_name,
            work_order_status, work_order_duration_minutes,
            project_id, work_type_id, building_id, unit_id,
            work_types ( id, work_type_name, work_type_duration_minutes ),
            buildings (
              id, building_name,
              properties ( id, property_name )
            ),
            units ( id, unit_name )
          `)
          .eq('id', workOrderId)
          .single()
        if (woErr) throw woErr
        if (cancelled) return

        // Resolve status picklist value → readable string for the guard.
        const { data: pv } = await supabase
          .from('picklist_values')
          .select('id, picklist_value')
          .eq('id', data.work_order_status)
          .maybeSingle()
        const statusLabel = pv?.picklist_value || null

        const effectiveDuration =
          (data.work_order_duration_minutes != null ? Number(data.work_order_duration_minutes) : null) ??
          (data.work_types?.work_type_duration_minutes != null
            ? Number(data.work_types.work_type_duration_minutes) : null)

        setWo({
          ...data,
          status_label: statusLabel,
          effective_duration_minutes: effectiveDuration,
        })

        // Fetch qualified leads for this WO's work_type. Engine gate is
        // identical to bulk path — uses team_leads_qualified_for_work_orders.
        const ymd = (startLocal || defaultStartLocal()).slice(0, 10)
        const leadsList = await fetchTeamLeads({ workOrderIds: [workOrderId], startDate: ymd })
        if (cancelled) return
        setLeads(leadsList)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load work order')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // startLocal intentionally excluded — leads list does not need to re-fetch
    // on every keystroke; cert expiry check uses start_date for cutoff only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId])

  const duration = wo?.effective_duration_minutes || 0
  const durationSource = wo?.work_order_duration_minutes != null
    ? 'work_order_override'
    : (wo?.work_types?.work_type_duration_minutes != null ? 'work_type_default' : null)
  const endLocal = useMemo(
    () => duration > 0 ? addMinutesToLocalInput(startLocal, duration) : '',
    [startLocal, duration]
  )
  const startISO = useMemo(() => localInputToISO(startLocal), [startLocal])
  const endISO   = useMemo(() => localInputToISO(endLocal),   [endLocal])

  // Client-side guards. RPC enforces everything authoritatively; these are
  // just to disable the submit button for obviously-invalid input.
  const statusOk = wo?.status_label === 'To Be Scheduled'
  const valid = useMemo(() => {
    if (!statusOk) return false
    if (!duration || duration <= 0) return false
    if (!startISO || !endISO) return false
    if (new Date(startISO) >= new Date(endISO)) return false
    if (!newLeadId) return false
    return true
  }, [statusOk, duration, startISO, endISO, newLeadId])

  const submit = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const ymd = localInputToYMD(startLocal)
      const lead = leads.find(l => l.id === newLeadId)
      const leadParams = lead && lead.source === 'user'
        ? { teamLeadSource: 'user', teamLeadUserId: lead.user_id ?? lead.id }
        : { teamLeadSource: 'contact', teamLeadContactId: (lead?.contact_id ?? newLeadId) }
      const rows = await bulkScheduleWorkOrders({
        projectId: wo.project_id,
        workOrderIds: [wo.id],
        ...leadParams,
        startDate: ymd,
        endDate: ymd,                     // single-day window
        pinnedPlacements: [{
          work_order_id: wo.id,
          start_ts: startISO,
          force: false,
        }],
        commit: true,
        mode: 'schedule',
      })
      const row = Array.isArray(rows) ? rows[0] : null
      if (row?.placed && row?.service_appointment_id) {
        toast.success(`Scheduled ${wo.work_order_record_number} → ${row.service_appointment_record_number || 'appointment'}.`)
        onScheduled?.(row.service_appointment_id)
        onClose()
      } else if (row?.placement_error) {
        setSubmitError(describePlacementError(row.placement_error))
      } else {
        setSubmitError('Scheduling failed — see record for details.')
      }
    } catch (e) {
      // The RPC raises typed errors for: not authenticated, picklist missing,
      // bad project, contact not a Team Lead, contact missing certifications,
      // WO not in 'To Be Scheduled' status. Surface the message verbatim —
      // it already names the failure.
      setSubmitError(e.message || 'Scheduling failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ───
  const ctxLine = [
    wo?.work_types?.work_type_name,
    wo?.buildings?.properties?.property_name,
    wo?.buildings?.building_name,
    wo?.units?.unit_name,
  ].filter(Boolean).join(' · ')

  return (
    <div style={overlay} onClick={submitting ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: '#ecfdf5', border: `1px solid ${C.emerald}33`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* lucide: calendar-plus — calendar + small '+' to read as 'schedule new' */}
              <Icon path="M8 2v4 M16 2v4 M3 10h18 M19 16v6 M22 19h-6 M21 12.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" size={17} color={C.emerald} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
                Schedule Work Order
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {wo?.work_order_record_number || ''}{ctxLine ? ` • ${ctxLine}` : ''}
              </div>
            </div>
          </div>
          <button onClick={submitting ? undefined : onClose} disabled={submitting}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, borderRadius: 4,
                     cursor: submitting ? 'wait' : 'pointer', color: C.textMuted }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {loading && <div style={{ padding: 8, color: C.textSecondary, fontSize: 12.5 }}>Loading work order…</div>}
          {error && <div style={errorBox}>{error}</div>}

          {!loading && !error && wo && (
            <>
              {/* Status / duration read-out */}
              <div style={{
                padding: 10, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 14,
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
              }}>
                <div>
                  <div style={labelStyle}>Current status</div>
                  <div style={readStyle}>
                    {wo.status_label || <em style={{ color: C.textMuted }}>(unknown)</em>}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Duration</div>
                  <div style={readStyle}>
                    {duration > 0
                      ? `${duration} min`
                      : <span style={{ color: '#1e466b' }}>not set</span>}
                    {durationSource && duration > 0 && (
                      <span style={{ fontSize: 10.5, color: C.textMuted, marginLeft: 6 }}>
                        ({durationSource === 'work_order_override' ? 'WO override' : 'work-type default'})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status guard — must be 'To Be Scheduled' */}
              {!statusOk && (
                <div style={{
                  padding: '8px 10px', background: '#eef5fc', color: '#1e466b',
                  border: '1px solid #fde68a', borderRadius: 5, fontSize: 12.5, marginBottom: 12,
                }}>
                  Only work orders in <strong>To Be Scheduled</strong> status can be scheduled here.
                  For already-scheduled work, open its Service Appointment and use Reschedule.
                </div>
              )}

              {/* Duration guard */}
              {statusOk && (!duration || duration <= 0) && (
                <div style={{
                  padding: '8px 10px', background: '#eef5fc', color: '#1e466b',
                  border: '1px solid #fde68a', borderRadius: 5, fontSize: 12.5, marginBottom: 12,
                }}>
                  No duration is set on this work order's work type. Set <strong>work_type_duration_minutes</strong>
                  on the Work Type, or override <strong>work_order_duration_minutes</strong> on this record, before scheduling.
                </div>
              )}

              {/* Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Start</label>
                  <input type="datetime-local" value={startLocal}
                    onChange={e => setStartLocal(e.target.value)}
                    disabled={submitting || !statusOk} style={inputStyle} />
                  <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                    Engine window: 07:00–15:30, Mon–Fri, lunch 11:30–12:00
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>End (computed)</label>
                  <input type="datetime-local" value={endLocal}
                    readOnly tabIndex={-1}
                    style={{ ...inputStyle, background: C.page, color: C.textSecondary }} />
                  <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                    {endLocal ? `Ends ${fmtClock(endISO)}` : 'Duration not set'}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Team Lead</label>
                <select value={newLeadId}
                  onChange={e => setNewLeadId(e.target.value)}
                  disabled={submitting || !statusOk} style={inputStyle}>
                  <option value="">— Select —</option>
                  <optgroup label="Qualified for this work type">
                    {leads.filter(l => l.qualified).map(l => (
                      <option key={l.id} value={l.id}>
                        {l.full_name}{l.crew_label ? ` (${l.crew_label})` : ''}
                      </option>
                    ))}
                  </optgroup>
                  {leads.some(l => !l.qualified) && (
                    <optgroup label="Missing required certifications">
                      {leads.filter(l => !l.qualified).map(l => (
                        <option key={l.id} value={l.id} disabled
                          title={l.missing_certs ? `Missing: ${l.missing_certs}` : 'Missing certifications'}>
                          {l.full_name} — missing {l.missing_certs || 'certifications'}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {submitError && <div style={errorBox}>{submitError}</div>}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button onClick={submitting ? undefined : onClose} disabled={submitting}
            style={btnSecondary}>Cancel</button>
          <button onClick={submit}
            disabled={!valid || submitting || loading}
            style={{
              ...btnPrimary,
              opacity: (!valid || submitting || loading) ? 0.55 : 1,
              cursor: submitting ? 'wait' : (!valid || loading ? 'not-allowed' : 'pointer'),
            }}>
            {submitting ? 'Scheduling…' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const card = {
  background: C.surface, borderRadius: 8, width: '92%', maxWidth: 540,
  boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)',
  display: 'flex', flexDirection: 'column', maxHeight: '92vh',
}
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
}
const bodyStyle = { padding: 14, overflow: 'auto' }
const footerStyle = {
  display: 'flex', justifyContent: 'space-between', gap: 8,
  padding: '10px 14px', borderTop: `1px solid ${C.border}`,
}
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4,
}
const readStyle = {
  fontSize: 13, color: C.textPrimary, lineHeight: 1.45,
}
const inputStyle = {
  width: '100%', padding: '7px 9px', fontSize: 13,
  color: C.textPrimary, background: C.surface,
  border: `1px solid ${C.border}`, borderRadius: 5,
}
const errorBox = {
  padding: '8px 10px', background: '#fef2f2', color: '#991b1b',
  border: '1px solid #bcd9f2', borderRadius: 5, fontSize: 12.5, marginBottom: 10,
}
const btnSecondary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 500,
  background: C.surface, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
}
const btnPrimary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: C.emerald, color: 'white', border: '1px solid #2aab72',
  borderRadius: 5, cursor: 'pointer',
}
