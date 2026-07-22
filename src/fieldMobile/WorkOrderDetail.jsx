// ─── WorkOrderDetail.jsx ─────────────────────────────────────────────────────
// The execution surface. Loads work_order_detail_for_technician(woId):
// header + ordered steps each carrying live evidence-gap state (the same
// gate complete_work_step enforces server-side) + this technician's open
// clock session.
//
// Behavior:
//   • Clock in / out — captures GPS automatically; writes
//     work_order_time_entries via clock_in/out_work_order.
//   • Steps complete IN ORDER — a step is actionable only when every lower
//     execution_order step is Completed/Verified/Not Applicable.
//   • Inline camera capture — opens the device camera (capture attribute),
//     writes photos with the before/after/general token the step requires.
//   • Complete step — calls complete_work_step; the server re-checks the
//     evidence gate and refuses if unmet (client mirrors the gap to keep the
//     button honest, but the server is the authority).
//   • Submit for Verification — enabled when all required steps are complete;
//     calls submit_work_order_for_verification.
//   • Corrections Needed — flagged steps surface their PC/PSL comment and are
//     re-openable for re-evidence + resubmit.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import MobileShell from './MobileShell'
import {
  fetchWorkOrderDetail, completeWorkStep, submitWorkOrder,
  captureStepPhoto, captureStepVideo, photoGpsMissing, markUnableToComplete,
  markWorkStepNotApplicable, saveWorkStepFieldValue, signedPhotoUrl,
  fetchTechnicianCreatableWorkTypes, createTechnicianWorkOrder,
  fetchActiveUsers, fetchAccountContactsForWorkOrder,
} from './fieldMobileService'
import { uploadPhoto } from '../data/storageService'
import { supabase } from '../lib/supabase'
import { C, FONT, MONO, card, btnPrimary, btnSecondary, btnDisabled, statusChip } from './styles'

const DONE_STATUSES = ['completed', 'verified', 'not applicable']

// Format a scheduled timestamp as e.g. "Mon, Jun 15 · 9:00 AM" in Chicago time.
function fmtSchedule(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso)).replace(',', '').replace(' at ', ' · ')
  } catch { return '' }
}

// Format a photo's capture time (EXIF taken_at) as e.g. "9:14 AM" in Chicago
// time — shown under each work-step photo thumbnail.
function fmtPhotoTime(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '' }
}

