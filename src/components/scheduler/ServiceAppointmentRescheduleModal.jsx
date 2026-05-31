// ServiceAppointmentRescheduleModal — single-SA reschedule for the
// internal dispatcher. Distinct from the bulk wizard (which operates on
// a whole project's worth of work orders) and the customer portal flow
// (which uses a magic-link token).
//
// Layout: header with SA #, work-type / property / unit context line,
// then a small form: new start datetime, new end datetime, Team Lead
// picker. Duration is preserved by default — changing start auto-updates
// end. Calls dispatch_reschedule_service_appointment RPC on submit.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { C } from '../../data/constants'
import { Icon } from '../UI'
import { useToast } from '../Toast'
import {
  dispatchRescheduleServiceAppointment,
  fetchTeamLeads,
} from '../../data/projectScheduler'

// ── Date helpers ─────────────────────────────────────────────────────────
// Convert a timestamptz ISO string to the local-time value an
// <input type="datetime-local"> expects: 'YYYY-MM-DDTHH:MM'.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// Convert local-input 'YYYY-MM-DDTHH:MM' to a timestamptz ISO using the
// browser's local timezone (matches the engine's tz default).
function localInputToISO(local) {
  if (!local) return null
  // new Date('YYYY-MM-DDTHH:MM') is interpreted as local time
  const d = new Date(local)
  return d.toISOString()
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
function fmtClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function ServiceAppointmentRescheduleModal({
  serviceAppointmentId,
  onClose,
  onRescheduled,
}) {
  const toast = useToast()
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [sa, setSa]             = useState(null)
  const [currentLead, setCurrentLead] = useState(null)
  const [leads, setLeads]       = useState([])
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd]     = useState('')
  const [newLeadId, setNewLeadId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  // Load SA + current team lead + qualified leads list
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true); setError(null)
        const { data, error: saErr } = await supabase
          .from('service_appointments')
          .select(`
            id, sa_record_number, sa_status,
            sa_scheduled_start_time, sa_scheduled_end_time,
            work_order_id,
            work_orders!service_appointments_work_order_id_fkey (
              id, work_order_record_number, work_order_name,
              work_type_id,
              work_types ( id, work_type_name ),
              buildings ( id, building_name, properties ( id, property_name ) ),
              units ( id, unit_name )
            ),
            service_appointment_assignments!service_appointment_assignments_service_appointment_id_fkey (
              id, contact_id, saa_user_id, saa_is_deleted,
              contacts ( id, contact_first_name, contact_last_name, contact_title ),
              users:saa_user_id ( id, user_name, user_title )
            )
          `)
          .eq('id', serviceAppointmentId)
          .single()
        if (saErr) throw saErr
        if (cancelled) return

        const assignments = Array.isArray(data?.service_appointment_assignments)
          ? data.service_appointment_assignments.filter(a => !a.saa_is_deleted) : []
        // The lead assignment is either a user-linked row or a contact whose
        // title marks them a Team Lead.
        const leadAssign = assignments.find(a =>
          a.saa_user_id ||
          (a.contacts?.contact_title || '').toLowerCase().includes('team lead')) || null
        const lead = leadAssign
          ? (leadAssign.saa_user_id && leadAssign.users
              ? { id: leadAssign.users.id, full_name: leadAssign.users.user_name || '(user)' }
              : (leadAssign.contacts
                  ? { id: leadAssign.contacts.id,
                      full_name: `${leadAssign.contacts.contact_first_name || ''} ${leadAssign.contacts.contact_last_name || ''}`.trim() }
                  : null))
          : null

        setSa(data)
        setCurrentLead(lead)
        setNewStart(isoToLocalInput(data.sa_scheduled_start_time))
        setNewEnd(isoToLocalInput(data.sa_scheduled_end_time))
        setNewLeadId(lead?.id || '')

        // Fetch qualified leads for this WO's work_type
        const woId = data.work_order_id
        if (woId) {
          const startDateOnly = (data.sa_scheduled_start_time || new Date().toISOString()).slice(0, 10)
          const leadsList = await fetchTeamLeads({ workOrderIds: [woId], startDate: startDateOnly })
          if (cancelled) return
          setLeads(leadsList)
        } else {
          const leadsList = await fetchTeamLeads({})
          if (cancelled) return
          setLeads(leadsList)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load appointment')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [serviceAppointmentId])

  // Duration is fixed — keep end aligned to start when start changes
  const handleStartChange = (val) => {
    const oldDur = diffMinutes(newStart, newEnd)
    setNewStart(val)
    if (oldDur > 0) setNewEnd(addMinutesToLocalInput(val, oldDur))
  }
  const handleEndChange = (val) => setNewEnd(val)

  // Validation
  const startISO = useMemo(() => localInputToISO(newStart), [newStart])
  const endISO   = useMemo(() => localInputToISO(newEnd),   [newEnd])
  const valid = useMemo(() => {
    if (!startISO || !endISO) return false
    if (new Date(startISO) >= new Date(endISO)) return false
    if (!newLeadId) return false
    return true
  }, [startISO, endISO, newLeadId])

  // Has anything actually changed from the current state?
  const hasChange = useMemo(() => {
    if (!sa) return false
    const sameStart = startISO === new Date(sa.sa_scheduled_start_time).toISOString()
    const sameEnd   = endISO   === new Date(sa.sa_scheduled_end_time).toISOString()
    const sameLead  = newLeadId === (currentLead?.id || '')
    return !(sameStart && sameEnd && sameLead)
  }, [sa, startISO, endISO, newLeadId, currentLead])

  const submit = async () => {
    setSubmitting(true); setSubmitError(null)
    try {
      const lead = leads.find(l => l.id === newLeadId)
      const res = await dispatchRescheduleServiceAppointment({
        serviceAppointmentId,
        newStartIso: startISO,
        newEndIso:   endISO,
        newTeamLeadSource: lead?.source || 'contact',
        newTeamLeadContactId: lead && lead.source === 'user' ? null : (lead?.contact_id ?? newLeadId),
        newTeamLeadUserId:    lead && lead.source === 'user' ? (lead.user_id ?? newLeadId) : null,
      })
      if (res?.status === 'ok') {
        toast.success(`Rescheduled ${res.sa_record_number || sa?.sa_record_number || 'appointment'}.`)
        onRescheduled?.()
        onClose()
      } else if (res?.status === 'slot_taken') {
        setSubmitError(res.message || 'That time conflicts with another appointment for the selected Team Lead.')
      } else if (res?.status === 'not_reschedulable') {
        setSubmitError(res.message || 'Only appointments in Scheduled status can be rescheduled.')
      } else if (res?.status === 'invalid_resource') {
        setSubmitError('The selected Team Lead is not valid.')
      } else if (res?.status === 'invalid_slot') {
        setSubmitError('The selected time range is invalid.')
      } else if (res?.status === 'appointment_not_found') {
        setSubmitError('Appointment not found — it may have been deleted.')
      } else {
        setSubmitError(`Reschedule failed (${res?.status || 'unknown'}).`)
      }
    } catch (e) {
      setSubmitError(e.message || 'Reschedule failed')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ───
  const wo = sa?.work_orders
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
              background: '#eff6ff', border: '1px solid #bfdbfe',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon path="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h6 M16 2v4 M8 2v4 M3 10h18 M16 14v2.5l1.5 1.5 M16 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" size={17} color="#2563eb" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
                Reschedule Appointment
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {sa?.sa_record_number || ''}{ctxLine ? ` • ${ctxLine}` : ''}
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
          {loading && <div style={{ padding: 8, color: C.textSecondary, fontSize: 12.5 }}>Loading appointment…</div>}
          {error && <div style={errorBox}>{error}</div>}

          {!loading && !error && sa && (
            <>
              {/* Current state read-out */}
              <div style={{
                padding: 10, background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 14,
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
              }}>
                <div>
                  <div style={labelStyle}>Currently scheduled</div>
                  <div style={readStyle}>
                    {fmtClock(sa.sa_scheduled_start_time)}<br />
                    <span style={{ color: C.textMuted }}>to</span> {fmtClock(sa.sa_scheduled_end_time)}
                  </div>
                </div>
                <div>
                  <div style={labelStyle}>Currently assigned</div>
                  <div style={readStyle}>{currentLead?.full_name || <em style={{ color: C.textMuted }}>(none)</em>}</div>
                </div>
              </div>

              {/* Form */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>New start</label>
                  <input type="datetime-local" value={newStart}
                    onChange={e => handleStartChange(e.target.value)}
                    disabled={submitting} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>New end</label>
                  <input type="datetime-local" value={newEnd}
                    onChange={e => handleEndChange(e.target.value)}
                    disabled={submitting} style={inputStyle} />
                  <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>
                    Duration: {Math.max(0, diffMinutes(newStart, newEnd))} min
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>New Team Lead</label>
                <select value={newLeadId}
                  onChange={e => setNewLeadId(e.target.value)}
                  disabled={submitting} style={inputStyle}>
                  <option value="">— Select —</option>
                  <optgroup label="Qualified for this work">
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
            disabled={!valid || !hasChange || submitting || loading}
            style={{
              ...btnPrimary,
              opacity: (!valid || !hasChange || submitting || loading) ? 0.55 : 1,
              cursor: submitting ? 'wait' : (!valid || !hasChange || loading ? 'not-allowed' : 'pointer'),
            }}>
            {submitting ? 'Rescheduling…' : 'Reschedule'}
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
  border: '1px solid #fecaca', borderRadius: 5, fontSize: 12.5, marginBottom: 10,
}
const btnSecondary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 500,
  background: C.surface, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
}
const btnPrimary = {
  padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
  background: '#2563eb', color: 'white', border: '1px solid #1d4ed8',
  borderRadius: 5, cursor: 'pointer',
}
