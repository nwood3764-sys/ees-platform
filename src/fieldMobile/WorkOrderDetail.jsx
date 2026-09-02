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
  fetchActiveUsers, fetchAccountContactsForWorkOrder, fetchVehiclesForInspection,
  saveWorkStepVehicle,
} from './fieldMobileService'
import { uploadPhoto, setPhotoReportInclusion } from '../data/storageService'
import {
  imageFilesFromInputEvent,
  fileFromInputEvent,
  imageFilesFromDrop,
  dragCarriesFiles,
  uploadProgressLabel,
  uploadResultLabel,
} from '../lib/photoDrop'
import { photoTagLabel, isMeaningfulTag } from '../lib/photoTags'
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

// Format a photo's capture time (EXIF taken_at) as e.g. "9:14 AM" — shown
// under each work-step photo thumbnail.
//
// IMPORTANT — timezone: photos.taken_at holds the camera's LOCAL wall-clock
// time, not a true UTC instant. exifr parses EXIF DateTimeOriginal ("9:44:51")
// without applying OffsetTimeOriginal, so the local wall clock is stored
// labelled UTC (e.g. 09:44:51Z for a 9:44 AM Central capture). Formatting in
// UTC therefore reproduces exactly the time the technician's phone showed —
// correct in every state EES works in (WI/NC/CO/MI/IN), because it echoes the
// device clock rather than shifting it. This mirrors the burned-in watermark,
// which also renders taken_at in UTC. (If the photo pipeline is ever changed
// to store a true UTC instant, this formatter must switch to the site's local
// timezone.)
function fmtPhotoTime(iso) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
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
function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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

// Small forward chevron marking a review row as tappable (jumps back to edit).
function ReviewChevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textMuted}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// `embedded` renders the same work plan inside the main app's work order record
// page instead of the field PWA's own screen: no mobile topbar, no back chevron,
// and completing the plan refreshes in place rather than navigating to /field.
// Everything else — the steps, evidence gates, photo/video capture, measurement
// fields, N/A reasons, submit — is the identical component, so desk staff and
// technicians run one code path (Nicholas, 2026-08-16: "they should never leave
// the main app").
export default function WorkOrderDetail({ woId, navigate, embedded = false, onChanged = null }) {
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(null)   // step id or action key currently mutating
  const [toast, setToast]     = useState(null)
  const [success, setSuccess] = useState(null)   // success overlay message, or null
  const [unableOpen, setUnableOpen] = useState(false)
  const [naStep, setNaStep] = useState(null)     // step being marked Not Applicable, or null
  const [flowStep, setFlowStep] = useState(null)        // screen-flow step being run, or null

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

  // Shell is declared at MODULE level, not here. A component defined inside a
  // render is a NEW type on every render, so React unmounts and rebuilds its
  // whole subtree each time any state changes — and this screen changes state
  // constantly (a toast, a busy flag, a completed step). That took the hidden
  // <input type="file"> out of the document while a picker was open, so the
  // technician's chosen photo fired `change` at an element React was no longer
  // listening to: another way for a capture to vanish with no error, on the
  // same screen. It also reset each StepCard's in-flight upload progress
  // mid-batch, which is the spinner that "gets stuck and nothing happens".
  const shell = (title, body) => (
    <WorkOrderShell embedded={embedded} title={title} navigate={navigate}>{body}</WorkOrderShell>
  )

  if (loading) return shell('Work Order', <Empty>Loading…</Empty>)
  if (error)   return shell('Work Order', <Empty tone="error">{error}</Empty>)
  if (!detail) return null

  const { header, steps } = detail
  const orderedSteps = (steps || []).slice().sort(
    (a, b) => (a.execution_order ?? 1e9) - (b.execution_order ?? 1e9)
  )
  const actionableIdx = firstActionableIndex(orderedSteps)
  const allDone = orderedSteps.length > 0 && actionableIdx === -1
  const woStatus = (header.work_order_status || '').toLowerCase()
  const canSubmit = allDone && (woStatus.includes('in progress') || woStatus.includes('correction'))
  // Some work plans (e.g. the Single-Family Energy Assessment) let sections be
  // completed in any order — the auditor walks the house non-linearly. Order was
  // never enforced server-side, so this only relaxes the client's step locking.
  const anyOrder = !!header.allow_any_order
  // In any-order mode EVERY section is open from the start. An assessor walks a
  // building the way the building lets them — the roof hatch is open now, the
  // boiler room is locked until the super arrives — so ordering the sections
  // costs real time and captures nothing extra (Nicholas, 2026-08-22: "they
  // don't have to go in order... the user should be able to go to each
  // section"). The first step used to gate the rest, which on a 15-section
  // assessment meant 14 locked cards. Nothing is lost by opening them: each
  // section still refuses to complete until its own evidence is captured, and
  // the work order still refuses to submit until every section is done.

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

  return shell(header.work_order_record_number || 'Work Order', (
    <>
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
      <WorkPlanProgress
        steps={orderedSteps}
        anyOrder={anyOrder}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orderedSteps.map((step, i) => {
          const locked = anyOrder
            ? false
            : (i > actionableIdx && actionableIdx !== -1 && !isStepCorrections(step))
          const isActionable = !isStepDone(step) && (
            anyOrder || i === actionableIdx || isStepCorrections(step)
          )
          return step.is_screen_flow ? (
            <ScreenFlowCard
              key={step.work_step_id}
              step={step}
              index={i}
              locked={locked}
              isActionable={isActionable}
              onOpen={() => setFlowStep(step)}
              onMarkNotApplicable={() => setNaStep(step)}
            />
          ) : (
            <StepCard
              key={step.work_step_id}
              step={step}
              woId={woId}
              index={i}
              locked={locked}
              isActionable={isActionable}
              busy={busy === step.work_step_id}
              onComplete={() => handleComplete(step)}
              onMarkNotApplicable={() => setNaStep(step)}
              // Silent: a non-silent load flips `loading` and the whole screen
              // becomes "Loading…", so every single photo tore down and rebuilt
              // the step list — losing an in-flight batch's progress, a
              // half-typed key-source name, and the scroll position, on a phone,
              // mid-job. The row still refreshes; the screen just stops blinking.
              onPhotoUploaded={async (msg, tone) => { flash(msg, tone); await load({ silent: true }) }}
              onPhotoError={(msg) => flash(msg, 'error')}
            />
          )
        })}
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
              : `Complete all sections to submit (${orderedSteps.filter(isStepDone).length}/${orderedSteps.length})`}
          </button>
        )}
        {/* Naming what is still missing beats a disabled button: the work order
            cannot be submitted until every section is captured, so the assessor
            needs to know which ones and why without opening all of them. */}
        {!allDone && !woStatus.includes('to be verified')
          && !woStatus.includes('verified') && !woStatus.includes('complete') && (
          <OutstandingSections steps={orderedSteps} />
        )}
      </div>

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

      {flowStep && (
        <ScreenFlowRunner
          step={flowStep}
          woId={woId}
          onFlash={flash}
          onClose={async () => { setFlowStep(null); await load({ silent: true }) }}
          onCompleted={async () => { setFlowStep(null); await load(); flash('Section complete') }}
        />
      )}

      {success && (
        <SuccessOverlay message={success} onDone={() => {
          setSuccess(null)
          if (embedded) { onChanged?.(); load() } else { navigate('/field') }
        }} />
      )}
    </>
  ))
}