// Format an evidence-derived duration (minutes, from first→last photo) as a
// compact "Xh Ym" / "Ym" string.
function fmtDuration(minutes) {
  if (minutes == null || isNaN(minutes)) return '—'
  const total = Math.round(minutes)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
// ─── TimeOnSite ──────────────────────────────────────────────────────────────
// Evidence-bracketed duration for the whole work order.
//   • Running (In Progress / Corrections): a live total that ticks from the
//     first photo to now, so the crew can see time-on-site accruing.
//   • Completed (submitted / verified): frozen total = first photo → last photo
//     (server-computed duration_minutes).
// Nothing renders until the first photo brackets the job.
function TimeOnSite({ firstPhotoAt, durationMinutes, running }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || !firstPhotoAt) return
    const id = setInterval(() => setNow(Date.now()), 15000) // 15s keeps the minute fresh
    return () => clearInterval(id)
  }, [running, firstPhotoAt])

  if (!firstPhotoAt && durationMinutes == null) return null

  const isLive = running && !!firstPhotoAt
  let value, label
  if (isLive) {
    value = fmtDuration((now - new Date(firstPhotoAt).getTime()) / 60000)
    label = 'Time on site · running'
  } else if (durationMinutes != null) {
    value = fmtDuration(durationMinutes)
    label = 'Total time on site'
  } else {
    // Completed with a single photo (no measurable span).
    value = fmtDuration(0)
    label = 'Total time on site'
  }

  return (
    <div style={{
      ...card, padding: '12px 14px', marginBottom: 14,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.textSecondary, fontSize: 13 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
        </svg>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isLive && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: C.emerald,
            animation: 'tospulse 1.6s ease-in-out infinite',
          }} />
        )}
        <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
          {value}
        </span>
      </div>
      <style>{`@keyframes tospulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
    </div>
  )
}

function isStepDone(s) { return DONE_STATUSES.includes((s.status || '').toLowerCase()) }
function isStepCorrections(s) { return (s.status || '').toLowerCase().includes('correction') }

// A step is actionable only if all earlier-order steps are done. Corrections
// steps are always actionable (re-work), regardless of order.
function firstActionableIndex(steps) {
  for (let i = 0; i < steps.length; i++) {
    if (!isStepDone(steps[i])) return i
  }
  return -1
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}
function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export default function WorkOrderDetail({ woId, navigate }) {
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(null)   // step id or action key currently mutating
  const [toast, setToast]     = useState(null)
  const [success, setSuccess] = useState(null)   // success overlay message, or null
  const [unableOpen, setUnableOpen] = useState(false)
  const [naStep, setNaStep] = useState(null)     // step being marked Not Applicable, or null
  const [createOpen, setCreateOpen] = useState(false)
  const [createTypes, setCreateTypes] = useState(null)  // null = loading

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    setError(null)
    try { setDetail(await fetchWorkOrderDetail(woId)) }
    catch (e) { setError(e.message || 'Could not load work order.'); if (!silent) setDetail(null) }
    finally { if (!silent) setLoading(false) }
  }, [woId])

  useEffect(() => { load() }, [load])

  const flash = (msg, tone = 'ok') => {
    setToast({ msg, tone })
    setTimeout(() => setToast(null), 3200)
  }

  if (loading) return <MobileShell title="Work Order" onBack={() => navigate('/field')}><Empty>Loading…</Empty></MobileShell>
  if (error)   return <MobileShell title="Work Order" onBack={() => navigate('/field')}><Empty tone="error">{error}</Empty></MobileShell>
  if (!detail) return null

  const { header, steps } = detail
  const orderedSteps = (steps || []).slice().sort(
    (a, b) => (a.execution_order ?? 1e9) - (b.execution_order ?? 1e9)
  )
  const actionableIdx = firstActionableIndex(orderedSteps)
  const allDone = orderedSteps.length > 0 && actionableIdx === -1
  const woStatus = (header.work_order_status || '').toLowerCase()
  const canSubmit = allDone && (woStatus.includes('in progress') || woStatus.includes('correction'))

  // ── Step handlers ───────────────────────────────────────────────────────
  const handleComplete = async (step) => {
    setBusy(step.work_step_id)
    try {
      await completeWorkStep(step.work_step_id)
      flash(`Step completed: ${step.name}`)
      await load()
    } catch (e) {
      flash(e.message || 'Could not complete step.', 'error')
    } finally { setBusy(null) }
  }

  const handleSubmit = async () => {
    setBusy('submit')
    try {
      await submitWorkOrder(woId)
      await load()
      setSuccess('Submitted for verification')
    } catch (e) {
      flash(e.message || 'Submission failed.', 'error')
    } finally { setBusy(null) }
  }

  const handleMarkNotApplicable = async (reason) => {
    if (!naStep) return
    setBusy(naStep.work_step_id)
    try {
      await markWorkStepNotApplicable(naStep.work_step_id, reason)
      flash(`Step marked Not Applicable: ${naStep.name}`)
      setNaStep(null)
      await load()
    } catch (e) {
      flash(e.message || 'Could not mark step Not Applicable.', 'error')
    } finally { setBusy(null) }
  }

  const handleUnable = async ({ reason, note, photoFile }) => {
    setBusy('unable')
    try {
      // Attach the photo to the work order first (if provided), then mark.
      if (photoFile) {
        await uploadPhoto({
          file: photoFile, relatedObject: 'work_orders', relatedId: woId,
          photoType: 'general', applyWatermark: true,
          caption: 'Unable to Complete evidence',
        })
      }
      await markUnableToComplete(woId, { reason, note })
      setUnableOpen(false)
      await load()
      setSuccess('Reported · sent to coordinator')
    } catch (e) {
      flash(e.message || 'Could not submit.', 'error')
    } finally { setBusy(null) }
  }

  const chip = statusChip(header.work_order_status)

  return (
    <MobileShell
      title={header.work_order_record_number || 'Work Order'}
      onBack={() => navigate('/field')}
    >
      {toast && (
        <div style={{
          position: 'fixed', left: 12, right: 12, bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          zIndex: 50, background: toast.tone === 'error' ? C.danger : C.sidebar,
          color: '#fff', borderRadius: 10, padding: '12px 16px', fontFamily: FONT,
          fontSize: 14, fontWeight: 600, boxShadow: '0 6px 24px rgba(13,26,46,0.28)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header card */}
      <div style={{ ...card, padding: 16, marginBottom: 12 }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 6 }}>
          {header.property_name || header.work_order_name || 'Work Order'}
        </div>
        {header.property_address && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {header.property_address}
          </div>
        )}
        {(header.building || header.unit) && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4, display: 'flex', gap: 14 }}>
            {header.building && <span><strong style={{ color: C.textPrimary }}>Building</strong> {header.building}</span>}
            {header.unit && <span><strong style={{ color: C.textPrimary }}>Unit</strong> {header.unit}</span>}
          </div>
        )}
        {header.work_type_name && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 10 }}>{header.work_type_name}</div>
        )}
        {header.scheduled_start && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {fmtSchedule(header.scheduled_start)}
          </div>
        )}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: chip.bg, color: chip.color, borderRadius: 20,
          padding: '4px 10px', fontSize: 12, fontWeight: 600,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: chip.dot }} />
          {header.work_order_status}
        </span>
      </div>

      {/* Time on site — derived from evidence, bracketed by photos. No manual
          clock. While the work order is still running the total ticks live from
          the first photo to now; once it's submitted/verified it freezes at
          first photo → last photo. */}
      <TimeOnSite
        firstPhotoAt={detail.first_photo_at}
        durationMinutes={detail.duration_minutes}
        running={woStatus.includes('in progress') || woStatus.includes('correction')}
      />

      {/* Steps */}
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 2px 10px' }}>
        Work Steps · complete in order
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orderedSteps.map((step, i) => (
          <StepCard
            key={step.work_step_id}
            step={step}
            woId={woId}
            index={i}
            locked={i > actionableIdx && actionableIdx !== -1 && !isStepCorrections(step)}
            isActionable={(i === actionableIdx || isStepCorrections(step)) && !isStepDone(step)}
            busy={busy === step.work_step_id}
            onComplete={() => handleComplete(step)}
            onMarkNotApplicable={() => setNaStep(step)}
            onPhotoUploaded={async (msg, tone) => { flash(msg, tone); await load() }}
            onPhotoError={(msg) => flash(msg, 'error')}
          />
        ))}
      </div>

      {/* Submit / status-aware action area */}
      <div style={{ marginTop: 16 }}>
        {woStatus.includes('to be verified') ? (
          <div style={{
            ...card, padding: 14, textAlign: 'center',
            background: '#e8f0fb', borderColor: '#bcd4ee',
            color: '#2a5a8a', fontFamily: FONT, fontWeight: 600, fontSize: 14,
          }}>
            Submitted for verification. A coordinator will review this work order.
          </div>
        ) : woStatus.includes('verified') || woStatus.includes('complete') ? (
          <div style={{
            ...card, padding: 14, textAlign: 'center',
            background: '#e8f8f0', borderColor: C.emerald,
            color: '#1a7a4f', fontFamily: FONT, fontWeight: 600, fontSize: 14,
          }}>
            This work order is {header.work_order_status}.
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || busy === 'submit'}
            style={(!canSubmit || busy === 'submit') ? btnDisabled : btnPrimary}
          >
            {busy === 'submit' ? 'Submitting…'
              : allDone ? 'Submit for Verification'
              : `Complete all steps to submit (${orderedSteps.filter(isStepDone).length}/${orderedSteps.length})`}
          </button>
        )}
      </div>

      {/* Create Work Order — field-created records (building access, incident
          reports, ...) on this work order's project/building chain. The type
          list is data-driven: work types flagged technician-creatable. */}
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => {
            setCreateOpen(true)
            if (createTypes === null) {
              fetchTechnicianCreatableWorkTypes().then(setCreateTypes).catch(() => setCreateTypes([]))
            }
          }}
          disabled={busy === 'create'}
          style={{ ...btnSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Create Work Order
        </button>
      </div>

      {createOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,17,31,0.55)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
          <div style={{
            background: C.card, width: '100%', maxWidth: 520,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
            maxHeight: '88dvh', overflowY: 'auto',
          }}>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 4 }}>
              Create Work Order
            </div>
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>
              Created here, on this job’s property and building, assigned to you.
            </div>
            {createTypes === null ? (
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 16 }}>Loading…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {createTypes.filter((t) => t.work_type_name !== header.work_type_name).map((t) => (
                  <button key={t.id} disabled={busy === 'create'}
                    onClick={async () => {
                      setBusy('create')
                      try {
                        const res = await createTechnicianWorkOrder(woId, t.id)
                        setCreateOpen(false)
                        flash(res.message || `${t.work_type_name} created`)
                        navigate(`/field/wo/${res.work_order_id}`)
                      } catch (e) {
                        flash(e.message || 'Could not create the work order.', 'error')
                      } finally { setBusy(null) }
                    }}
                    style={{
                      appearance: 'none', cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${C.borderDark}`, background: C.card,
                      borderRadius: 8, padding: '12px 14px', minHeight: 44,
                    }}>
                    <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                      {t.work_type_name}
                    </span>
                    {t.work_type_description && (
                      <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>
                        {t.work_type_description}
                      </span>
                    )}
                  </button>
                ))}
                {createTypes.filter((t) => t.work_type_name !== header.work_type_name).length === 0 && (
                  <div style={{ fontSize: 14, color: C.textSecondary }}>
                    No field-creatable work order types are configured yet.
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setCreateOpen(false)} disabled={busy === 'create'}
              style={{ ...btnSecondary, width: '100%' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unable to Complete — available whenever the WO is actively In Progress
          (or Corrections). Always reachable so a technician can report a
          blocker at any point. */}
      {(woStatus.includes('in progress') || woStatus.includes('correction')) && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setUnableOpen(true)}
            disabled={busy === 'unable'}
            style={{
              ...btnSecondary, borderColor: C.borderDark, color: C.textSecondary,
            }}
          >
            Unable to Complete
          </button>
        </div>
      )}

      {unableOpen && (
        <UnableModal
          busy={busy === 'unable'}
          onCancel={() => setUnableOpen(false)}
          onSubmit={handleUnable}
        />
      )}

      {naStep && (
        <NotApplicableModal
          stepName={naStep.name}
          busy={busy === naStep.work_step_id}
          onCancel={() => setNaStep(null)}
          onSubmit={handleMarkNotApplicable}
        />
      )}

      {success && (
        <SuccessOverlay message={success} onDone={() => { setSuccess(null); navigate('/field') }} />
      )}
    </MobileShell>
  )
}

