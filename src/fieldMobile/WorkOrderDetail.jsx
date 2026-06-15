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
  clockIn, clockOut, captureStepPhoto,
} from './fieldMobileService'
import { C, FONT, MONO, card, btnPrimary, btnSecondary, btnDisabled, statusChip } from './styles'

const DONE_STATUSES = ['completed', 'verified', 'not applicable']
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

  const { header, steps, open_clock_session } = detail
  const orderedSteps = (steps || []).slice().sort(
    (a, b) => (a.execution_order ?? 1e9) - (b.execution_order ?? 1e9)
  )
  const actionableIdx = firstActionableIndex(orderedSteps)
  const allDone = orderedSteps.length > 0 && actionableIdx === -1
  const woStatus = (header.work_order_status || '').toLowerCase()
  const canSubmit = allDone && (woStatus.includes('in progress') || woStatus.includes('correction'))
  const isClockedIn = !!open_clock_session

  // ── Clock handlers ──────────────────────────────────────────────────────
  // Time + GPS only. Odometer is vehicle/driver accountability and belongs to
  // the Fleet vehicle check-out/check-in flow for the responsible driver, not
  // to a technician's per-job clock action.
  const handleClockIn = async () => {
    setBusy('clock')
    try { await clockIn(woId); flash('Clocked in.'); await load({ silent: true }) }
    catch (e) { flash(e.message || 'Clock in failed.', 'error') }
    finally { setBusy(null) }
  }
  const handleClockOut = async () => {
    setBusy('clock')
    try { const r = await clockOut(woId); flash(`Clocked out · ${Math.round(r.wte_duration_minutes||0)} min.`); await load({ silent: true }) }
    catch (e) { flash(e.message || 'Clock out failed.', 'error') }
    finally { setBusy(null) }
  }

  // ── Step handlers ───────────────────────────────────────────────────────
  const handleComplete = async (step) => {
    setBusy(step.work_step_id)
    try {
      await completeWorkStep(step.work_step_id)
      flash(`Step completed: ${step.name}`)
      await load({ silent: true })
    } catch (e) {
      flash(e.message || 'Could not complete step.', 'error')
    } finally { setBusy(null) }
  }

  const handleSubmit = async () => {
    setBusy('submit')
    try {
      await submitWorkOrder(woId)
      flash('Submitted for verification.')
      await load({ silent: true })
    } catch (e) {
      flash(e.message || 'Submission failed.', 'error')
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
        {(header.building_address || header.unit) && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
            {header.building_address}{header.unit ? ` · Unit ${header.unit}` : ''}
          </div>
        )}
        {header.work_type_name && (
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 10 }}>{header.work_type_name}</div>
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

      {/* Clock in/out */}
      <div style={{ marginBottom: 14 }}>
        {isClockedIn ? (
          <button onClick={handleClockOut} disabled={busy === 'clock'}
            style={busy === 'clock' ? btnDisabled : { ...btnSecondary, borderColor: C.amber, color: '#8a5a0a' }}>
            {busy === 'clock' ? 'Working…' : 'Clock Out'}
          </button>
        ) : (
          <button onClick={handleClockIn} disabled={busy === 'clock'}
            style={busy === 'clock' ? btnDisabled : btnSecondary}>
            {busy === 'clock' ? 'Working…' : 'Clock In'}
          </button>
        )}
        {isClockedIn && (
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6, textAlign: 'center' }}>
            Clocked in · session {open_clock_session.wte_record_number}
          </div>
        )}
      </div>

      {/* Steps */}
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 2px 10px' }}>
        Work Steps · complete in order
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orderedSteps.map((step, i) => (
          <StepCard
            key={step.work_step_id}
            step={step}
            index={i}
            locked={i > actionableIdx && actionableIdx !== -1 && !isStepCorrections(step)}
            isActionable={(i === actionableIdx || isStepCorrections(step)) && !isStepDone(step)}
            busy={busy === step.work_step_id}
            onComplete={() => handleComplete(step)}
            onPhotoUploaded={async (msg) => { flash(msg); await load({ silent: true }) }}
            onPhotoError={(msg) => flash(msg, 'error')}
          />
        ))}
      </div>

      {/* Submit */}
      <div style={{ marginTop: 16 }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || busy === 'submit'}
          style={(!canSubmit || busy === 'submit') ? btnDisabled : btnPrimary}
        >
          {busy === 'submit' ? 'Submitting…'
            : allDone ? 'Submit for Verification'
            : `Complete all steps to submit (${orderedSteps.filter(isStepDone).length}/${orderedSteps.length})`}
        </button>
      </div>
    </MobileShell>
  )
}

// ─── StepCard ────────────────────────────────────────────────────────────────
function StepCard({ step, index, locked, isActionable, busy, onComplete, onPhotoUploaded, onPhotoError }) {
  const fileRef = useRef(null)
  const legRef  = useRef('general')   // synchronous — no state race with the picker
  const [uploading, setUploading] = useState(false)

  const done = isStepDone(step)
  const corrections = isStepCorrections(step)
  const gap = step.evidence_gap // null when satisfied
  const chip = statusChip(step.status)

  const needsBefore = step.photo_before_required
  const needsAfter  = step.photo_after_required
  const reqCount    = step.photos_required_count || 0

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
      await captureStepPhoto({ file, workStepId: step.work_step_id, photoType: leg })
      onPhotoUploaded(`Photo captured (${leg}) · ${step.name}`)
    } catch (err) {
      onPhotoError(err.message || 'Photo upload failed.')
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

      {/* Corrections comment */}
      {corrections && (step.pc_comment || step.psl_comment) && (
        <div style={{
          background: '#fdecec', border: `1px solid #f5c6c6`, borderRadius: 8,
          padding: '8px 10px', marginBottom: 8, fontSize: 12.5, color: '#a3342f',
        }}>
          <strong>Corrections:</strong> {step.pc_comment || step.psl_comment}
        </div>
      )}

      {/* Evidence requirements summary */}
      {!done && (reqCount > 0 || needsBefore || needsAfter || step.evidence_type === 'Document Upload') && (
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
          {reqCount > 0 && <span>Photos: {step.photo_count}/{reqCount}  </span>}
          {needsBefore && <span style={{ color: step.before_count > 0 ? C.emeraldMid : C.amber }}>Before {step.before_count > 0 ? '✓' : '—'}  </span>}
          {needsAfter && <span style={{ color: step.after_count > 0 ? C.emeraldMid : C.amber }}>After {step.after_count > 0 ? '✓' : '—'}</span>}
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
          <div style={{ display: 'flex', gap: 8, marginBottom: gap ? 8 : 0, flexWrap: 'wrap' }}>
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
          </div>

          {uploading && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>Uploading photo…</div>}

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

function CaptureBtn({ label, onClick, disabled, done }) {
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
      <CameraIcon /> {label}{done ? ' ✓' : ''}
    </button>
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
