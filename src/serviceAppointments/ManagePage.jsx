// ─── ManagePage.jsx ──────────────────────────────────────────────────────────
// Customer self-serve appointment management at /sa/manage/<token>.
//
// Flow:
//   1. On mount: call lookup_service_appointment_by_token. Validate token + expiry +
//      consumed-state. If anything's off, show a clear error with an email
//      fallback.
//   2. View state: show appointment summary (date, time, address, auditor,
//      work type). Two actions: Reschedule, Cancel.
//   3. Cancel: confirmation modal → cancel_appointment RPC → terminal canceled
//      state. Token is consumed on success.
//   4. Reschedule: compute-availability on the stored address → slot picker
//      → confirm → reschedule_appointment RPC → re-renders view with new
//      times. Token is NOT consumed (customer can reschedule again).
//
// Race-condition handling: if reschedule returns slot_taken, refetch
// availability and bounce back to the slot picker with an inline banner.

import { useState, useEffect, useMemo } from 'react'
import {
  lookupAppointment, cancelAppointment, rescheduleAppointment,
  computeAvailability,
} from './serviceAppointmentService'
import {
  C, card, RADIUS, FONT_MONO,
  buttonPrimary, buttonSecondary, errorBanner, label,
  formatSlot, formatTimeRange, tzForState,
} from './styles'