// ─── SuccessOverlay ──────────────────────────────────────────────────────────
// Animated checkmark confirmation. Auto-dismisses to the schedule.
function SuccessOverlay({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1900)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div
      onClick={onDone}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(7,17,31,0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 18, padding: 24, textAlign: 'center',
      }}
    >
      <div style={{
        width: 96, height: 96, borderRadius: '50%', background: C.emerald,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'wopop 360ms cubic-bezier(0.16,1,0.3,1)',
        boxShadow: '0 8px 32px rgba(62,207,142,0.5)',
      }}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#062018"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ color: '#fff', fontFamily: FONT, fontWeight: 700, fontSize: 18 }}>{message}</div>
      <style>{`@keyframes wopop{0%{transform:scale(0.3);opacity:0}60%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}`}</style>
    </div>
  )
}

// ─── UnableModal ─────────────────────────────────────────────────────────────
// Reason (required) + optional notes + optional photo, then routes the WO to
// Unable to Complete for the Project Coordinator's workflow.
function UnableModal({ busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const fileRef = useRef(null)

  const reasons = [
    'Site access problem',
    'Missing materials or equipment',
    'Unsafe conditions',
    'Customer not available',
    'Scope mismatch',
    'Other',
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,17,31,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, width: '100%', maxWidth: 520,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
        maxHeight: '88dvh', overflowY: 'auto',
      }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 4 }}>
          Unable to Complete
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>
          This sends the work order back to your coordinator with the reason below.
        </div>

        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 8 }}>
          Reason <span style={{ color: C.danger }}>*</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {reasons.map(r => (
            <button key={r} onClick={() => setReason(r)}
              style={{
                appearance: 'none', cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${reason === r ? C.emerald : C.borderDark}`,
                background: reason === r ? '#e8f8f0' : C.card,
                color: C.textPrimary, fontFamily: FONT, fontSize: 14, fontWeight: 600,
                borderRadius: 8, padding: '12px 14px', minHeight: 44,
              }}>
              {r}
            </button>
          ))}
        </div>

        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 8 }}>
          Notes
        </div>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Add any detail the coordinator needs…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 14,
            border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: 12,
            marginBottom: 16, resize: 'vertical', color: C.textPrimary,
          }}
        />

        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value=''; if (f) setPhotoFile(f) }}
          style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()}
          style={{
            ...btnSecondary, marginBottom: 16,
            borderColor: photoFile ? C.emerald : C.borderDark,
            color: photoFile ? C.emeraldMid : C.textPrimary,
          }}>
          {photoFile ? 'Photo attached ✓ — tap to replace' : 'Add a photo (optional)'}
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy}
            style={{ ...btnSecondary, flex: 1 }}>
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ reason, note, photoFile })}
            disabled={busy || !reason}
            style={(busy || !reason)
              ? { ...btnDisabled, flex: 1 }
              : { ...btnPrimary, flex: 1, background: C.sidebar, color: '#fff' }}>
            {busy ? 'Submitting…' : 'Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── StepCard ────────────────────────────────────────────────────────────────
function StepCard({ step, woId, index, locked, isActionable, busy, onComplete, onMarkNotApplicable, onPhotoUploaded, onPhotoError }) {
  const fileRef  = useRef(null)
  const videoRef = useRef(null)
  const legRef   = useRef('general')  // synchronous — no state race with the picker
  const [uploading, setUploading] = useState(false)

  const done = isStepDone(step)
  const corrections = isStepCorrections(step)
  const gap = step.evidence_gap // null when satisfied
  const chip = statusChip(step.status)

  const needsBefore = step.photo_before_required
  const needsAfter  = step.photo_after_required
  const reqCount    = step.photos_required_count || 0
  const isVideoStep = step.evidence_type === 'Video'
  const videoCount  = step.video_count || 0
  const notApplicable = (step.status || '').toLowerCase() === 'not applicable'

  // Open the picker SYNCHRONOUSLY inside the tap handler. Mobile browsers
  // (iOS Safari, Android Chrome) only honor a programmatic file-input click
  // while still inside the user-gesture call stack — a setTimeout defer
  // silently no-ops, which is why the camera never opened. The leg is stored
  // in a ref (not state) so onFile reads the correct value without waiting
  // for a re-render.
  const triggerCapture = (leg) => {
    legRef.current = leg
    if (fileRef.current) fileRef.current.click()
  }

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    const leg = legRef.current
    setUploading(true)
    try {
      const row = await captureStepPhoto({ file, workStepId: step.work_step_id, photoType: leg })
      // Screen updates immediately — the photo is saved and counts. The GPS
      // check rides the server's EXIF processing (a few seconds) and warns
      // AFTER the fact, so capture never feels slow.
      onPhotoUploaded(`Photo captured (${leg}) · ${step.name}`)
      photoGpsMissing(row).then((missing) => {
        if (missing) {
          onPhotoError('Photo saved, but it has NO location data. Turn on Location Services for your camera, then retake this photo.')
        }
      })
    } catch (err) {
      onPhotoError(err.message || 'Photo upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const onVideoFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setUploading(true)
    try {
      await captureStepVideo({ file, workStepId: step.work_step_id, stepName: step.name })
      onPhotoUploaded(`Video attached · ${step.name}`)
    } catch (err) {
      onPhotoError(err.message || 'Video upload failed.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      ...card, padding: 14,
      opacity: locked ? 0.55 : 1,
      borderColor: corrections ? C.danger : (isActionable ? C.emerald : C.border),
      borderWidth: (corrections || isActionable) ? 1.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: done ? C.emerald : (corrections ? C.danger : C.page),
          color: done || corrections ? '#fff' : C.textSecondary,
          fontFamily: MONO, fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {done ? <CheckIcon /> : (step.execution_order ?? index + 1)}
        </span>
        <span style={{ flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 15, color: C.textPrimary }}>
          {step.name}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: chip.bg, color: chip.color, borderRadius: 20,
          padding: '3px 9px', fontSize: 11, fontWeight: 600, flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: chip.dot }} />
          {step.status}
        </span>
      </div>

      {step.description && (
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 8, lineHeight: 1.45 }}>
          {step.description}
        </div>
      )}

      {/* Captured photos — always viewable, even after the step is completed. */}
      {Array.isArray(step.photos) && step.photos.length > 0 && (
        <PhotoStrip photos={step.photos} />
      )}

      {/* Attached videos — playable inline, including on completed steps. */}
      {Array.isArray(step.videos) && step.videos.length > 0 && (
        <VideoStrip videos={step.videos} />
      )}

      {/* Measurement / field values. Editable on the actionable step; saved
          values shown read-only once the step is closed. */}
      {Array.isArray(step.fields) && step.fields.length > 0 && (
        done || !isActionable ? (
          <div style={{ marginBottom: 8 }}>
            {step.fields.map((f) => {
              const val = f.numeric_value ?? f.text_value
              return (
                <div key={f.field_id} style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
                  <strong style={{ color: C.textPrimary }}>{f.label}:</strong>{' '}
                  {val != null && val !== ''
                    ? <span style={{ fontFamily: MONO }}>{val}{f.unit ? ` ${f.unit}` : ''}</span>
                    : <span style={{ color: C.textMuted }}>not entered</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            {step.fields.map((f) => f.type === 'user_multiselect' ? (
              <StepUserMultiselect
                key={f.field_id}
                field={f}
                stepId={step.work_step_id}
                disabled={busy || uploading}
                onSaved={onPhotoUploaded}
                onError={onPhotoError}
              />
            ) : f.type === 'key_source' ? (
              <StepKeySource
                key={f.field_id}
                field={f}
                stepId={step.work_step_id}
                woId={woId}
                disabled={busy || uploading}
                onSaved={onPhotoUploaded}
                onError={onPhotoError}
              />
            ) : f.type === 'select' ? (
              <StepSelectField
                key={f.field_id}
                field={f}
                stepId={step.work_step_id}
                disabled={busy || uploading}
                onSaved={onPhotoUploaded}
                onError={onPhotoError}
              />
            ) : (
              <StepFieldInput
                key={f.field_id}
                field={f}
                stepId={step.work_step_id}
                disabled={busy || uploading}
                onSaved={onPhotoUploaded}
                onError={onPhotoError}
              />
            ))}
          </div>
        )
      )}

      {/* Not Applicable reason — the documented why, visible to everyone. */}
      {notApplicable && step.not_applicable_reason && (
        <div style={{
          background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '8px 10px', marginBottom: 8, fontSize: 12.5, color: C.textSecondary,
        }}>
          <strong>Not Applicable:</strong> {step.not_applicable_reason}
        </div>
      )}

      {/* Corrections comment */}
      {corrections && (step.pc_comment || step.psl_comment) && (
        <div style={{
          background: '#e8f0fb', border: `1px solid #bcd4ee`, borderRadius: 8,
          padding: '8px 10px', marginBottom: 8, fontSize: 12.5, color: '#2a5a8a',
        }}>
          <strong>Corrections:</strong> {step.pc_comment || step.psl_comment}
        </div>
      )}

      {/* Evidence requirements summary */}
      {!done && (reqCount > 0 || needsBefore || needsAfter || isVideoStep || step.evidence_type === 'Document Upload') && (
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
          {reqCount > 0 && <span>Photos: {step.photo_count}/{reqCount}  </span>}
          {needsBefore && <span style={{ color: step.before_count > 0 ? C.emeraldMid : C.amber }}>Before {step.before_count > 0 ? '✓' : '—'}  </span>}
          {needsAfter && <span style={{ color: step.after_count > 0 ? C.emeraldMid : C.amber }}>After {step.after_count > 0 ? '✓' : '—'}</span>}
          {isVideoStep && <span style={{ color: videoCount > 0 ? C.emeraldMid : C.amber }}>Video {videoCount > 0 ? '✓' : 'required'}</span>}
          {step.evidence_type === 'Document Upload' && <span>Document upload required</span>}
        </div>
      )}

      {/* Capture + complete actions — only on the actionable step */}
      {isActionable && (
        <>
          <input
            ref={fileRef} type="file" accept="image/*" capture="environment"
            onChange={onFile} style={{ display: 'none' }}
          />
          <input
            ref={videoRef} type="file" accept="video/*" capture="environment"
            onChange={onVideoFile} style={{ display: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: gap ? 8 : 0, flexWrap: 'wrap' }}>
            {isVideoStep ? (
              <CaptureBtn label="Record Video" icon="video" onClick={() => videoRef.current?.click()} disabled={uploading || busy} done={videoCount > 0} />
            ) : (
              <>
                {needsBefore && (
                  <CaptureBtn label="Before" onClick={() => triggerCapture('before')} disabled={uploading || busy} done={step.before_count > 0} />
                )}
                {needsAfter && (
                  <CaptureBtn label="After" onClick={() => triggerCapture('after')} disabled={uploading || busy} done={step.after_count > 0} />
                )}
                {/* General capture when the step needs a count but no specific leg,
                    or to add beyond before/after toward the required count. */}
                {(reqCount > 0 || (!needsBefore && !needsAfter)) && (
                  <CaptureBtn label="Photo" onClick={() => triggerCapture('general')} disabled={uploading || busy} />
                )}
              </>
            )}
          </div>

          {uploading && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>{isVideoStep ? 'Uploading video…' : 'Uploading photo…'}</div>}

          <button
            onClick={onComplete}
            disabled={!!gap || busy || uploading}
            style={(gap || busy || uploading) ? btnDisabled : { ...btnPrimary, minHeight: 46 }}
            title={gap || undefined}
          >
            {busy ? 'Completing…' : 'Complete Step'}
          </button>

          {gap && (
            <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>{gap}</div>
          )}

          {/* Escape hatch for steps that don't exist on this site (e.g. no can
              lights in the attic). Requires a reason; the verifier sees it. */}
          <button
            onClick={onMarkNotApplicable}
            disabled={busy || uploading}
            style={{
              appearance: 'none', background: 'none', border: 'none', cursor: 'pointer',
              display: 'block', margin: '10px auto 0', padding: 6,
              fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textMuted,
              textDecoration: 'underline',
            }}
          >
            This step doesn’t apply here — mark Not Applicable
          </button>
        </>
      )}

      {locked && (
        <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
          Complete the previous step first.
        </div>
      )}
    </div>
  )
}

