// ConvertDfrToSaModal — converts a dispatcher_followup_requests row into
// a real Service Appointment by calling the create_service_appointment
// RPC directly via supabase.rpc() (so the dispatcher's session JWT is
// in context). Passes bypass_territory_check=true; the RPC honors this
// flag only when current_app_user_id() IS NOT NULL (gated server-side).
//
// On success: writes dfr_resolved_sa_id + flips dfr_status to Resolved
// in one UPDATE (the trg_dfr_stamp_resolution trigger fires and stamps
// dfr_resolved_at/_by). The caller — FollowupsQueue — drops the row out
// of the queue locally and toasts success.
//
// Out-of-territory: handled. When the captured ZIP doesn't match any
// active service_territory_zips row, the RPC creates the SA with
// service_territory_id = NULL (column is already nullable) and returns
// territory_bypassed=true. The toast surfaces a small "(out-of-territory
// bypass applied)" note so the dispatcher knows the bypass triggered.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C } from '../../data/constants'
import { Icon } from '../UI'
import { useToast } from '../Toast'
import { dispatcherCreateServiceAppointment } from '../../serviceAppointments/serviceAppointmentService'
import { fetchAllFieldStaff } from '../../data/resourceManagement'
import { markDfrResolvedToSa, formatDfrAddressOneLine } from '../../data/dispatcherFollowups'