export default function ManagePage({ token }) {
  const validShape = /^[a-f0-9]{32}$/.test(token || '')
  if (!validShape) return <InvalidTokenPage />

  const [view, setView] = useState('loading')
  // loading | error | view | confirm_cancel | canceling | canceled
  // | loading_slots | slots | confirm_reschedule | rescheduling
  const [appointment,     setAppointment]      = useState(null)
  const [error,       setError]        = useState(null)
  const [availability, setAvailability] = useState(null)
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [slotsError,   setSlotsError]   = useState(null)

  async function loadAppointment() {
    setView('loading'); setError(null)
    try {
      const result = await lookupAppointment(token)
      if (result.status === 'ok') {
        setAppointment(result)
        if (result.sa_status === 'canceled') {
          setView('canceled')
        } else {
          setView('view')
        }
        return
      }
      setError(errorMessageForLookupStatus(result.status))
      setView('error')
    } catch (e) {
      setError(e.message || 'Could not load your appointment.')
      setView('error')
    }
  }

  useEffect(() => { loadAppointment() }, [token])

  async function handleCancel() {
    setView('canceling')
    try {
      const result = await cancelAppointment(token)
      if (result.status === 'ok') {
        setView('canceled')
        return
      }
      setError(errorMessageForCancelStatus(result.status, result.message))
      setView('error')
    } catch (e) {
      setError(e.message || 'Could not cancel. Please try again.')
      setView('view')
    }
  }

  async function startReschedule() {
    setView('loading_slots'); setSlotsError(null)
    try {
      const avail = await computeAvailability({
        slug:    appointment.work_type_slug,
        address: appointment.address,
        days:    14,
      })
      if (avail.status !== 'ok' || !avail.slots || avail.slots.length === 0) {
        setSlotsError(
          avail.status === 'no_availability'
            ? 'No availability in the next 14 days. Email us to find a time that works.'
            : (avail.message || 'No availability could be loaded.')
        )
        setView('view')
        return
      }
      setAvailability(avail)
      setView('slots')
    } catch (e) {
      setSlotsError(e.message || 'Could not load availability.')
      setView('view')
    }
  }

  async function handleReschedule() {
    setView('rescheduling')
    try {
      const result = await rescheduleAppointment({
        token,
        start_iso:   selectedSlot.start_iso,
        end_iso:     selectedSlot.end_iso,
        resource_id: selectedSlot.resource_id,
      })
      if (result.status === 'slot_taken') {
        try {
          const fresh = await computeAvailability({
            slug:    appointment.work_type_slug,
            address: appointment.address,
            days:    14,
          })
          if (fresh.status === 'ok') setAvailability(fresh)
        } catch { /* keep stale */ }
        setSlotsError('That time slot was just taken by someone else. Please pick another.')
        setView('slots')
        return
      }
      if (result.status !== 'ok') {
        setSlotsError(result.message || 'Reschedule failed.')
        setView('slots')
        return
      }
      await loadAppointment()
      setSlotsError(null)
      setSelectedSlot(null)
    } catch (e) {
      setSlotsError(e.message || 'Reschedule failed.')
      setView('slots')
    }
  }

  if (view === 'loading')       return <CenteredLoading label="Loading your appointment…" />
  if (view === 'canceling')     return <CenteredLoading label="Canceling…" />
  if (view === 'rescheduling')  return <CenteredLoading label="Rescheduling…" />
  if (view === 'loading_slots') return <CenteredLoading label="Looking for available times…" />

  if (view === 'error') {
    return (
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          We couldn't load your appointment
        </h1>
        <p style={{ color: C.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>{error}</p>
        <a href="mailto:assessments.wi@EES-WI.org?subject=Help with my appointment"
           style={{ ...buttonPrimary, display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}>
          Email Energy Efficiency Services
        </a>
      </div>
    )
  }

  if (view === 'canceled')           return <CanceledView appointment={appointment} />
  if (view === 'confirm_cancel')     return <ConfirmCancelView appointment={appointment} onConfirm={handleCancel} onBack={() => setView('view')} />
  if (view === 'slots')              return <SlotsView availability={availability} slotsError={slotsError}
                                                       onSelect={slot => { setSelectedSlot(slot); setView('confirm_reschedule') }}
                                                       onBack={() => { setView('view'); setSlotsError(null) }} />
  if (view === 'confirm_reschedule') return <ConfirmRescheduleView appointment={appointment} slot={selectedSlot}
                                                                   onConfirm={handleReschedule}
                                                                   onBack={() => setView('slots')} />

  return (
    <AppointmentView appointment={appointment} slotsError={slotsError}
                 onReschedule={startReschedule}
                 onCancel={() => setView('confirm_cancel')} />
  )
}

// ─── InvalidTokenPage ───────────────────────────────────────────────────────

function InvalidTokenPage() {
  return (
    <div style={card}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Invalid management link
      </h1>
      <p style={{ color: C.textSecondary, fontSize: 15, lineHeight: 1.5 }}>
        We couldn't recognize that appointment token. Double-check the link from
        your confirmation, or email{' '}
        <a href="mailto:assessments.wi@EES-WI.org" style={{ color: C.emeraldMid, textDecoration: 'none' }}>
          assessments.wi@EES-WI.org
        </a>{' '}
        and we'll find your appointment.
      </p>
    </div>
  )
}

// ─── CenteredLoading ────────────────────────────────────────────────────────

function CenteredLoading({ label: text }) {
  return (
    <div style={{
      ...card,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, padding: '48px 24px',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: `3px solid ${C.border}`,
        borderTopColor: C.emerald,
        animation: 'ees-spin 0.7s linear infinite',
      }} />
      <div style={{ color: C.textSecondary, fontSize: 14 }}>{text}</div>
      <style>{`@keyframes ees-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── AppointmentView (default) ──────────────────────────────────────────────────

function AppointmentView({ appointment, slotsError, onReschedule, onCancel }) {
  const tz = tzForState(appointment.address?.state)
  const { date } = formatSlot(appointment.sa_scheduled_start_iso, tz)
  const range = formatTimeRange(appointment.sa_scheduled_start_iso, appointment.sa_scheduled_end_iso, tz)

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        Your appointment
      </h1>
      <div style={{ color: C.textSecondary, fontSize: 14, marginBottom: 16 }}>
        Reference: <span style={{ fontFamily: FONT_MONO, fontSize: 13 }}>{appointment.sa_record_number}</span>
      </div>

      {slotsError && <div style={errorBanner}>{slotsError}</div>}

      <div style={card}>
        <DetailRow label="Service"  value={appointment.work_type_name} />
        <DetailRow label="Date"     value={date} highlight />
        <DetailRow label="Time"     value={range} />
        <DetailRow label="Auditor"  value={appointment.auditor_name} />
        <DetailRow label="Address"  value={`${appointment.address.street}, ${appointment.address.city}, ${appointment.address.state} ${appointment.address.zip}`} />
        <DetailRow label="Customer" value={`${appointment.customer.name} · ${appointment.customer.phone} · ${appointment.customer.email}`} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={onReschedule} style={{ ...buttonPrimary, flex: 2, minWidth: 200 }}>
          Reschedule
        </button>
        <button onClick={onCancel} style={{
          ...buttonSecondary,
          flex: 1, minWidth: 140,
          color: C.danger,
          borderColor: C.danger,
        }}>
          Cancel appointment
        </button>
      </div>

      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <a href="mailto:assessments.wi@EES-WI.org?subject=Help with my appointment"
           style={{ color: C.textMuted, fontSize: 13, textDecoration: 'none' }}>
          Need help? Email us →
        </a>
      </div>
    </div>
  )
}

// ─── ConfirmCancelView ──────────────────────────────────────────────────────

function ConfirmCancelView({ appointment, onConfirm, onBack }) {
  const tz = tzForState(appointment.address?.state)
  const { date } = formatSlot(appointment.sa_scheduled_start_iso, tz)
  const range = formatTimeRange(appointment.sa_scheduled_start_iso, appointment.sa_scheduled_end_iso, tz)

  return (
    <div style={card}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        Cancel this appointment?
      </h1>
      <p style={{ color: C.textSecondary, fontSize: 15, lineHeight: 1.5, marginBottom: 16 }}>
        You're about to cancel your <strong style={{ color: C.textPrimary }}>{appointment.work_type_name}</strong>{' '}
        scheduled for <strong style={{ color: C.textPrimary }}>{date}</strong> at{' '}
        <strong style={{ color: C.textPrimary }}>{range}</strong>.
        This can't be undone — you'll need to schedule again if you change your mind.
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={onBack} style={{ ...buttonSecondary, flex: 1 }}>
          Keep appointment
        </button>
        <button onClick={onConfirm} style={{
          ...buttonPrimary,
          flex: 1,
          background: C.danger,
        }}>
          Yes, cancel it
        </button>
      </div>
    </div>
  )
}

// ─── CanceledView ───────────────────────────────────────────────────────────

function CanceledView({ appointment }) {
  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 64, height: 64, borderRadius: '50%',
          background: C.dangerBg, marginBottom: 16,
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke={C.danger} strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          Appointment canceled
        </h1>
        <p style={{ color: C.textSecondary, fontSize: 15 }}>
          Your <strong style={{ color: C.textPrimary }}>{appointment.work_type_name}</strong>{' '}
          has been canceled. Reference{' '}
          <span style={{ fontFamily: FONT_MONO, fontSize: 13 }}>{appointment.sa_record_number}</span>.
        </p>
      </div>
      <div style={{ textAlign: 'center' }}>
        <a href="/sa" style={{ ...buttonPrimary, display: 'inline-block', textDecoration: 'none', minWidth: 240 }}>
          Schedule another appointment
        </a>
      </div>
    </div>
  )
}

// ─── SlotsView (reschedule slot picker) ─────────────────────────────────────

function SlotsView({ availability, slotsError, onSelect, onBack }) {
  const tz = availability.territory?.timezone || 'America/Chicago'
  const byDay = useMemo(() => {
    const map = new Map()
    const seenInDay = new Map()
    for (const slot of availability.slots) {
      const { date } = formatSlot(slot.start_iso, tz)
      if (!map.has(date)) {
        map.set(date, [])
        seenInDay.set(date, new Set())
      }
      if (seenInDay.get(date).has(slot.start_iso)) continue
      seenInDay.get(date).add(slot.start_iso)
      map.get(date).push(slot)
    }
    return Array.from(map.entries())
  }, [availability, tz])

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Pick a new time
      </h1>
      <p style={{ color: C.textSecondary, fontSize: 14, marginBottom: 16 }}>
        Choose from the times below. We'll move your appointment to the new slot
        once you confirm.
      </p>

      {slotsError && <div style={errorBanner}>{slotsError}</div>}

      {byDay.map(([dayLabel, slots]) => (
        <div key={dayLabel} style={{ ...card, marginBottom: 12 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: C.textPrimary,
            marginBottom: 12, paddingBottom: 8,
            borderBottom: `1px solid ${C.border}`,
          }}>
            {dayLabel}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 8,
          }}>
            {slots.map((slot, i) => {
              const { time } = formatSlot(slot.start_iso, tz)
              return (
                <button
                  key={`${slot.start_iso}-${i}`}
                  onClick={() => onSelect(slot)}
                  style={{
                    padding: '12px 8px',
                    fontSize: 14, fontWeight: 500,
                    color: C.textPrimary,
                    background: C.card,
                    border: `1px solid ${C.borderDark}`,
                    borderRadius: RADIUS,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = C.emerald
                    e.currentTarget.style.background  = C.emeraldBg
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = C.borderDark
                    e.currentTarget.style.background  = C.card
                  }}
                >
                  {time}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <button type="button" onClick={onBack} style={{ ...buttonSecondary, marginTop: 8 }}>
        ← Keep current time
      </button>
    </div>
  )
}

// ─── ConfirmRescheduleView ──────────────────────────────────────────────────

function ConfirmRescheduleView({ appointment, slot, onConfirm, onBack }) {
  const tz = tzForState(appointment.address?.state)
  const { date: oldDate } = formatSlot(appointment.sa_scheduled_start_iso, tz)
  const oldRange = formatTimeRange(appointment.sa_scheduled_start_iso, appointment.sa_scheduled_end_iso, tz)
  const { date: newDate } = formatSlot(slot.start_iso, tz)
  const newRange = formatTimeRange(slot.start_iso, slot.end_iso, tz)

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
        Confirm reschedule
      </h1>

      <div style={card}>
        <DetailRow label="Service" value={appointment.work_type_name} />
        <DetailRow label="From"    value={`${oldDate} · ${oldRange}`} />
        <DetailRow label="To"      value={`${newDate} · ${newRange}`} highlight />
        <DetailRow label="Auditor" value={slot.resource_first_name} />
        <DetailRow label="Address" value={`${appointment.address.street}, ${appointment.address.city}, ${appointment.address.state} ${appointment.address.zip}`} />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button onClick={onBack} style={{ ...buttonSecondary, flex: 1 }}>
          ← Back
        </button>
        <button onClick={onConfirm} style={{ ...buttonPrimary, flex: 2 }}>
          Confirm new time
        </button>
      </div>
    </div>
  )
}

// ─── DetailRow ──────────────────────────────────────────────────────────────

function DetailRow({ label: labelText, value, highlight }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      padding: '12px 0',
      borderBottom: `1px solid ${C.border}`,
      flexWrap: 'wrap',
    }}>
      <div style={{ ...label, marginBottom: 0, alignSelf: 'center', minWidth: 80 }}>{labelText}</div>
      <div style={{
        textAlign:  'right',
        fontSize:   highlight ? 16 : 14,
        fontWeight: highlight ? 600 : 500,
        color:      C.textPrimary,
        flex: 1, minWidth: 200,
      }}>{value}</div>
    </div>
  )
}

// ─── error-message helpers ──────────────────────────────────────────────────

function errorMessageForLookupStatus(status) {
  switch (status) {
    case 'invalid_token':
      return "We couldn't find a appointment with that link. Double-check the URL or contact us for help."
    case 'expired_token':
      return "This management link has expired. Email us and we'll help you make changes."
    case 'appointment_not_found':
      return "We couldn't find that appointment in our system. Please contact us for help."
    default:
      return 'Something went wrong loading your appointment. Please try again or contact us.'
  }
}

function errorMessageForCancelStatus(status, message) {
  if (message) return message
  switch (status) {
    case 'invalid_token':    return "We couldn't validate your link."
    case 'expired_token':    return 'This management link has expired.'
    case 'already_consumed': return 'This appointment has already been canceled.'
    case 'too_late':         return 'This appointment has already started or passed and cannot be canceled.'
    default:                 return 'Cancel failed. Please try again or contact us.'
  }
}
