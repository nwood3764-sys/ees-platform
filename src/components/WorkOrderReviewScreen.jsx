import { useState, useEffect, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from './UI'
import { useToast } from './Toast'
import {
  fetchReviewDetail, fetchReviewLayout, resolveLayoutFieldValues,
  reviewWorkStep, completeWorkOrderReview, signedEvidenceUrls,
} from '../data/workOrderReviewService'

// ---------------------------------------------------------------------------
// WorkOrderReviewScreen — the Project Coordinator's desktop review of a
// submitted work order. Record fields come from the resolved Review Page
// Layout for the work order's record type (admin-manageable, never
// hardcoded); below them, every work step renders with its photo/video/
// measurement evidence and takes a per-step Approve / Needs Correction
// decision. The footer completes the review: Verify Work Order (all
// applicable steps approved) or Send Back for Corrections (comment required).
// Palette: emerald approve, sky/navy for corrections — no red/orange.
// ---------------------------------------------------------------------------

const APPROVE_GREEN = { bg: '#e8f8f2', border: '#b8e8d0', text: '#1a7a4e' }
const CORRECTION_SKY = { bg: '#e8f1fb', border: '#bcd9f2', text: '#1e466b' }

function DecisionChip({ decision }) {
  if (!decision) return <span style={{ fontSize: 11, color: C.textMuted }}>Not reviewed</span>
  const s = decision === 'Approved' ? APPROVE_GREEN : CORRECTION_SKY
  const label = decision === 'Approved' ? 'Approved' : 'Needs Correction'
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
      {label}
    </span>
  )
}

function StatusChip({ status }) {
  const done = ['completed', 'verified'].some(k => (status || '').toLowerCase().includes(k))
  const na = (status || '').toLowerCase().includes('not applicable')
  const s = done ? APPROVE_GREEN : na ? { bg: C.page, border: C.border, text: C.textMuted } : CORRECTION_SKY
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10 }}>
      {status || '—'}
    </span>
  )
}