// ─── WorkOrderShell ──────────────────────────────────────────────────────────
// One wrapper for both surfaces: the field PWA keeps its navy topbar + back
// chevron; embedded on the work order record page gets a plain block that
// inherits the card around it.
//
// Module level, deliberately. See the note at its call site: declaring this
// inside WorkOrderDetail made it a new component type on every render, which
// remounted every step card — and every hidden file input — whenever anything
// on the screen changed.
function WorkOrderShell({ embedded, title, navigate, children }) {
  if (embedded) return <div style={{ fontFamily: FONT }}>{children}</div>
  return <MobileShell title={title} onBack={() => navigate('/field')}>{children}</MobileShell>
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

        {/* No capture attribute → the tech can take a new photo OR attach one
            already saved on the device (e.g. shot earlier, offline). */}
        <input ref={fileRef} type="file" accept="image/*"
          onChange={(e) => { const f = fileFromInputEvent(e); if (f) setPhotoFile(f) }}
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

// ─── WorkPlanProgress ───────────────────────────────────────────────────────
// How much of the work plan is captured, stated as a number and a bar.
//
// An assessment runs 15 to 17 sections and an assessor jumping between them
// has no way to judge how far along they are from a list of cards (Nicholas,
// 2026-08-22: "There needs to be a progress bar showing"). Sections marked Not
// Applicable count as settled — they are a decision, not a gap — so the bar
// reaches 100% exactly when the work order becomes submittable.
function WorkPlanProgress({ steps, anyOrder }) {
  const total = steps.length
  const done = steps.filter(isStepDone).length
  const na = steps.filter((st) => (st.status || '').toLowerCase() === 'not applicable').length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const complete = total > 0 && done === total
  return (
    <div style={{ ...card, padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: FONT, fontWeight: 700, fontSize: 13, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: 0.4,
        }}>
          Work Steps
        </span>
        <span style={{
          fontFamily: MONO, fontSize: 13, fontWeight: 700,
          color: complete ? C.emeraldMid : C.textPrimary,
        }}>
          {done} / {total}
        </span>
      </div>
      <div style={{
        marginTop: 8, height: 8, borderRadius: 4,
        background: C.cardSecondary, border: `1px solid ${C.border}`, overflow: 'hidden',
      }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Work plan progress"
      >
        <div style={{
          width: `${pct}%`, height: '100%',
          background: complete ? C.emerald : C.emeraldMid,
          transition: 'width 250ms ease',
        }} />
      </div>
      <div style={{ marginTop: 7, fontFamily: FONT, fontSize: 12.5, color: C.textSecondary }}>
        {complete
          ? 'Every section captured — ready to submit for verification.'
          : `${total - done} section${total - done === 1 ? '' : 's'} still to capture`}
        {na > 0 && ` · ${na} not applicable`}
        {!complete && (anyOrder
          ? ' · take them in any order'
          : ' · complete in order')}
      </div>
    </div>
  )
}

// ─── OutstandingSections ────────────────────────────────────────────────────
// The sections still standing between the assessor and Submit, each with the
// reason it is not done yet. The evidence gap is the same sentence the server
// returns when a submit is refused, so what the screen says and what the
// database enforces can never drift apart.
function OutstandingSections({ steps }) {
  const open = steps.filter((st) => !isStepDone(st))
  if (open.length === 0) return null
  const shown = open.slice(0, 6)
  return (
    <div style={{
      ...card, padding: 12, marginTop: 10,
      background: C.cardSecondary,
    }}>
      <div style={{
        fontFamily: FONT, fontWeight: 700, fontSize: 12, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8,
      }}>
        Still to capture
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.map((st) => (
          <div key={st.work_step_id} style={{ fontFamily: FONT, fontSize: 13, color: C.textPrimary }}>
            <span style={{ fontWeight: 600 }}>{st.name}</span>
            {st.evidence_gap && (
              <span style={{ color: C.textSecondary }}> — {st.evidence_gap}</span>
            )}
          </div>
        ))}
      </div>
      {open.length > shown.length && (
        <div style={{ marginTop: 6, fontFamily: FONT, fontSize: 12.5, color: C.textMuted }}>
          and {open.length - shown.length} more
        </div>
      )}
    </div>
  )
}

// ─── StepCard ────────────────────────────────────────────────────────────────
function StepCard({ step, woId, index, locked, isActionable, busy, onComplete, onMarkNotApplicable, onPhotoUploaded, onPhotoError }) {
  const fileRef        = useRef(null)
  const folderRef      = useRef(null)  // library / folder picker (offline uploads)
  const videoRef       = useRef(null)
  const folderVideoRef = useRef(null)  // library / folder picker for video
  const legRef         = useRef('general')  // synchronous — no state race with the picker
  // {done, total} while photos upload, null when idle — see UploadProgress.
  const [batch, setBatch] = useState(null)
  // A video is one file and can be very large, so it says so in words rather
  // than counting a batch down. Tracked separately from `batch` because any
  // step can now take a video, so "is a video going up" is no longer the same
  // question as "is this a Video step".
  const [videoUploading, setVideoUploading] = useState(false)
  const uploading = !!batch || videoUploading

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

  // Same as triggerCapture, but opens the photo library / folder picker instead
  // of the camera — for a photo already taken (often offline, or being uploaded
  // from a PC). The leg is stored in the same ref so onFile tags it Before /
  // After / general exactly as a live capture, and the click stays synchronous
  // inside the tap for the same mobile user-gesture reason as the camera.
  const triggerFolder = (leg) => {
    legRef.current = leg
    if (folderRef.current) folderRef.current.click()
  }

  // Several photos at a time: the folder picker is multi-select, because at a
  // desk the photos for a step are already in a folder together.
  const uploadPhotos = async (list, { rejected = 0 } = {}) => {
    // Nothing to upload is an OUTCOME, and it gets said out loud. Returning
    // quietly here is how a photo that was rejected — or a picker handled in
    // the wrong order — looked identical to a photo that uploaded fine.
    if (list.length === 0) {
      onPhotoError(rejected > 0
        ? uploadResultLabel({ rejected })
        : 'No photo was selected — nothing was uploaded.')
      return
    }
    const leg = legRef.current
    setBatch({ done: 0, total: list.length })
    let uploaded = 0
    let failed = 0
    let lastRow = null
    let lastError = null
    for (const file of list) {
      try {
        lastRow = await captureStepPhoto({ file, workStepId: step.work_step_id, photoType: leg })
        uploaded += 1
      } catch (err) {
        failed += 1
        lastError = err
      }
      setBatch({ done: uploaded + failed, total: list.length })
    }
    setBatch(null)
    // Screen updates immediately — the photo is saved and counts. The GPS
    // check rides the server's EXIF processing (a few seconds) and warns
    // AFTER the fact, so capture never feels slow.
    if (uploaded > 0) {
      onPhotoUploaded(list.length === 1 && rejected === 0
        ? `Photo captured (${leg}) · ${step.name}`
        : `${uploadResultLabel({ uploaded, failed, rejected })} · ${step.name}`)
    }
    if (failed > 0) onPhotoError(lastError?.message || 'Photo upload failed.')
    else if (uploaded === 0) onPhotoError(uploadResultLabel({ rejected }) || 'Photo upload failed.')
    if (lastRow) {
      photoGpsMissing(lastRow).then((missing) => {
        if (missing) {
          onPhotoError('Photo saved, but it has NO location data. Turn on Location Services for your camera, then retake this photo.')
        }
      })
    }
  }

  // imageFilesFromInputEvent owns the snapshot-then-clear order. Never read
  // e.target.files into a variable and clear the input afterwards — the list is
  // live and clearing empties it. See src/lib/photoDrop.js.
  const onFile = async (e) => {
    const { files, rejected } = imageFilesFromInputEvent(e)
    await uploadPhotos(files, { rejected })
  }

  const onVideoFile = async (e) => {
    const file = fileFromInputEvent(e)
    if (!file) return
    setVideoUploading(true)
    try {
      await captureStepVideo({ file, workStepId: step.work_step_id, stepName: step.name })
      onPhotoUploaded(`Video attached · ${step.name}`)
    } catch (err) {
      onPhotoError(err.message || 'Video upload failed.')
    } finally {
      setVideoUploading(false)
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
        <PhotoStrip
          photos={step.photos}
          pending={batch ? Math.max(0, batch.total - batch.done) : 0}
          onFlash={(msg, tone) => (tone === 'error' ? onPhotoError(msg) : onPhotoUploaded(msg))}
        />
      )}

      {/* Attached videos — playable inline, including on completed steps. */}
      {Array.isArray(step.videos) && step.videos.length > 0 && (
        <VideoStrip videos={step.videos} />
      )}

      {/* Video capture belongs to the steps whose evidence IS video, and only
          those (Nicholas, 2026-09-02: video buttons should appear only on a
          step whose evidence type is Video, not beside Photo on every step).

          This REVERSES the 2026-08-27 rule ("the user can upload videos
          anywhere. You can't restrict this"), which put a Video button on all
          of them and made a photo step's controls read as a choice between two
          equal things when it is not one. Same person, later call — recorded
          here so nobody re-derives the old shape from the old comment. A video
          that genuinely belongs to a non-video step still has a home: the
          Photos/Files card on the work order files it against the record, and
          the guided flow keeps its own video prompts.

          A Video step keeps its controls OUTSIDE the plan's ordering gate — a
          finished step, or one further down the list, can still receive its
          footage — because a photo is what a step is judged on and the plan
          says when it is taken, while a 360 pan is a record of the building. */}
      {isVideoStep && (
        <>
          <input
            ref={videoRef} type="file" accept="video/*" capture="environment"
            onChange={onVideoFile} style={{ display: 'none' }}
          />
          <input
            ref={folderVideoRef} type="file" accept="video/*"
            onChange={onVideoFile} style={{ display: 'none' }}
          />
        </>
      )}
      {isVideoStep && !isActionable && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <button
            onClick={() => videoRef.current?.click()}
            disabled={videoUploading}
            style={{
              appearance: 'none', cursor: videoUploading ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'transparent', color: C.textSecondary,
              border: `1px dashed ${C.borderDark}`, borderRadius: 8,
              padding: '7px 11px', minHeight: 36,
              fontFamily: FONT, fontSize: 13, fontWeight: 600,
            }}
          >
            <VideoIcon /> Add video
          </button>
          <button
            onClick={() => folderVideoRef.current?.click()}
            disabled={videoUploading}
            aria-label="Upload a saved video from a folder"
            title="Upload a saved video — recorded offline or on another device"
            style={{
              appearance: 'none', cursor: videoUploading ? 'not-allowed' : 'pointer',
              display: 'inline-flex', alignItems: 'center',
              background: 'transparent', color: C.textSecondary,
              border: `1px dashed ${C.borderDark}`, borderRadius: 8,
              padding: '7px 10px', minHeight: 36,
            }}
          >
            <FolderIcon />
          </button>
          {videoUploading && (
            <span style={{ fontSize: 12, color: C.textMuted }}>Uploading video…</span>
          )}
        </div>
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
            ) : f.type === 'vehicle' ? (
              <StepVehicleField
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
      {!done && (reqCount > 0 || needsBefore || needsAfter || isVideoStep || videoCount > 0 || step.evidence_type === 'Document Upload') && (
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
          {reqCount > 0 && <span>Photos: {step.photo_count}/{reqCount}  </span>}
          {needsBefore && <span style={{ color: step.before_count > 0 ? C.emeraldMid : C.amber }}>Before {step.before_count > 0 ? '✓' : '—'}  </span>}
          {needsAfter && <span style={{ color: step.after_count > 0 ? C.emeraldMid : C.amber }}>After {step.after_count > 0 ? '✓' : '—'}</span>}
          {isVideoStep
            ? <span style={{ color: videoCount > 0 ? C.emeraldMid : C.amber }}>Video {videoCount > 0 ? '✓' : 'required'}</span>
            : videoCount > 0 && <span style={{ color: C.emeraldMid }}>Videos: {videoCount}  </span>}
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
          {/* No capture attribute → opens the library / folder picker so a
              photo taken offline can be uploaded later with its own metadata. */}
          <input
            ref={folderRef} type="file" accept="image/*" multiple
            onChange={onFile} style={{ display: 'none' }}
          />
          {step.reference_photo_url && (
            <button
              onClick={() => (isVideoStep ? videoRef.current?.click() : triggerCapture('general'))}
              disabled={uploading || busy}
              style={{
                appearance: 'none', cursor: 'pointer', display: 'block', width: '100%',
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                padding: 0, overflow: 'hidden', marginBottom: 10,
              }}
              aria-label={isVideoStep ? 'Record video like this example' : 'Take photo like this example'}
            >
              <img src={step.reference_photo_url} alt="Example"
                style={{ display: 'block', width: '100%', maxHeight: '52dvh', objectFit: 'contain', background: '#ffffff' }} />
              <span style={{
                display: 'block', padding: '7px 10px', borderTop: `1px solid ${C.border}`,
                fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textSecondary,
                background: C.cardSecondary, textAlign: 'center',
              }}>
                Example — {isVideoStep ? 'record like this' : 'take your photo like this'} · tap to open the camera
              </span>
            </button>
          )}
          {/* A Video step leads with Record Video, because that is the evidence
              it is waiting on. A Photo step offers photo controls only — see
              the note above the video inputs. */}
          <div style={{ display: 'flex', gap: 8, marginBottom: gap ? 8 : 0, flexWrap: 'wrap' }}>
            {isVideoStep && (
              <CaptureBtn label="Record Video" icon="video" onClick={() => videoRef.current?.click()} onFolder={() => folderVideoRef.current?.click()} disabled={uploading || busy} done={videoCount > 0} />
            )}
            {needsBefore && (
              <CaptureBtn label="Before" onClick={() => triggerCapture('before')} onFolder={() => triggerFolder('before')} disabled={uploading || busy} done={step.before_count > 0} />
            )}
            {needsAfter && (
              <CaptureBtn label="After" onClick={() => triggerCapture('after')} onFolder={() => triggerFolder('after')} disabled={uploading || busy} done={step.after_count > 0} />
            )}
            {/* General capture when the step needs a count but no specific leg,
                or to add beyond before/after toward the required count. */}
            {!isVideoStep && (reqCount > 0 || (!needsBefore && !needsAfter)) && (
              <CaptureBtn label="Photo" onClick={() => triggerCapture('general')} onFolder={() => triggerFolder('general')} disabled={uploading || busy} />
            )}
          </div>

          {videoUploading
            ? <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>Uploading video…</div>
            : <UploadProgress batch={batch} />}

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
//
// Lockbox appears TWICE on purpose (Nicholas, 2026-09-02: "you need to have an
// option lockbox for every…"). It is a chip, and it is also an entry in the
// "Who provided the keys?" list — because a technician who has already tapped
// Person is reading that list as the answer to the question on screen, and the
// true answer "nobody, it was in a lockbox" was only reachable by backing out
// to a control they had just moved past. Both routes record the SAME single
// value, "Lockbox"; picking it from the list snaps the chips back to Lockbox so
// the card never shows Person selected over a lockbox answer.
// Sentinel for the Lockbox entry inside the person list. Not a person's name,
// so it can never collide with a contact.
const LOCKBOX_OPTION = '__lockbox__'

function StepKeySource({ field, stepId, woId, disabled, onSaved, onError, embedded = false, onValue }) {
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

  useEffect(() => { if (embedded && onValue) onValue(currentValue) }, [currentValue]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ marginBottom: embedded ? 0 : 10 }}>
      {!embedded && (
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
          {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
          {saved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ {saved}</span>}
        </div>
      )}
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
              onChange={(e) => {
                if (e.target.value === LOCKBOX_OPTION) {
                  // One value, one meaning: this is the Lockbox chip's answer,
                  // reached from the list instead of from the chip.
                  setPerson('')
                  setOtherName('')
                  setMode('lockbox')
                  return
                }
                setPerson(e.target.value)
              }}
              disabled={disabled || saving}
              style={{
                width: '100%', boxSizing: 'border-box', minHeight: 44,
                fontFamily: FONT, fontSize: 15, color: C.textPrimary,
                border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
                background: C.card, marginBottom: person === '__other__' ? 8 : 0,
              }}>
              <option value="">Who provided the keys?</option>
              <option value={LOCKBOX_OPTION}>Lockbox — nobody handed them over</option>
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

      {!embedded && (
        <button
          onClick={save}
          disabled={disabled || saving || !dirty}
          style={(disabled || saving || !dirty)
            ? { ...btnDisabled, minHeight: 44 }
            : { ...btnPrimary, minHeight: 44 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}

// ─── StepVehicleField ────────────────────────────────────────────────────────
// The 'vehicle' field type ("Vehicle Inspected" on the monthly vehicle
// equipment and documents check). Built like key_source: a picker over REAL
// records. It sends the vehicle's ID; the SERVER composes the readable value it
// stores and stamps work_orders.vehicle_id from that same row, so the text a
// person reads and the foreign key a report joins on cannot disagree.
//
// The option label mirrors what the server stores, but it is presentation only
// — never the value that gets saved.
function vehicleOptionLabel(v) {
  const plate = v.vehicle_license_plate ? ` (${v.vehicle_license_plate})` : ''
  return `${v.vehicle_record_number} · ${v.vehicle_name}${plate}`
}

// The saved value leads with the vehicle's record number, which is how a stored
// answer is matched back to a row without re-deriving the server's formatting.
function vehicleIdForSavedText(vehicles, savedText) {
  const rec = String(savedText || '').split(' · ')[0].trim()
  if (!rec) return ''
  const hit = (vehicles || []).find((v) => v.vehicle_record_number === rec)
  return hit ? hit.id : ''
}

function StepVehicleField({ field, stepId, disabled, onSaved, onError, embedded = false, onValue }) {
  const savedText = field.text_value ?? ''
  const [vehicles, setVehicles] = useState(null)   // null = loading
  const [value, setValue] = useState('')           // the selected vehicle's id
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const hasSaved = savedText !== '' && savedText != null

  useEffect(() => { if (embedded && onValue) onValue(value) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    fetchVehiclesForInspection()
      .then((rows) => {
        if (cancelled) return
        setVehicles(rows)
        // Show what was already answered, resolved back to its row.
        if (!touched) setValue(vehicleIdForSavedText(rows, savedText))
      })
      .catch(() => {
        if (cancelled) return
        setVehicles([])
        onError(`Could not load the vehicle list for "${field.label}".`)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const options = vehicles || []
  // A vehicle retired since the answer was given is no longer offered, but the
  // answer still has to be readable rather than resetting the field to blank.
  const savedGone = hasSaved && vehicles !== null && !vehicleIdForSavedText(options, savedText)
  const dirty = !!value && value !== vehicleIdForSavedText(options, savedText)

  const save = async () => {
    if (!value) { onError(`Pick the vehicle for "${field.label}".`); return }
    setSaving(true)
    try {
      const res = await saveWorkStepVehicle(stepId, field.field_id, value)
      onSaved(res.message || `${field.label} saved`)
    } catch (e) {
      onError(e.message || 'Could not save the vehicle.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginBottom: embedded ? 0 : 10 }}>
      {!embedded && (
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
          {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
          {hasSaved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
        </div>
      )}
      {savedGone && (
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 6 }}>
          Recorded as <strong>{savedText}</strong>, which is no longer in service. Pick a vehicle to change it.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={value}
          onChange={(e) => { setTouched(true); setValue(e.target.value) }}
          disabled={disabled || saving || vehicles === null}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', minHeight: 48,
            fontFamily: FONT, fontSize: 16,
            border: `1px solid ${hasSaved && !dirty ? C.emerald : C.borderDark}`,
            borderRadius: 8, padding: '10px 12px',
            color: value ? C.textPrimary : C.textMuted, background: C.card,
          }}
        >
          <option value="">
            {vehicles === null ? 'Loading vehicles…'
              : options.length === 0 ? 'No vehicles available'
              : 'Select the vehicle…'}
          </option>
          {options.map((v) => (
            <option key={v.id} value={v.id}>{vehicleOptionLabel(v)}</option>
          ))}
        </select>
        {!embedded && (
          <button
            onClick={save}
            disabled={disabled || saving || !dirty || !value}
            style={(disabled || saving || !dirty || !value)
              ? { ...btnDisabled, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }
              : { ...btnPrimary, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── StepUserMultiselect ─────────────────────────────────────────────────────
// The 'user_multiselect' field type (e.g. "Technicians On-Site" on building
// access steps): a checkbox list of active users, saved as comma-separated
// names so the value reads plainly everywhere (step card, desktop record,
// verifier view).
function StepUserMultiselect({ field, stepId, disabled, onSaved, onError, embedded = false, onValue }) {
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

  useEffect(() => { if (embedded && onValue) onValue(currentValue) }, [currentValue]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ marginBottom: embedded ? 0 : 10 }}>
      {!embedded && (
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
          {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
          {savedNames.length > 0 && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
        </div>
      )}
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
      {!embedded && (
        <button
          onClick={save}
          disabled={disabled || saving || !dirty}
          style={(disabled || saving || !dirty)
            ? { ...btnDisabled, minHeight: 44 }
            : { ...btnPrimary, minHeight: 44 }}
        >
          {saving ? 'Saving…' : `Save (${selected.size} selected)`}
        </button>
      )}
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
function StepSelectField({ field, stepId, disabled, onSaved, onError, embedded = false, onValue }) {
  const savedVal = field.text_value ?? ''
  const [value, setValue] = useState(String(savedVal))
  const [options, setOptions] = useState(null)
  const [saving, setSaving] = useState(false)
  const dirty = value !== String(savedVal)
  const hasSaved = savedVal !== '' && savedVal != null

  // Embedded in the screen flow: report the value up (the flow's Continue
  // button saves it); the inline label + Save button are hidden.
  useEffect(() => { if (embedded && onValue) onValue(value) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ marginBottom: embedded ? 0 : 10 }}>
      {!embedded && (
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
          {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
          {hasSaved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || saving || options === null}
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box', minHeight: 48,
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
        {!embedded && (
          <button
            onClick={save}
            disabled={disabled || saving || !dirty || !value}
            style={(disabled || saving || !dirty || !value)
              ? { ...btnDisabled, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }
              : { ...btnPrimary, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

function StepFieldInput({ field, stepId, disabled, onSaved, onError, embedded = false, onValue }) {
  const savedVal = field.numeric_value ?? field.text_value ?? ''
  const [value, setValue] = useState(String(savedVal))
  const [saving, setSaving] = useState(false)
  const isNumber = field.type === 'number'
  const dirty = value.trim() !== String(savedVal).trim()
  const hasSaved = savedVal !== '' && savedVal != null

  // Embedded in the screen flow: report the value up; hide inline label + Save.
  useEffect(() => { if (embedded && onValue) onValue(value) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ marginBottom: embedded ? 0 : 10 }}>
      {!embedded && (
        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
          {field.label}{field.required && <span style={{ color: C.danger }}> *</span>}
          {hasSaved && !dirty && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>  ✓ saved</span>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            type="text"
            inputMode={isNumber ? 'decimal' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isNumber ? '0' : ''}
            disabled={disabled || saving}
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 48,
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
        {!embedded && (
          <button
            onClick={save}
            disabled={disabled || saving || !dirty}
            style={(disabled || saving || !dirty)
              ? { ...btnDisabled, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }
              : { ...btnPrimary, flex: '0 0 auto', width: 'auto', minHeight: 44, padding: '0 18px' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </div>
  )
}

// A capture control. `onClick` opens the camera (straight-to-camera, the fast
// field path). When `onFolder` is supplied, a companion button is attached on
// the right that opens the file / photo-library picker instead — for photos or
// videos taken offline and uploaded later from the phone's library or a PC. The
// leg / photo-type tagging is identical for both, so a folder upload lands with
// the same Before/After/step-name tag as a live capture.
function CaptureBtn({ label, icon = 'camera', onClick, onFolder, disabled, done }) {
  const base = {
    appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: done ? '#e8f8f0' : C.cardSecondary,
    color: done ? C.emeraldMid : C.textPrimary,
    border: `1px solid ${done ? C.emerald : C.borderDark}`,
    fontFamily: FONT, fontWeight: 600, fontSize: 14, minHeight: 44,
    justifyContent: 'center',
  }
  const main = (
    <button
      onClick={onClick} disabled={disabled}
      style={{ ...base, borderRadius: onFolder ? '8px 0 0 8px' : 8, padding: '10px 14px', flex: '1 1 auto' }}
    >
      {icon === 'video' ? <VideoIcon /> : <CameraIcon />} {label}{done ? ' ✓' : ''}
    </button>
  )
  if (!onFolder) return main
  const kind = icon === 'video' ? 'video' : 'photo'
  return (
    <div style={{ display: 'inline-flex', flex: '1 1 auto', minWidth: 0 }}>
      {main}
      <button
        onClick={onFolder} disabled={disabled}
        aria-label={`Upload a saved ${kind} from a folder`}
        title={`Upload a saved ${kind} — taken offline or on another device`}
        style={{ ...base, gap: 0, borderRadius: '0 8px 8px 0', borderLeft: 'none', padding: '10px 13px', flex: '0 0 auto' }}
      >
        <FolderIcon />
      </button>
    </div>
  )
}

// ─── UploadProgress ─────────────────────────────────────────────────────────
// The in-flight state of a photo upload, stated loudly. The old version was
// 12px muted grey under the button, which on a desktop screen read as nothing
// at all: Nicholas picked a photo from a folder, saw no change, and concluded
// it had failed — it had in fact uploaded (Nicholas, 2026-08-22). A photo on a
// cellular uplink can take real seconds, so this has to be impossible to miss
// and has to count a batch down rather than spin indefinitely.
function UploadProgress({ batch }) {
  if (!batch) return null
  const { done = 0, total = 0 } = batch
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: 10, padding: '10px 12px', borderRadius: 8,
        background: '#e8f8f0', border: `1px solid ${C.emerald}`,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: FONT, fontSize: 13.5, fontWeight: 600, color: C.emeraldMid,
      }}>
        <Spinner />
        {uploadProgressLabel(done, total)}
      </div>
      {total > 1 && (
        <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: '#ffffff', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: C.emerald, transition: 'width 200ms ease' }} />
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 13, height: 13, flex: '0 0 auto', borderRadius: '50%',
        border: `2px solid ${C.emerald}`, borderTopColor: 'transparent',
        display: 'inline-block', animation: 'leap-spin 0.7s linear infinite',
      }}
    >
      <style>{`@keyframes leap-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}

// ─── DropHint ───────────────────────────────────────────────────────────────
// Shown over the prompt while photos are dragged across it. Desktop only in
// practice — there is nothing to drag on a phone — so it never competes with
// the camera button for space in the field.
function DropHint({ active }) {
  if (!active) return null
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 40,
      background: 'rgba(232,248,240,0.94)', border: `2px dashed ${C.emerald}`,
      borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', padding: 20, textAlign: 'center',
    }}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 17, color: C.emeraldMid }}>
        Drop photos to attach them to this step
      </div>
    </div>
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
// The same bookmark mark the desktop gallery uses for report inclusion, so
// one action reads identically on both surfaces. Filled when the photo is in.
function ReportFlagIcon({ filled }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12a1 1 0 011 1v17l-7-4-7 4V4a1 1 0 011-1z" />
    </svg>
  )
}

function PhotoStrip({ photos, label = null, pending = 0, onFlash = null }) {
  const [urls, setUrls] = useState({})   // photo.id -> signedUrl
  const [zoom, setZoom] = useState(null) // signedUrl being viewed full-screen
  const signedRef = useRef(new Map())    // `${bucket}::${path}` -> signedUrl
  // Report-inclusion overrides, keyed by photo id. The strip's photos come
  // from the work order detail payload, which only reloads on a refresh, so a
  // flag toggled here shows immediately instead of after the next fetch.
  const [reportFlags, setReportFlags] = useState({})
  const [flagBusy, setFlagBusy] = useState(null)

  // The technician standing in the attic knows better than anyone which shot
  // proves the work. Until now only the desktop gallery could mark a photo for
  // the final report, so that judgement was made later by someone who wasn't
  // there (Nicholas, 2026-08-22).
  const inReport = (p) => (
    reportFlags[p.id] !== undefined ? reportFlags[p.id] : !!p.include_in_final_report
  )
  const toggleReport = async (p) => {
    const next = !inReport(p)
    setReportFlags((m) => ({ ...m, [p.id]: next }))
    setFlagBusy(p.id)
    try {
      await setPhotoReportInclusion(p.id, next)
      if (onFlash) onFlash(next ? 'Added to the final report' : 'Removed from the final report')
    } catch (err) {
      setReportFlags((m) => ({ ...m, [p.id]: !next }))
      if (onFlash) onFlash(err.message || 'Could not update the report flag.', 'error')
    } finally {
      setFlagBusy(null)
    }
  }

  // Key the signing effect on the photo SET's CONTENT, never on the array's
  // identity. Callers legitimately build this array inline — the screen-flow
  // runner passes photosOfType(field), a fresh .filter() result on every
  // render — so keying on the reference re-signed every photo each render,
  // and since signing sets state (which re-renders, which produces another
  // new array) it became an endless sign -> re-render -> sign loop. In the
  // field that loop ran as fast as the network allowed, saturating the
  // technician's cellular uplink so real photo uploads crawled and timed out,
  // and it re-downloaded each full-size thumbnail every cycle because the
  // freshly signed URL changed the <img src> each time. The content key moves
  // only when a photo is actually added, removed, or repointed.
  const photoKey = photos.map((p) => `${p.id}:${p.bucket}:${p.path}`).join('|')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Reuse a URL already signed for this object: it keeps the <img src>
      // stable (no re-download of photos already on screen) and means adding
      // one photo signs one photo, not the whole strip again.
      const entries = await Promise.all(
        photos.map(async (p) => {
          const cacheKey = `${p.bucket}::${p.path}`
          let url = signedRef.current.get(cacheKey)
          if (!url) {
            url = await signedPhotoUrl(p.bucket, p.path)
            if (url) signedRef.current.set(cacheKey, url)
          }
          return [p.id, url]
        })
      )
      if (!cancelled) setUrls(Object.fromEntries(entries.filter(([, u]) => u)))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey])

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
              <button
                onClick={() => toggleReport(p)}
                disabled={flagBusy === p.id}
                aria-label={inReport(p) ? 'Remove from the final report' : 'Add to the final report'}
                title={inReport(p) ? 'In the final report — tap to remove' : 'Add to the final report'}
                style={{
                  position: 'absolute', top: 3, right: 3,
                  width: 22, height: 22, borderRadius: '50%', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: inReport(p) ? C.emerald : 'rgba(13,26,46,0.62)',
                  border: inReport(p) ? 'none' : '1px solid rgba(255,255,255,0.4)',
                  cursor: flagBusy === p.id ? 'default' : 'pointer',
                  opacity: flagBusy === p.id ? 0.6 : 1,
                }}
              >
                <span style={{ color: '#fff', display: 'flex' }}>
                  <ReportFlagIcon filled={inReport(p)} />
                </span>
              </button>
              {isMeaningfulTag(p.photo_type) && (
                <span style={{
                  position: 'absolute', bottom: 3, left: 3, right: 3,
                  background: legColor, color: '#fff', fontSize: 9, fontWeight: 700,
                  borderRadius: 4, padding: '1px 4px',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {/* The prompt's own wording when the strip belongs to one
                      prompt, otherwise the tag humanized — never the raw
                      'mf_elev_front' slug the technician never typed. */}
                  {label || photoTagLabel(p)}
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

      {/* One tile per photo still uploading — the drop registers on screen
          immediately instead of after the last file lands. */}
      {Array.from({ length: Math.max(0, pending) }).map((_, i) => (
        <div key={`pending-${i}`} style={{ width: 72 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 8,
            border: `1px dashed ${C.emerald}`, background: '#e8f8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Spinner />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.textMuted, textAlign: 'center', marginTop: 3 }}>
            …
          </div>
        </div>
      ))}

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

// ─── Screen-flow prompt copy ─────────────────────────────────────────────────
// Turns a field into a plain one-line prompt for the guided flow (e.g. "Select
// the fuel type." / "Enter the model number.").
function fieldPrompt(field) {
  // A field can carry its own plain-language question (wstf_help_text).
  if (field.help && String(field.help).trim()) return String(field.help).trim()
  const label = (field.label || 'this').trim()
  if (field.type === 'photo') {
    // "Total Equipment Photo" -> "Take a picture of the total equipment."
    const subject = label.replace(/\s*photo$/i, '')
    return `Take a picture of the ${subject.toLowerCase()}.`
  }
  const pick = field.type === 'select' || field.type === 'user_multiselect'
    || field.type === 'key_source' || field.type === 'vehicle'
  // Keep the label as-authored so acronyms read right ("Enter the BTUs.").
  return `${pick ? 'Select' : 'Enter'} the ${label}.`
}

// A field is answered when it holds a value (mirrors the server's required-field
// evidence gate).
function fieldHasValue(f) {
  return (f.numeric_value != null) || (f.text_value != null && String(f.text_value).trim() !== '')
}

// The saved value of a field as a plain string (for diffing against the flow's
// pending editor value).
function fieldSavedString(f) {
  if (f.numeric_value != null) return String(f.numeric_value)
  return f.text_value != null ? String(f.text_value) : ''
}

// A required photo field that opts into "not present" (allow_not_present) can be
// satisfied by an explicit "not present" mark, stored as the field's text value,
// instead of a photo — for equipment that genuinely isn't there (e.g. no HVAC
// flue in this attic). The server evidence gate applies the same rule.
function fieldMarkedNotPresent(f) {
  return !!(f && f.allow_not_present && f.text_value != null && String(f.text_value).trim() !== '')
}

// Evaluate a calculated field's arithmetic expression (+ - * / and parens) over
// sibling field values. `resolveVar(name)` returns a finite number or null; any
// missing input, divide-by-zero, or parse error yields null (nothing to show).
// A hand-written recursive-descent parser — never eval/Function — so an
// admin-authored expression can't run arbitrary code.
function evalCalc(expr, resolveVar) {
  if (!expr) return null
  try {
    const tokens = String(expr).match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/]/g)
    if (!tokens || !tokens.length) return null
    let pos = 0
    const peek = () => tokens[pos]
    const eat = () => tokens[pos++]
    const parseExpr = () => {
      let v = parseTerm()
      while (peek() === '+' || peek() === '-') {
        const op = eat(); const r = parseTerm()
        if (v == null || r == null) return null
        v = op === '+' ? v + r : v - r
      }
      return v
    }
    const parseTerm = () => {
      let v = parseFactor()
      while (peek() === '*' || peek() === '/') {
        const op = eat(); const r = parseFactor()
        if (v == null || r == null) return null
        v = op === '*' ? v * r : (r === 0 ? null : v / r)
      }
      return v
    }
    const parseFactor = () => {
      const t = peek()
      if (t === '(') { eat(); const v = parseExpr(); if (peek() === ')') eat(); return v }
      if (t === '-') { eat(); const v = parseFactor(); return v == null ? null : -v }
      eat()
      if (/^[A-Za-z_]/.test(t)) { const rv = resolveVar(t); return (rv == null || !Number.isFinite(rv)) ? null : rv }
      const n = Number(t)
      return Number.isFinite(n) ? n : null
    }
    const result = parseExpr()
    return (result == null || !Number.isFinite(result)) ? null : Math.round(result * 100) / 100
  } catch { return null }
}

// ─── ScreenFlowCard ──────────────────────────────────────────────────────────
// A screen-flow work step (e.g. Heating System on the Single-Family Energy
// Assessment). Rather than inline capture, it renders a compact section card
// that launches the full-screen guided flow. Completed sections show a
// read-only summary of what was captured.
function ScreenFlowCard({ step, index, locked, isActionable, onOpen, onMarkNotApplicable }) {
  const done = isStepDone(step)
  const corrections = isStepCorrections(step)
  const chip = statusChip(step.status)
  const notApplicable = (step.status || '').toLowerCase() === 'not applicable'

  const photoNeeded = (step.photos_required_count || 0) > 0 || step.photo_before_required || step.photo_after_required
  const fields = Array.isArray(step.fields) ? step.fields : []
  const stepPhotos = Array.isArray(step.photos) ? step.photos : []
  // A prompt is "done" when it holds a value, or (for a 'photo' field) when a
  // photo tagged with its name exists on the step.
  const promptDone = (f) => f.type === 'photo'
    ? (stepPhotos.some((p) => (p.photo_type || '') === f.name) || fieldMarkedNotPresent(f))
    : fieldHasValue(f)
  // Progress counts required prompts only — the SnuggPro detail fields are
  // optional, so they don't hold the section back.
  const reqFields = fields.filter((f) => f.required)
  const totalPrompts = (photoNeeded ? 1 : 0) + reqFields.length
  const photoDone = !photoNeeded || (step.photo_count || 0) >= Math.max(1, step.photos_required_count || 1)
  const donePrompts = (photoNeeded ? (photoDone ? 1 : 0) : 0) + reqFields.filter(promptDone).length

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
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 10, lineHeight: 1.45 }}>
          {step.description}
        </div>
      )}

      {done ? (
        <div style={{ marginBottom: 2 }}>
          {photoNeeded && (
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
              <strong style={{ color: C.textPrimary }}>Photo:</strong>{' '}
              <span style={{ fontFamily: MONO }}>{step.photo_count || 0} captured</span>
            </div>
          )}
          {fields.map((f) => {
            if (f.type === 'photo') {
              const n = stepPhotos.filter((p) => (p.photo_type || '') === f.name).length
              return (
                <div key={f.field_id} style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
                  <strong style={{ color: C.textPrimary }}>{f.label}:</strong>{' '}
                  {n > 0
                    ? <span style={{ fontFamily: MONO }}>{n} captured</span>
                    : fieldMarkedNotPresent(f)
                      ? <span style={{ fontFamily: MONO }}>not present</span>
                      : <span style={{ color: C.textMuted }}>none</span>}
                </div>
              )
            }
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
      ) : locked ? (
        <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
          Complete the previous step first.
        </div>
      ) : isActionable ? (
        <>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
            {donePrompts}/{totalPrompts} answered · {photoNeeded ? 'photo + ' : ''}{fields.length} detail{fields.length === 1 ? '' : 's'}
          </div>
          <button onClick={onOpen} style={{ ...btnPrimary, minHeight: 46 }}>
            {donePrompts > 0 ? 'Continue Section →' : 'Open Section →'}
          </button>
          <button
            onClick={onMarkNotApplicable}
            style={{
              appearance: 'none', background: 'none', border: 'none', cursor: 'pointer',
              display: 'block', margin: '10px auto 0', padding: 6,
              fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textMuted,
              textDecoration: 'underline',
            }}
          >
            This section doesn’t apply here — mark Not Applicable
          </button>
        </>
      ) : null}

      {notApplicable && step.not_applicable_reason && (
        <div style={{
          background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: '8px 10px', marginTop: 8, fontSize: 12.5, color: C.textSecondary,
        }}>
          <strong>Not Applicable:</strong> {step.not_applicable_reason}
        </div>
      )}
    </div>
  )
}

// ─── ScreenFlowRunner ────────────────────────────────────────────────────────
// Full-screen guided capture for a screen-flow step. Walks the step's photo
// requirement, then each field, one prompt per screen, and finishes by
// completing the step. Reuses the standard capture + field-save RPCs and the
// existing field editors; the server evidence gate is the final authority on
// completion. Re-fetches the work order after each save so live values and the
// gap stay authoritative.
function ScreenFlowRunner({ step: initialStep, woId, onClose, onCompleted, onFlash }) {
  const [live, setLive] = useState(initialStep)
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  // {done, total} while photos are uploading, null when idle. A count rather
  // than a boolean because a desktop drop is usually several files at once and
  // the assessor needs to see it moving (Nicholas, 2026-08-22: the upload
  // worked, but nothing on screen said so, so it read as a silent failure).
  const [batch, setBatch] = useState(null)
  const [dragActive, setDragActive] = useState(false)
  const [pending, setPending] = useState({}) // field_id -> current (unsaved) editor value
  const [exampleZoom, setExampleZoom] = useState(null) // illustration URL viewed full-screen
  const fileRef = useRef(null)
  const folderRef = useRef(null)         // library / folder picker (offline uploads)
  const photoTypeRef = useRef('general') // which photo_type the next capture tags

  const refresh = useCallback(async () => {
    try {
      const d = await fetchWorkOrderDetail(woId)
      const s = (d.steps || []).find((x) => x.work_step_id === initialStep.work_step_id)
      if (s) setLive(s)
      return s
    } catch { return null }
  }, [woId, initialStep.work_step_id])

  const photoNeeded = (live.photos_required_count || 0) > 0 || live.photo_before_required || live.photo_after_required
  const reqPhotos = photoNeeded ? Math.max(1, live.photos_required_count || 1) : 0
  const fields = Array.isArray(live.fields) ? live.fields : []
  const stepPhotos = Array.isArray(live.photos) ? live.photos : []
  const photosOfType = (name) => stepPhotos.filter((p) => (p.photo_type || '') === name)

  // Resolve a sibling field's numeric value for a calculated expression —
  // preferring the unsaved editor value so the review recomputes live.
  const resolveVar = (name) => {
    const f = fields.find((x) => x.name === name)
    if (!f) return null
    const p = pending[f.field_id]
    if (p !== undefined && String(p).trim() !== '') {
      const n = Number(p); return Number.isFinite(n) ? n : null
    }
    return f.numeric_value != null ? Number(f.numeric_value) : null
  }
  const calcValue = (f) => evalCalc(f.calc, resolveVar)

  // Calculated fields are derived, not captured — they get no input screen.
  const inputFields = fields.filter((f) => !f.calculated)

  // Screen list: [generic photo?] + one per input field (a 'photo' field
  // becomes a photo-capture screen) + review.
  const screens = []
  if (photoNeeded) screens.push({ kind: 'photo' })
  inputFields.forEach((f) => screens.push({ kind: f.type === 'photo' ? 'photofield' : 'field', field: f }))
  screens.push({ kind: 'review' })

  // From a review row back to the screen that captures it (-1 = no screen,
  // e.g. a calculated field). The generic photo screen, if any, is index 0.
  const screenIndexForField = (fid) => screens.findIndex((s) => s.field && s.field.field_id === fid)
  const jumpTo = (i) => { if (i >= 0) setIdx(i) }

  const clampedIdx = Math.min(idx, screens.length - 1)
  const screen = screens[clampedIdx]

  const photoCount = live.photo_count || 0
  const photoSatisfied = !photoNeeded || photoCount >= reqPhotos

  // Progress by what is CAPTURED, not by where the assessor happens to be
  // standing. Position told them nothing: skipping four optional prompts drove
  // the bar to 80% with nothing recorded, and stepping back through a finished
  // section drove it down again.
  const captureScreens = screens.filter((sc) => sc.kind !== 'review')
  const capturedCount = captureScreens.filter((sc) => {
    if (sc.kind === 'photo') return photoSatisfied
    if (sc.kind === 'photofield') {
      return photosOfType(sc.field.name).length > 0 || fieldMarkedNotPresent(sc.field)
    }
    return String(fieldSavedString(sc.field) ?? '').trim() !== ''
  }).length
  const pct = captureScreens.length > 0
    ? Math.round((capturedCount / captureScreens.length) * 100)
    : 100

  const next = () => setIdx((i) => Math.min(i + 1, screens.length - 1))
  const back = () => setIdx((i) => Math.max(i - 1, 0))

  const triggerPhoto = (ptype) => { photoTypeRef.current = ptype || 'general'; fileRef.current?.click() }
  // Opens the library / folder picker instead of the camera, for a photo taken
  // offline and uploaded later; same photo-type tagging as a live capture.
  const triggerPhotoFolder = (ptype) => { photoTypeRef.current = ptype || 'general'; folderRef.current?.click() }

  // Upload one or many photos against the current prompt. Sequential so a
  // 30-photo drop on a cellular uplink stays predictable, and so `batch` can
  // report real progress rather than a spinner that means nothing.
  const uploadPhotos = async (files, { rejected = 0 } = {}) => {
    const list = Array.isArray(files) ? files : []
    if (list.length === 0) {
      if (rejected > 0) onFlash(uploadResultLabel({ rejected }), 'error')
      return
    }
    const photoType = photoTypeRef.current
    setBatch({ done: 0, total: list.length })
    let uploaded = 0
    let failed = 0
    let lastRow = null
    let lastError = null
    for (const file of list) {
      try {
        lastRow = await captureStepPhoto({ file, workStepId: live.work_step_id, photoType })
        uploaded += 1
      } catch (err) {
        failed += 1
        lastError = err
      }
      setBatch({ done: uploaded + failed, total: list.length })
      // Refresh after each one so the thumbnail appears as it lands instead of
      // the whole batch arriving at the end.
      await refresh()
    }
    setBatch(null)
    if (uploaded > 0) {
      onFlash(list.length === 1
        ? `Photo captured · ${live.name}`
        : uploadResultLabel({ uploaded, failed, rejected }))
    }
    if (uploaded === 0 || failed > 0 || rejected > 0) {
      const detail = failed > 0 ? (lastError?.message || 'Photo upload failed.') : null
      onFlash(detail || uploadResultLabel({ uploaded, failed, rejected }) || 'Photo upload failed.', 'error')
    }
    // The GPS check rides the server's EXIF pass (a few seconds) and warns
    // after the fact, so capture never feels slow.
    if (lastRow) {
      photoGpsMissing(lastRow).then((missing) => {
        if (missing) onFlash('Photo saved, but it has NO location data. Turn on Location Services for your camera, then retake.', 'error')
      })
    }
  }

  const onFile = async (e) => {
    const { files, rejected } = imageFilesFromInputEvent(e)
    await uploadPhotos(files, { rejected })
  }

  // Desktop: drag photos straight onto the prompt. The screen body is the drop
  // zone whenever the current screen is asking for a photo — an assessor
  // working from a folder should never have to go through the file dialog one
  // photo at a time.
  const photoScreen = screen.kind === 'photo' || screen.kind === 'photofield'
  const dropPhotoType = screen.kind === 'photofield' ? screen.field.name : 'general'
  const onDragOver = (e) => {
    if (!photoScreen || batch || !dragCarriesFiles(e.dataTransfer)) return
    e.preventDefault()
    setDragActive(true)
  }
  const onDragLeave = (e) => {
    // Ignore the dragleave fired when the pointer crosses into a child.
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragActive(false)
  }
  const onDrop = async (e) => {
    if (!photoScreen || batch) return
    e.preventDefault()
    setDragActive(false)
    const { files, rejected } = imageFilesFromDrop(e.dataTransfer)
    photoTypeRef.current = dropPhotoType
    await uploadPhotos(files, { rejected })
  }

  const finish = async () => {
    setBusy(true)
    try {
      // Persist calculated fields from the values entered this session, so the
      // derived numbers (e.g. Output Capacity) are stored, not just displayed.
      for (const f of fields) {
        if (!f.calculated) continue
        const v = calcValue(f)
        if (v == null) continue
        if (f.numeric_value != null && Number(f.numeric_value) === v) continue
        try { await saveWorkStepFieldValue(live.work_step_id, f.field_id, String(v)) } catch { /* non-blocking */ }
      }
      await completeWorkStep(live.work_step_id)
      onCompleted()
    } catch (e) {
      onFlash(e.message || 'Could not complete the section.', 'error')
      await refresh() // resurface the gap so the auditor can go back and fix it
    } finally {
      setBusy(false)
    }
  }

  const curField = (screen.kind === 'field' || screen.kind === 'photofield') ? screen.field : null
  const curPending = (screen.kind === 'field' && curField)
    ? (pending[curField.field_id] !== undefined ? pending[curField.field_id] : fieldSavedString(curField))
    : ''
  const curEmpty = String(curPending ?? '').trim() === ''
  const curPhotoN = (screen.kind === 'photofield' && curField) ? photosOfType(curField.name).length : 0
  // Optional fields/photos (the SnuggPro detail prompts) can be skipped;
  // required ones must be satisfied before Continue.
  const continueDisabled =
    busy ||
    (screen.kind === 'photo' && !photoSatisfied) ||
    (screen.kind === 'field' && curField.required && curEmpty) ||
    (screen.kind === 'photofield' && curField.required && curPhotoN === 0 && !fieldMarkedNotPresent(curField))
  const fieldSkippable =
    (screen.kind === 'field' && !curField.required && curEmpty) ||
    (screen.kind === 'photofield' && !curField.required && curPhotoN === 0)

  // Mark a "not present" photo field (e.g. no HVAC flue in this attic): record
  // the marker as the field's value so the evidence gate is satisfied, then move
  // on. Only offered on required photo fields that opt in via allow_not_present.
  const markNotPresent = async () => {
    const f = screen.field
    setBusy(true)
    try {
      await saveWorkStepFieldValue(live.work_step_id, f.field_id, 'Not Present')
      await refresh()
      next()
    } catch (e) {
      onFlash(e.message || 'Could not update the item.', 'error')
    } finally {
      setBusy(false)
    }
  }

  // Continue on a field screen: save the value (if changed) then advance; an
  // empty optional field is skipped. The bottom Continue is the single action.
  const advanceField = async () => {
    const f = screen.field
    const cur = String(curPending ?? '').trim()
    if (!cur) { next(); return }
    // A vehicle field carries the vehicle's ID while the SAVED value is the
    // readable text the server composed, so the two are never equal — skip the
    // unchanged short-circuit and let the save be idempotent instead.
    if (f.type !== 'vehicle' && cur === String(fieldSavedString(f) ?? '').trim()) { next(); return }
    setBusy(true)
    try {
      if (f.type === 'vehicle') {
        await saveWorkStepVehicle(live.work_step_id, f.field_id, cur)
      } else {
        await saveWorkStepFieldValue(live.work_step_id, f.field_id, cur)
      }
      await refresh()
      next()
    } catch (e) {
      onFlash(e.message || 'Could not save the value.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 95, background: C.page,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: 'calc(env(safe-area-inset-top) + 10px) 14px 10px',
        background: C.sidebar, color: '#fff', flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{ appearance: 'none', background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: 4, fontSize: 20, lineHeight: 1 }}
          aria-label="Close"
        >×</button>
        <div style={{ flex: 1, fontFamily: FONT, fontWeight: 700, fontSize: 16 }}>{live.name}</div>
        <div style={{ fontFamily: MONO, fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
          {clampedIdx + 1} / {screens.length}
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 4, background: C.borderDark, flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: C.emerald, transition: 'width 220ms ease' }} />
      </div>

      {/* Screen body — also the drop zone whenever the current screen is
          asking for a photo. */}
      <div
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ flex: 1, overflowY: 'auto', padding: 18, position: 'relative' }}
      >
        <DropHint active={dragActive} />
        {screen.kind === 'photo' && (
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 19, color: C.textPrimary, marginBottom: 6 }}>
              Take a picture of the {live.name.toLowerCase()}.
            </div>
            <div style={{ fontSize: 13.5, color: C.textSecondary, marginBottom: 16 }}>
              {photoCount > 0
                ? `${photoCount} photo${photoCount === 1 ? '' : 's'} captured. Add another or continue.`
                : `${reqPhotos} photo${reqPhotos === 1 ? '' : 's'} required.`}
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: 'none' }} />
            <input ref={folderRef} type="file" accept="image/*" multiple onChange={onFile} style={{ display: 'none' }} />
            <CaptureBtn
              label={photoCount > 0 ? 'Add / Retake Photo' : 'Take Photo'}
              onClick={() => triggerPhoto('general')}
              onFolder={() => triggerPhotoFolder('general')}
              disabled={!!batch}
              done={photoSatisfied}
            />
            <UploadProgress batch={batch} />
          </div>
        )}

        {screen.kind === 'photofield' && (
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 19, color: C.textPrimary, marginBottom: 6 }}>
              {fieldPrompt(screen.field)}
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>
              {screen.field.required ? 'Required' : 'Optional — skip if not applicable.'}
            </div>
            {screen.field.illustration && (
              <div style={{ marginBottom: 14 }}>
                {/* Tapping the example opens the camera — same action as Take Photo. */}
                <button
                  onClick={() => triggerPhoto(screen.field.name)}
                  disabled={!!batch}
                  style={{
                    appearance: 'none', cursor: 'pointer', display: 'block', width: '100%',
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: 0, overflow: 'hidden',
                  }}
                  aria-label="Take photo like this example"
                >
                  <img src={screen.field.illustration} alt={`Example — ${screen.field.label}`}
                    style={{ display: 'block', width: '100%', maxHeight: '56dvh', objectFit: 'contain', background: '#ffffff' }} />
                  <span style={{
                    display: 'block', padding: '7px 10px', borderTop: `1px solid ${C.border}`,
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textSecondary,
                    background: C.cardSecondary, textAlign: 'center',
                  }}>
                    Example — take your photo like this · tap to open the camera
                  </span>
                </button>
                <button
                  onClick={() => setExampleZoom(screen.field.illustration)}
                  style={{
                    appearance: 'none', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'block', margin: '6px auto 0', padding: 4,
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textMuted,
                    textDecoration: 'underline',
                  }}
                >
                  View example full screen
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: 'none' }} />
            <input ref={folderRef} type="file" accept="image/*" multiple onChange={onFile} style={{ display: 'none' }} />
            <CaptureBtn
              label={curPhotoN > 0 ? 'Add / Retake Photo' : 'Take Photo'}
              onClick={() => triggerPhoto(screen.field.name)}
              onFolder={() => triggerPhotoFolder(screen.field.name)}
              disabled={!!batch}
              done={curPhotoN > 0}
            />
            <UploadProgress batch={batch} />
            {screen.field.allow_not_present && curPhotoN === 0 && (
              fieldMarkedNotPresent(screen.field)
                ? <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: C.emeraldMid, textAlign: 'center' }}>
                    Marked “Not present.” Take a photo above to override.
                  </div>
                : <button
                    onClick={markNotPresent}
                    disabled={busy}
                    style={{
                      appearance: 'none', background: 'none', border: 'none', cursor: 'pointer',
                      display: 'block', margin: '12px auto 0', padding: 6,
                      fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: C.textMuted, textDecoration: 'underline',
                    }}
                  >
                    This item isn’t present here — mark Not Present
                  </button>
            )}
            {photosOfType(screen.field.name).length > 0 && (
              <div style={{ marginTop: 12 }}>
                <PhotoStrip
                  photos={photosOfType(screen.field.name)}
                  label={screen.field.label || null}
                  pending={batch ? Math.max(0, batch.total - batch.done) : 0}
                  onFlash={onFlash}
                />
              </div>
            )}
          </div>
        )}

        {screen.kind === 'field' && (
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 19, color: C.textPrimary, marginBottom: 6 }}>
              {fieldPrompt(screen.field)}
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>
              {screen.field.required ? 'Required' : 'Optional — skip if not applicable.'}
            </div>
            {(() => {
              const common = {
                key: screen.field.field_id,
                field: screen.field,
                stepId: live.work_step_id,
                disabled: busy,
                embedded: true,
                onValue: (v) => setPending((p) => ({ ...p, [screen.field.field_id]: v })),
                onError: (m) => onFlash(m, 'error'),
              }
              if (screen.field.type === 'user_multiselect') return <StepUserMultiselect {...common} />
              if (screen.field.type === 'key_source') return <StepKeySource {...common} woId={woId} />
              if (screen.field.type === 'select') return <StepSelectField {...common} />
              if (screen.field.type === 'vehicle') return <StepVehicleField {...common} />
              return <StepFieldInput {...common} />
            })()}
          </div>
        )}

        {screen.kind === 'review' && (
          <div>
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 19, color: C.textPrimary, marginBottom: 4 }}>
              Review &amp; save
            </div>
            <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 14 }}>
              Tap any row to go back and enter or change its data.
            </div>
            {photoNeeded && (
              <button
                onClick={() => jumpTo(0)}
                style={{
                  ...card, width: '100%', appearance: 'none', cursor: 'pointer', textAlign: 'left',
                  padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12, fontSize: 14,
                }}
              >
                <span style={{ color: C.textSecondary }}>Photo</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, color: photoSatisfied ? C.emeraldMid : C.amber }}>
                    {photoCount} captured{photoSatisfied ? ' ✓' : ''}
                  </span>
                  <ReviewChevron />
                </span>
              </button>
            )}
            {fields.map((f) => {
              const isPhoto = f.type === 'photo'
              const n = isPhoto ? photosOfType(f.name).length : 0

              // Calculated field: derived, read-only, no screen to jump to.
              if (f.calculated) {
                const cv = calcValue(f)
                return (
                  <div key={f.field_id} style={{ ...card, padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 14, background: C.cardSecondary }}>
                    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
                      <span style={{ color: C.textSecondary }}>{f.label}</span>
                      <span style={{ fontSize: 11, color: C.textMuted }}>Calculated automatically</span>
                    </span>
                    <span style={{ fontFamily: MONO, fontWeight: 700, textAlign: 'right', color: cv != null ? C.textPrimary : C.textMuted }}>
                      {cv != null ? `${cv}${f.unit ? ` ${f.unit}` : ''}` : '—'}
                    </span>
                  </div>
                )
              }

              const notPresent = isPhoto && fieldMarkedNotPresent(f)
              const has = isPhoto ? (n > 0 || notPresent) : fieldHasValue(f)
              const val = f.numeric_value ?? f.text_value
              const color = has ? C.textPrimary : (f.required ? C.amber : C.textMuted)
              return (
                <button
                  key={f.field_id}
                  onClick={() => jumpTo(screenIndexForField(f.field_id))}
                  style={{
                    ...card, width: '100%', appearance: 'none', cursor: 'pointer', textAlign: 'left',
                    padding: '10px 12px', marginBottom: 8, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 12, fontSize: 14,
                  }}
                >
                  <span style={{ color: C.textSecondary }}>{f.label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontWeight: 700, textAlign: 'right', color }}>
                      {has
                        ? (isPhoto ? (n > 0 ? `${n} captured` : 'not present') : `${val}${f.unit ? ` ${f.unit}` : ''}`)
                        : (f.required ? (isPhoto ? 'photo required' : 'required') : '—')}
                    </span>
                    <ReviewChevron />
                  </span>
                </button>
              )
            })}
            {live.evidence_gap && (
              <div style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>{live.evidence_gap}</div>
            )}
          </div>
        )}
      </div>

      {/* Example illustration, enlarged */}
      {exampleZoom && (
        <div
          onClick={() => setExampleZoom(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(7,17,31,0.92)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 16, gap: 14, cursor: 'pointer',
          }}
        >
          <img src={exampleZoom} alt="Example"
            style={{ width: '100%', maxWidth: 520, maxHeight: '78dvh', objectFit: 'contain', background: '#ffffff', borderRadius: 10 }} />
          <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
            Tap anywhere to close
          </span>
        </div>
      )}

      {/* Bottom nav */}
      <div style={{
        display: 'flex', gap: 10, padding: '12px 14px calc(env(safe-area-inset-bottom) + 12px)',
        background: C.card, borderTop: `1px solid ${C.border}`, flexShrink: 0,
      }}>
        <button onClick={clampedIdx === 0 ? onClose : back} disabled={busy} style={{ ...btnSecondary, flex: '0 0 40%' }}>
          {clampedIdx === 0 ? 'Close' : 'Back'}
        </button>
        {screen.kind === 'review' ? (
          <button onClick={finish} disabled={busy || !!live.evidence_gap}
            style={(busy || !!live.evidence_gap) ? { ...btnDisabled, flex: 1 } : { ...btnPrimary, flex: 1 }}
            title={live.evidence_gap || undefined}>
            {busy ? 'Saving…' : `Save ${live.name}`}
          </button>
        ) : (
          <button onClick={screen.kind === 'field' ? advanceField : next} disabled={continueDisabled}
            style={continueDisabled ? { ...btnDisabled, flex: 1 } : { ...btnPrimary, flex: 1 }}>
            {busy && screen.kind === 'field' ? 'Saving…' : (fieldSkippable ? 'Skip' : 'Continue')}
          </button>
        )}
      </div>
    </div>
  )
}