// ─── StepKeySource ───────────────────────────────────────────────────────────
// The 'key_source' field type (Checked Out From / Returned To on key custody
// steps). Keys come from a lockbox OR from a person — a contact on the work
// order's account (property manager etc.), with a free-text fallback for
// someone not yet in CRM. Stored as readable text: "Lockbox" or
// "Person: <name>".
function StepKeySource({ field, stepId, woId, disabled, onSaved, onError }) {
  const saved = field.text_value || ''
  const savedIsPerson = saved.startsWith('Person: ')
  const [mode, setMode] = useState(saved ? (savedIsPerson ? 'person' : 'lockbox') : null)
  const [person, setPerson] = useState(savedIsPerson ? saved.slice(8) : '')
  const [otherName, setOtherName] = useState('')
  const [contacts, setContacts] = useState(null)  // null = loading
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAccountContactsForWorkOrder(woId)
      .then((rows) => { if (!cancelled) setContacts(rows) })
      .catch(() => { if (!cancelled) setContacts([]) })
    return () => { cancelled = true }
  }, [woId])

  const effectivePerson = person === '__other__' ? otherName.trim() : person
  const currentValue = mode === 'lockbox' ? 'Lockbox'
    : mode === 'person' && effectivePerson ? `Person: ${effectivePerson}` : ''
  const dirty = currentValue !== '' && currentValue !== saved

  const save = async () => {
    if (!currentValue) {
      onError(mode === 'person'
        ? `Select or enter who the keys came from for "${field.label}".`
        : `Choose Lockbox or Person for "${field.label}".`)
      return
    }
    setSaving(true)
    try {
      const res = await saveWorkStepFieldValue(stepId, field.field_id, currentValue)
      onSaved(res.message || `${field.label} saved`)
    } catch (e) {
      onError(e.message || 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  const chip = (key, label) => (
    <button key={key} onClick={() => setMode(key)} disabled={disabled || saving}
      style={{
        appearance: 'none', cursor: 'pointer', flex: 1,
        border: `1px solid ${mode === key ? C.emerald : C.borderDark}`,
        background: mode === key ? '#e8f8f0' : C.card,
        color: C.textPrimary, fontFamily: FONT, fontSize: 14, fontWeight: 600,
        borderRadius: 8, padding: '10px 12px', minHeight: 44,
      }}>
      {label}
    </button>
  )

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
        {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
        {saved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ {saved}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {chip('lockbox', 'Lockbox')}
        {chip('person', 'Person')}
      </div>

      {mode === 'person' && (
        contacts === null ? (
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 8 }}>Loading contacts…</div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              disabled={disabled || saving}
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 44,
                fontFamily: FONT, fontSize: 15, color: C.textPrimary,
                border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
                background: C.card, marginBottom: person === '__other__' ? 8 : 0,
              }}>
              <option value="">Who provided the keys?</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.contact_name}>{c.contact_name}</option>
              ))}
              <option value="__other__">Someone else (type name)</option>
            </select>
            {person === '__other__' && (
              <input
                type="text" value={otherName} onChange={(e) => setOtherName(e.target.value)}
                placeholder="Full name"
                disabled={disabled || saving}
                style={{
                  width: '100%', boxSizing: 'border-box', minHeight: 44,
                  fontFamily: FONT, fontSize: 15, color: C.textPrimary,
                  border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
                }}
              />
            )}
          </div>
        )
      )}

      <button
        onClick={save}
        disabled={disabled || saving || !dirty}
        style={(disabled || saving || !dirty)
          ? { ...btnDisabled, minHeight: 44 }
          : { ...btnPrimary, minHeight: 44 }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ─── StepUserMultiselect ─────────────────────────────────────────────────────
// The 'user_multiselect' field type (e.g. "Technicians On-Site" on building
// access steps): a checkbox list of active users, saved as comma-separated
// names so the value reads plainly everywhere (step card, desktop record,
// verifier view).
function StepUserMultiselect({ field, stepId, disabled, onSaved, onError }) {
  const savedNames = (field.text_value || '').split(',').map((s) => s.trim()).filter(Boolean)
  const [users, setUsers] = useState(null)   // null = loading
  const [selected, setSelected] = useState(new Set(savedNames))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchActiveUsers()
      .then((rows) => { if (!cancelled) setUsers(rows) })
      .catch(() => { if (!cancelled) setUsers([]) })
    return () => { cancelled = true }
  }, [])

  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  const currentValue = Array.from(selected).sort().join(', ')
  const dirty = currentValue !== savedNames.slice().sort().join(', ')

  const save = async () => {
    if (selected.size === 0) { onError(`Select at least one person for "${field.label}".`); return }
    setSaving(true)
    try {
      const res = await saveWorkStepFieldValue(stepId, field.field_id, currentValue)
      onSaved(res.message || `${field.label} saved`)
    } catch (e) {
      onError(e.message || 'Could not save the selection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
        {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
        {savedNames.length > 0 && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
      </div>
      {users === null ? (
        <div style={{ fontSize: 13, color: C.textMuted }}>Loading people…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {users.map((u) => {
            const on = selected.has(u.user_name)
            return (
              <button key={u.id} onClick={() => toggle(u.user_name)} disabled={disabled || saving}
                style={{
                  appearance: 'none', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: `1px solid ${on ? C.emerald : C.borderDark}`,
                  background: on ? '#e8f8f0' : C.card,
                  color: C.textPrimary, fontFamily: FONT, fontSize: 14, fontWeight: 600,
                  borderRadius: 8, padding: '10px 12px', minHeight: 44,
                }}>
                <span style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  border: `2px solid ${on ? C.emerald : C.borderDark}`,
                  background: on ? C.emerald : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff"
                      strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                {u.user_name}
              </button>
            )
          })}
        </div>
      )}
      <button
        onClick={save}
        disabled={disabled || saving || !dirty}
        style={(disabled || saving || !dirty)
          ? { ...btnDisabled, minHeight: 44 }
          : { ...btnPrimary, minHeight: 44 }}
      >
        {saving ? 'Saving…' : `Save (${selected.size} selected)`}
      </button>
    </div>
  )
}

// ─── StepFieldInput ──────────────────────────────────────────────────────────
// One measurement/field entry on the actionable step (e.g. "Square Feet
// Removed by 10:00 AM"). Saves via save_work_step_field_value; required
// fields hard-gate step completion server-side, so onSaved reloads the
// detail to refresh the gap state and enable Complete Step.
// The 'select' field type (e.g. "Material Delivered" on Material Delivery).
// Options are admin-managed picklist values under picklist_object
// 'work_step_fields', picklist_field = the field's name — the server rejects
// anything outside the list, so this stays a pure dropdown with no free text.
function StepSelectField({ field, stepId, disabled, onSaved, onError }) {
  const savedVal = field.text_value ?? ''
  const [value, setValue] = useState(String(savedVal))
  const [options, setOptions] = useState(null)
  const [saving, setSaving] = useState(false)
  const dirty = value !== String(savedVal)
  const hasSaved = savedVal !== '' && savedVal != null

  useEffect(() => {
    let cancelled = false
    supabase
      .from('picklist_values')
      .select('picklist_value, picklist_label, picklist_sort_order')
      .eq('picklist_object', 'work_step_fields')
      .eq('picklist_field', field.name)
      .eq('picklist_is_active', true)
      .order('picklist_sort_order', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setOptions([]); onError(`Could not load options for "${field.label}".`) }
        else setOptions(data || [])
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.name])

  const save = async () => {
    if (!value) { onError(`Pick a value for "${field.label}".`); return }
    setSaving(true)
    try {
      const res = await saveWorkStepFieldValue(stepId, field.field_id, value)
      onSaved(res.message || `${field.label} saved`)
    } catch (e) {
      onError(e.message || 'Could not save the value.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
        {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
        {hasSaved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || saving || options === null}
          style={{
            flex: 1, boxSizing: 'border-box', minHeight: 44,
            fontFamily: FONT, fontSize: 16,
            border: `1px solid ${hasSaved && !dirty ? C.emerald : C.borderDark}`,
            borderRadius: 8, padding: '10px 12px',
            color: value ? C.textPrimary : C.textMuted, background: C.card,
          }}
        >
          <option value="">{options === null ? 'Loading…' : `Select ${field.label}…`}</option>
          {(options || []).map((o) => (
            <option key={o.picklist_value} value={o.picklist_value}>{o.picklist_label || o.picklist_value}</option>
          ))}
        </select>
        <button
          onClick={save}
          disabled={disabled || saving || !dirty || !value}
          style={(disabled || saving || !dirty || !value)
            ? { ...btnDisabled, flex: '0 0 auto', minHeight: 44, padding: '0 18px' }
            : { ...btnPrimary, flex: '0 0 auto', minHeight: 44, padding: '0 18px' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function StepFieldInput({ field, stepId, disabled, onSaved, onError }) {
  const savedVal = field.numeric_value ?? field.text_value ?? ''
  const [value, setValue] = useState(String(savedVal))
  const [saving, setSaving] = useState(false)
  const isNumber = field.type === 'number'
  const dirty = value.trim() !== String(savedVal).trim()
  const hasSaved = savedVal !== '' && savedVal != null

  const save = async () => {
    if (!value.trim()) { onError(`Enter a value for "${field.label}".`); return }
    setSaving(true)
    try {
      const res = await saveWorkStepFieldValue(stepId, field.field_id, value.trim())
      onSaved(res.message || `${field.label} saved`)
    } catch (e) {
      onError(e.message || 'Could not save the value.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
        {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
        {hasSaved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            inputMode={isNumber ? 'decimal' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isNumber ? '0' : ''}
            disabled={disabled || saving}
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 44,
              fontFamily: isNumber ? MONO : FONT, fontSize: 16,
              border: `1px solid ${hasSaved && !dirty ? C.emerald : C.borderDark}`,
              borderRadius: 8, padding: field.unit ? '10px 64px 10px 12px' : '10px 12px',
              color: C.textPrimary,
            }}
          />
          {field.unit && (
            <span style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: C.textMuted, pointerEvents: 'none',
            }}>
              {field.unit}
            </span>
          )}
        </div>
        <button
          onClick={save}
          disabled={disabled || saving || !dirty}
          style={(disabled || saving || !dirty)
            ? { ...btnDisabled, flex: '0 0 auto', minHeight: 44, padding: '0 18px' }
            : { ...btnPrimary, flex: '0 0 auto', minHeight: 44, padding: '0 18px' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function CaptureBtn({ label, icon = 'camera', onClick, disabled, done }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: done ? '#e8f8f0' : C.cardSecondary,
        color: done ? C.emeraldMid : C.textPrimary,
        border: `1px solid ${done ? C.emerald : C.borderDark}`,
        borderRadius: 8, padding: '10px 14px', fontFamily: FONT,
        fontWeight: 600, fontSize: 14, minHeight: 44, flex: '1 1 auto',
        justifyContent: 'center',
      }}
    >
      {icon === 'video' ? <VideoIcon /> : <CameraIcon />} {label}{done ? ' ✓' : ''}
    </button>
  )
}

// ─── VideoStrip ──────────────────────────────────────────────────────────────
// Renders a step's attached evidence videos (private work-evidence bucket →
// short-lived signed URLs) as inline players. Always shown, including on
// completed steps, so the technician can review what they recorded.
function VideoStrip({ videos }) {
  const [urls, setUrls] = useState({}) // video.id -> signedUrl

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        videos.map(async (v) => [v.id, await signedPhotoUrl(v.bucket, v.path)])
      )
      if (!cancelled) setUrls(Object.fromEntries(entries.filter(([, u]) => u)))
    })()
    return () => { cancelled = true }
  }, [videos])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
      {videos.map((v) => {
        const url = urls[v.id]
        return url ? (
          <video
            key={v.id} src={url} controls preload="metadata" playsInline
            style={{
              width: '100%', maxHeight: 220, borderRadius: 8,
              border: `1px solid ${C.border}`, background: '#07111f',
            }}
          />
        ) : (
          <div key={v.id} style={{
            fontSize: 12, color: C.textMuted, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '10px 12px', background: C.cardSecondary,
          }}>
            Loading video…
          </div>
        )
      })}
    </div>
  )
}

// ─── NotApplicableModal ──────────────────────────────────────────────────────
// Closes a step that doesn't exist on this site (e.g. "photograph can lights"
// in an attic with none). The reason is required — the server refuses without
// one — and it shows on the step for the verifier.
function NotApplicableModal({ stepName, busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState('')
  const canSubmit = reason.trim().length > 0 && !busy

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,17,31,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, width: '100%', maxWidth: 520,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
        maxHeight: '88dvh', overflowY: 'auto',
      }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 4 }}>
          Mark Not Applicable
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>
          {stepName}
        </div>

        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 8 }}>
          Why doesn’t this step apply? <span style={{ color: C.danger }}>*</span>
        </div>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder='e.g. "No can lights present in the attic"'
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', fontFamily: FONT, fontSize: 14,
            border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: 12,
            marginBottom: 16, resize: 'vertical', color: C.textPrimary,
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} disabled={busy}
            style={{ ...btnSecondary, flex: 1 }}>
            Cancel
          </button>
          <button
            onClick={() => onSubmit(reason.trim())}
            disabled={!canSubmit}
            style={!canSubmit
              ? { ...btnDisabled, flex: 1 }
              : { ...btnPrimary, flex: 1, background: C.sidebar, color: '#fff' }}>
            {busy ? 'Saving…' : 'Mark Not Applicable'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PhotoStrip ──────────────────────────────────────────────────────────────
// Renders thumbnails for a step's captured photos (private work-evidence
// bucket → short-lived signed URLs). Always shown, including on completed
// steps, so the technician can review what they captured. Tap to view full.
function PhotoStrip({ photos }) {
  const [urls, setUrls] = useState({})   // photo.id -> signedUrl
  const [zoom, setZoom] = useState(null) // signedUrl being viewed full-screen

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        photos.map(async (p) => [p.id, await signedPhotoUrl(p.bucket, p.path)])
      )
      if (!cancelled) setUrls(Object.fromEntries(entries.filter(([, u]) => u)))
    })()
    return () => { cancelled = true }
  }, [photos])

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      {photos.map((p) => {
        const url = urls[p.id]
        const legColor = (p.photo_type || '').toLowerCase() === 'before' ? C.sky
          : (p.photo_type || '').toLowerCase() === 'after' ? C.emeraldMid : C.textMuted
        return (
          <div key={p.id} style={{ width: 72 }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => url && setZoom(url)}
                style={{
                  width: 72, height: 72, borderRadius: 8, overflow: 'hidden',
                  border: `1px solid ${C.border}`, padding: 0, cursor: url ? 'pointer' : 'default',
                  background: C.cardSecondary, display: 'block',
                }}
              >
                {url
                  ? <img src={url} alt={p.photo_type || 'photo'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 10, color: C.textMuted }}>…</span>}
              </button>
              {p.photo_type && p.photo_type.toLowerCase() !== 'general' && (
                <span style={{
                  position: 'absolute', bottom: 3, left: 3,
                  background: legColor, color: '#fff', fontSize: 9, fontWeight: 700,
                  borderRadius: 4, padding: '1px 4px', textTransform: 'capitalize',
                }}>
                  {p.photo_type}
                </span>
              )}
            </div>
            {/* When each photo was taken (from EXIF). Blank until the server
                finishes processing; a dash means no timestamp was embedded. */}
            <div style={{
              fontFamily: MONO, fontSize: 10, color: p.taken_at ? C.textSecondary : C.textMuted,
              textAlign: 'center', marginTop: 3, lineHeight: 1.2,
            }}>
              {p.taken_at ? fmtPhotoTime(p.taken_at) : '—'}
            </div>
          </div>
        )
      })}

      {zoom && (
        <div
          onClick={() => setZoom(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,17,31,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
    </div>
  )
}

function Empty({ children, tone }) {
  return (
    <div style={{
      ...card, padding: 24, textAlign: 'center',
      color: tone === 'error' ? C.danger : C.textMuted, fontFamily: FONT, fontSize: 14,
    }}>
      {children}
    </div>
  )
}