// ── Date helpers (mirror ServiceAppointmentRescheduleModal patterns) ─────
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToISO(local) {
  if (!local) return null
  const d = new Date(local)
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

function defaultStartLocal(preferred_start_at) {
  if (preferred_start_at) {
    const pre = isoToLocalInput(preferred_start_at)
    if (pre) return pre
  }
  // Default: tomorrow 9:00am local
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return isoToLocalInput(d.toISOString())
}

function addMinutesToLocalInput(local, minutes) {
  if (!local) return ''
  const d = new Date(local)
  d.setMinutes(d.getMinutes() + minutes)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function diffMinutes(startLocal, endLocal) {
  if (!startLocal || !endLocal) return 0
  return Math.round((new Date(endLocal) - new Date(startLocal)) / 60000)
}

export default function ConvertDfrToSaModal({ dfr, onClose, onConverted }) {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Choices
  const [workTypes, setWorkTypes] = useState([])  // [{ id, slug, name, duration_minutes }]
  const [resources, setResources] = useState([])  // [{ id, full_name, title, crew_label }]

  // Form state
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState('')
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal]     = useState('')
  const [resourceId, setResourceId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // ── Initial data load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true); setError(null)

        // Work types — only those publicly schedulable with a slug, which
        // is the contract the create-service-appointment edge function
        // enforces via the RPC. Same set the customer-facing flow uses.
        const wtPromise = supabase
          .from('work_types')
          .select('id, work_type_name, work_type_public_slug, work_type_duration_minutes, work_type_estimated_duration')
          .eq('work_type_is_deleted', false)
          .eq('work_type_is_active', true)
          .eq('work_type_is_publicly_schedulable', true)
          .not('work_type_public_slug', 'is', null)
          .order('work_type_name', { ascending: true })

        const [wtRes, staff] = await Promise.all([wtPromise, fetchAllFieldStaff()])
        if (cancelled) return

        if (wtRes.error) throw new Error(wtRes.error.message)
        const wts = (wtRes.data || []).map(r => ({
          id: r.id,
          slug: r.work_type_public_slug,
          name: r.work_type_name,
          duration_minutes: Number(r.work_type_duration_minutes) || Number(r.work_type_estimated_duration) || 90,
        }))
        setWorkTypes(wts)
        setResources(staff)

        // Default the work-type selector to the DFR's captured work_type
        // when it's still in the schedulable set; otherwise leave blank
        // so the dispatcher picks explicitly.
        let initialWtId = ''
        if (dfr?.work_type?.id && wts.some(w => w.id === dfr.work_type.id)) {
          initialWtId = dfr.work_type.id
        }
        setSelectedWorkTypeId(initialWtId)

        // Default start: DFR's preferred_start_at or tomorrow 9am
        const initialStart = defaultStartLocal(dfr?.dfr_preferred_start_at)
        setStartLocal(initialStart)

        // Default end: start + selected work-type's duration
        const initialWt = wts.find(w => w.id === initialWtId)
        const initialDuration = initialWt?.duration_minutes || 90
        setEndLocal(addMinutesToLocalInput(initialStart, initialDuration))
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [dfr])

  // Auto-recompute end when work type changes (preserves start, swaps duration)
  function handleWorkTypeChange(newId) {
    setSelectedWorkTypeId(newId)
    const wt = workTypes.find(w => w.id === newId)
    if (wt && startLocal) {
      setEndLocal(addMinutesToLocalInput(startLocal, wt.duration_minutes))
    }
  }

  // Auto-shift end when start changes (preserves duration)
  function handleStartChange(newStart) {
    const currentDuration = diffMinutes(startLocal, endLocal)
    setStartLocal(newStart)
    if (currentDuration > 0) {
      setEndLocal(addMinutesToLocalInput(newStart, currentDuration))
    }
  }

  const selectedWorkType = useMemo(
    () => workTypes.find(w => w.id === selectedWorkTypeId),
    [workTypes, selectedWorkTypeId]
  )

  const durationMin = useMemo(
    () => Math.max(0, diffMinutes(startLocal, endLocal)),
    [startLocal, endLocal]
  )

  const valid = useMemo(() => {
    if (!selectedWorkType) return false
    if (!startLocal || !endLocal) return false
    if (durationMin <= 0) return false
    if (!resourceId) return false
    if (!dfr?.dfr_customer_first_name || !dfr?.dfr_customer_last_name) return false
    if (!dfr?.dfr_phone) return false
    if (!dfr?.dfr_address_street || !dfr?.dfr_address_city || !dfr?.dfr_address_state || !dfr?.dfr_address_zip) {
      return false
    }
    return true
  }, [selectedWorkType, startLocal, endLocal, durationMin, resourceId, dfr])

  async function submit() {
    if (!valid || submitting) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      const start_iso = localInputToISO(startLocal)
      const end_iso   = localInputToISO(endLocal)
      if (!start_iso || !end_iso) throw new Error('Invalid start or end datetime.')

      // Step 1 — create the SA via the create_service_appointment RPC.
      // dispatcherCreateServiceAppointment calls the RPC directly via
      // supabase.rpc() so the dispatcher's session JWT is in context,
      // which activates the bypass_territory_check flag inside the RPC
      // (gated server-side on current_app_user_id() IS NOT NULL).
      // The result includes territory_bypassed=true when the bypass
      // actually triggered (out-of-territory ZIP); we use that to
      // toast a slightly different success message.
      const result = await dispatcherCreateServiceAppointment({
        slug:                 selectedWorkType.slug,
        start_iso,
        end_iso,
        resource_id:          resourceId,
        customer_first_name:  dfr.dfr_customer_first_name,
        customer_last_name:   dfr.dfr_customer_last_name,
        phone:                dfr.dfr_phone || '',
        email:                dfr.dfr_email || '',
        address: {
          street: dfr.dfr_address_street,
          city:   dfr.dfr_address_city,
          state:  dfr.dfr_address_state,
          zip:    dfr.dfr_address_zip,
        },
        bypass_territory_check: true,
      })

      // RPC returns the same shape as the edge function — surface
      // non-ok statuses as inline errors.
      if (result?.status === 'slot_taken') {
        setSubmitError(result.message || 'That time slot was just taken. Pick another.')
        setSubmitting(false)
        return
      }
      if (result?.status !== 'ok') {
        setSubmitError(result?.message || 'Could not create the appointment.')
        setSubmitting(false)
        return
      }

      // Step 2 — link the new SA to the DFR + flip to Resolved. Trigger
      // stamps resolved_at/_by automatically.
      await markDfrResolvedToSa({
        dfr_id: dfr.id,
        sa_id:  result.service_appointment_id,
      })

      const bypassNote = result.territory_bypassed
        ? ' (out-of-territory bypass applied)'
        : ''
      toast?.success?.(`Scheduled — ${result.sa_record_number} created from ${dfr.dfr_record_number}${bypassNote}`)
      onConverted?.({
        dfr_id: dfr.id,
        sa_id: result.service_appointment_id,
        sa_record_number: result.sa_record_number,
      })
      onClose?.()
    } catch (e) {
      setSubmitError(e.message || String(e))
      setSubmitting(false)
    }
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={headerStyle}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
              Schedule from {dfr?.dfr_record_number || 'DFR'}
            </div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              {dfr?.dfr_customer_first_name} {dfr?.dfr_customer_last_name}
              {dfr?.dfr_phone ? ` · ${dfr.dfr_phone}` : ''}
            </div>
          </div>
          <button onClick={submitting ? undefined : onClose} disabled={submitting}
            style={closeButton} aria-label="Close">
            <Icon path="M6 6l12 12M6 18L18 6" size={18} />
          </button>
        </div>

        <div style={bodyStyle}>
          {loading ? (
            <div style={{ color: C.textSecondary }}>Loading work types and resources…</div>
          ) : error ? (
            <div style={errorBox}>{error}</div>
          ) : (
            <>
              {/* Context summary — read-only DFR fields */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Customer</label>
                <div style={readStyle}>
                  {dfr.dfr_customer_first_name} {dfr.dfr_customer_last_name}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Address</label>
                <div style={readStyle}>{formatDfrAddressOneLine(dfr) || '—'}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Work type</label>
                <select value={selectedWorkTypeId}
                  onChange={(e) => handleWorkTypeChange(e.target.value)}
                  disabled={submitting} style={inputStyle}>
                  <option value="">— Select work type —</option>
                  {workTypes.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.duration_minutes} min)
                    </option>
                  ))}
                </select>
                {workTypes.length === 0 && (
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                    No publicly-schedulable work types are active. Configure one in Admin → Work Types.
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div>
                  <label style={labelStyle}>Start</label>
                  <input type="datetime-local" value={startLocal}
                    onChange={(e) => handleStartChange(e.target.value)}
                    disabled={submitting} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>End</label>
                  <input type="datetime-local" value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    disabled={submitting} style={inputStyle} />
                  <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                    Duration: {durationMin} min
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Resource (Team Lead / auditor)</label>
                <select value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  disabled={submitting} style={inputStyle}>
                  <option value="">— Select resource —</option>
                  {resources.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.full_name}{r.crew_label ? ` (${r.crew_label})` : ''}{r.contact_title ? ` — ${r.contact_title}` : ''}
                    </option>
                  ))}
                </select>
                {resources.length === 0 && (
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                    No active field-staff resources found.
                  </div>
                )}
              </div>

              {submitError && <div style={errorBox}>{submitError}</div>}

              <div style={noteBox}>
                Creates a new Service Appointment from this DFR's captured customer info,
                stamps the DFR as Resolved, and links the two. Conflict-checked per-resource
                per-day inside the database. The dispatcher chooses the slot and resource —
                no availability filtering in this flow.
              </div>
            </>
          )}
        </div>

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
            {submitting ? 'Scheduling…' : 'Schedule appointment'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Styles (mirror ServiceAppointmentRescheduleModal) ───────────────────
const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
  zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const card = {
  background: C.surface, borderRadius: 8, width: '92%', maxWidth: 560,
  boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)',
  display: 'flex', flexDirection: 'column', maxHeight: '92vh',
}
const headerStyle = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
  padding: '12px 14px', borderBottom: `1px solid ${C.border}`, gap: 8,
}
const closeButton = {
  background: 'transparent', border: 'none', padding: 4, cursor: 'pointer',
  color: C.textSecondary, borderRadius: 4,
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
const noteBox = {
  padding: '8px 10px', background: '#f0f7ff', color: '#1e3a5f',
  border: '1px solid #d3e4f5', borderRadius: 5, fontSize: 12, lineHeight: 1.5,
}
const btnSecondary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 500,
  background: C.surface, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
}
const btnPrimary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: C.emeraldMid, color: 'white', border: `1px solid ${C.emeraldMid}`,
  borderRadius: 5, cursor: 'pointer',
}