function LayoutFields({ fieldGroups, values }) {
  if (!fieldGroups?.length) return null
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      {fieldGroups.map((group, gi) => (
        <div key={gi}>
          <div style={{ padding: '11px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
            {group.title || 'Details'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px 24px', padding: '14px 16px' }}>
            {group.fields.map(f => (
              <div key={f.name} style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
                <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{f.label || f.name}</div>
                <div style={{ fontSize: 13, color: C.textPrimary, whiteSpace: f.type === 'textarea' ? 'pre-wrap' : 'normal' }}>
                  {values?.[f.name] ?? <span style={{ color: C.textMuted }}>—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StepEvidence({ step, urls }) {
  const photos = step.photos || []
  const videos = step.videos || []
  const fields = step.fields || []
  return (
    <>
      {fields.length > 0 && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
          {fields.map(f => (
            <div key={f.field_id} style={{ background: C.cardSecondary || '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6, padding: '7px 12px' }}>
              <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{f.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>
                {f.numeric_value ?? f.text_value ?? <span style={{ color: C.textMuted, fontWeight: 400 }}>not recorded</span>}
                {f.unit && (f.numeric_value != null) && <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 4, fontWeight: 400 }}>{f.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {photos.map(p => {
            const url = urls.get(`${p.bucket}/${p.path}`)
            return (
              <a key={p.id} href={url || undefined} target="_blank" rel="noreferrer"
                style={{ display: 'block', width: 110, height: 110, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}`, background: C.page, position: 'relative' }}>
                {url
                  ? <img src={url} alt={p.photo_type || 'evidence photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: C.textMuted }}>Loading…</span>}
                {(p.latitude == null || p.longitude == null) && (
                  <span title="No GPS location on this photo" style={{ position: 'absolute', top: 4, right: 4, background: '#e8f1fb', border: '1px solid #bcd9f2', color: '#1e466b', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 8 }}>No GPS</span>
                )}
              </a>
            )
          })}
        </div>
      )}
      {videos.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          {videos.map(v => {
            const url = urls.get(`${v.bucket}/${v.path}`)
            return url
              ? <video key={v.id} src={url} controls preload="metadata" style={{ width: 240, maxHeight: 180, borderRadius: 6, border: `1px solid ${C.border}`, background: '#000' }} />
              : <span key={v.id} style={{ fontSize: 11, color: C.textMuted }}>Loading video…</span>
          })}
        </div>
      )}
      {photos.length === 0 && videos.length === 0 && fields.length === 0 && (
        <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>No evidence attached to this step.</div>
      )}
    </>
  )
}

function StepCard({ step, urls, busy, onDecide, reviewable }) {
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const isNa = (step.status || '').toLowerCase().includes('not applicable')
  const decision = step.pc_approval_status || null

  return (
    <div style={{ background: C.card, border: `1px solid ${decision === 'Rejected' ? CORRECTION_SKY.border : C.border}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
          {String(step.execution_order ?? '').padStart(2, '0')}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, flex: 1, minWidth: 200 }}>{step.name}</span>
        <StatusChip status={step.status} />
        <DecisionChip decision={decision} />
      </div>
      <div style={{ padding: '12px 16px' }}>
        {step.description && <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 10, whiteSpace: 'pre-wrap' }}>{step.description}</div>}
        {isNa && (
          <div style={{ background: C.page, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: C.textSecondary }}>
            <strong style={{ color: C.textPrimary }}>Marked Not Applicable:</strong> {step.not_applicable_reason || 'no reason recorded'}
          </div>
        )}
        <StepEvidence step={step} urls={urls} />
        {step.pc_comment && (
          <div style={{ background: CORRECTION_SKY.bg, border: `1px solid ${CORRECTION_SKY.border}`, borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: CORRECTION_SKY.text }}>
            <strong>Reviewer comment:</strong> {step.pc_comment}
          </div>
        )}
        {reviewable && !isNa && (
          rejecting ? (
            <div style={{ marginTop: 4 }}>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="What needs to be corrected on this step? The technician sees this comment in LEAP Pad."
                rows={2}
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.borderDark || C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 12.5, fontFamily: 'Inter, sans-serif', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button disabled={busy || !comment.trim()} onClick={() => { onDecide(step, false, comment.trim()); setRejecting(false); setComment('') }}
                  style={{ background: comment.trim() ? '#1e466b' : C.page, color: comment.trim() ? '#fff' : C.textMuted, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: comment.trim() ? 'pointer' : 'not-allowed' }}>
                  Save — Needs Correction
                </button>
                <button disabled={busy} onClick={() => { setRejecting(false); setComment('') }}
                  style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button disabled={busy || decision === 'Approved'} onClick={() => onDecide(step, true, null)}
                style={{ background: decision === 'Approved' ? APPROVE_GREEN.bg : C.emerald, color: decision === 'Approved' ? APPROVE_GREEN.text : '#fff', border: decision === 'Approved' ? `1px solid ${APPROVE_GREEN.border}` : 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: decision === 'Approved' ? 'default' : 'pointer' }}>
                {decision === 'Approved' ? 'Approved' : 'Approve Step'}
              </button>
              <button disabled={busy} onClick={() => setRejecting(true)}
                style={{ background: C.page, color: '#1e466b', border: `1px solid #bcd9f2`, borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Needs Correction…
              </button>
            </div>
          )
        )}
      </div>
    </div>
  )
}

export default function WorkOrderReviewScreen({ workOrderId, onBack, onOpenRecord }) {
  const toast = useToast()
  const [detail, setDetail] = useState(null)
  const [fieldGroups, setFieldGroups] = useState([])
  const [fieldValues, setFieldValues] = useState({})
  const [urls, setUrls] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [sendBackComment, setSendBackComment] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const d = await fetchReviewDetail(workOrderId)
      setDetail(d)
      const layout = await fetchReviewLayout('work_orders', d.header?.record_type_id).catch(() => null)
      if (layout?.fieldGroups?.length) {
        setFieldGroups(layout.fieldGroups)
        setFieldValues(await resolveLayoutFieldValues(layout.fieldGroups, d.record).catch(() => ({})))
      } else {
        setFieldGroups([])
      }
      const items = []
      for (const s of d.steps || []) {
        for (const p of s.photos || []) items.push({ bucket: p.bucket, path: p.path })
        for (const v of s.videos || []) items.push({ bucket: v.bucket, path: v.path })
      }
      setUrls(await signedEvidenceUrls(items))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [workOrderId])

  useEffect(() => { setLoading(true); load() }, [load])

  const header = detail?.header
  const steps = detail?.steps || []
  const reviewable = header?.work_order_status === 'To Be Verified'

  const counts = useMemo(() => {
    const applicable = steps.filter(s => !(s.status || '').toLowerCase().includes('not applicable'))
    return {
      total: applicable.length,
      approved: applicable.filter(s => s.pc_approval_status === 'Approved').length,
      rejected: applicable.filter(s => s.pc_approval_status === 'Rejected').length,
      na: steps.length - applicable.length,
    }
  }, [steps])

  const decide = async (step, approved, comment) => {
    setBusy(true)
    try {
      await reviewWorkStep(step.work_step_id, approved, comment)
      await load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const finish = async (outcome, comment) => {
    setBusy(true)
    try {
      const res = await completeWorkOrderReview(workOrderId, outcome, comment)
      toast.success(`Work order ${header?.work_order_record_number} is now ${res.status}`)
      setSendBackOpen(false)
      setSendBackComment('')
      await load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} onRetry={() => { setLoading(true); load() }} />
  if (!header) return null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px 120px', background: C.page }}>
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <button onClick={onBack} style={{ width: 30, height: 30, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon path="M15 19l-7-7 7-7" size={13} color={C.textSecondary} />
            </button>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.textMuted }}>{header.work_order_record_number}</span>
                <StatusChip status={header.work_order_status} />
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, margin: '2px 0 0' }}>{header.work_order_name}</h2>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                {[header.property_name, header.building, header.unit].filter(Boolean).join(' · ')}
                {header.technician_name ? ` · Technician: ${header.technician_name}` : ''}
              </div>
            </div>
            <button onClick={() => onOpenRecord?.({ table: 'work_orders', id: workOrderId, name: header.work_order_record_number })}
              style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              Open Record
            </button>
          </div>

          {header.reject_reason && header.work_order_status === 'Corrections Needed' && (
            <div style={{ background: CORRECTION_SKY.bg, border: `1px solid ${CORRECTION_SKY.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, color: CORRECTION_SKY.text }}>
              <strong>Sent back for corrections:</strong> {header.reject_reason}
            </div>
          )}

          <LayoutFields fieldGroups={fieldGroups} values={fieldValues} />

          <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 10px 2px' }}>
            Work Steps — {counts.approved}/{counts.total} approved{counts.rejected > 0 ? ` · ${counts.rejected} need correction` : ''}{counts.na > 0 ? ` · ${counts.na} N/A` : ''}
          </div>
          {steps.map(s => (
            <StepCard key={s.work_step_id} step={s} urls={urls} busy={busy} onDecide={decide} reviewable={reviewable} />
          ))}
        </div>
      </div>

      {reviewable && (
        <div style={{ flexShrink: 0, background: C.card, borderTop: `1px solid ${C.border}`, padding: '12px 24px' }}>
          <div style={{ maxWidth: 980, margin: '0 auto' }}>
            {sendBackOpen ? (
              <div>
                <textarea
                  value={sendBackComment}
                  onChange={e => setSendBackComment(e.target.value)}
                  placeholder="Overall reason for sending this work order back. The technician receives this with the flagged steps."
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.borderDark || C.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 12.5, fontFamily: 'Inter, sans-serif', resize: 'vertical', marginBottom: 8 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy || !sendBackComment.trim()} onClick={() => finish('corrections_needed', sendBackComment.trim())}
                    style={{ background: sendBackComment.trim() ? '#1e466b' : C.page, color: sendBackComment.trim() ? '#fff' : C.textMuted, border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: sendBackComment.trim() ? 'pointer' : 'not-allowed' }}>
                    Send Back for Corrections
                  </button>
                  <button disabled={busy} onClick={() => setSendBackOpen(false)}
                    style={{ background: C.page, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button disabled={busy || counts.approved < counts.total || counts.rejected > 0} onClick={() => finish('verified', null)}
                  title={counts.approved < counts.total ? 'Approve every applicable step first' : counts.rejected > 0 ? 'Steps are flagged for correction — send back instead' : ''}
                  style={{ background: (counts.approved === counts.total && counts.rejected === 0) ? C.emerald : C.page, color: (counts.approved === counts.total && counts.rejected === 0) ? '#fff' : C.textMuted, border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: (counts.approved === counts.total && counts.rejected === 0) ? 'pointer' : 'not-allowed' }}>
                  Verify Work Order
                </button>
                <button disabled={busy} onClick={() => setSendBackOpen(true)}
                  style={{ background: C.card, color: '#1e466b', border: `1px solid #bcd9f2`, borderRadius: 6, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  Send Back for Corrections…
                </button>
                <span style={{ fontSize: 12, color: C.textMuted }}>
                  {counts.approved}/{counts.total} steps approved{counts.rejected > 0 ? ` — ${counts.rejected} flagged` : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
