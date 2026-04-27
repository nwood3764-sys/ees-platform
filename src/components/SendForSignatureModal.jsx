// =============================================================================
// SendForSignatureModal
//
// 3-step modal for creating an envelope from a parent record:
//   1. Pick an Active document_templates row whose related_object matches
//      the parent (or is NULL = compatible with anything)
//   2. Edit recipients — at minimum one signer; each row needs name + email,
//      role and order are optional. The order field defaults to row index
//      and is editable
//   3. Set subject + message, then submit
//
// On submit, calls the send-envelope edge function. The function:
//   - creates the envelope row + recipients + tabs
//   - renders the merged PDF (using the latest snapshot of the template)
//   - returns the magic-link signing URLs for each recipient
//
// Email delivery is not wired yet — we show the signing URLs after send
// so the user can copy/paste into their own email until SMTP integration
// lands.
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import { useToast } from './Toast'

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export default function SendForSignatureModal({ open, parentObject, parentRecordId, parentRecordLabel, onClose }) {
  const toast = useToast()

  // ── Modal state machine ─────────────────────────────────────────────
  // step: 'pick' | 'recipients' | 'review' | 'sending' | 'sent'
  const [step, setStep] = useState('pick')
  const [templates, setTemplates] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const [chosenTemplateId, setChosenTemplateId] = useState('')
  const [recipients, setRecipients] = useState([{ name: '', email: '', role: 'Signer', order: 1 }])
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sendResult, setSendResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // ── Reset on reopen ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    setStep('pick')
    setTemplates(null)
    setLoadError(null)
    setChosenTemplateId('')
    setRecipients([{ name: '', email: '', role: 'Signer', order: 1 }])
    setSubject('')
    setMessage('')
    setSendResult(null)
    setSubmitting(false)
  }, [open])

  // ── Load templates ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('document_templates')
          .select(`
            id, name, description, dt_record_number, related_object,
            authoring:dt_authoring_mode ( picklist_value ),
            status:status ( picklist_value )
          `)
          .eq('is_deleted', false)
          .order('name')
        if (error) throw error
        if (cancelled) return
        const filtered = (data || []).filter(t =>
          t.status?.picklist_value === 'Active'
          && (!t.related_object || t.related_object === parentObject)
        )
        setTemplates(filtered)
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load templates')
      }
    })()
    return () => { cancelled = true }
  }, [open, parentObject])

  // ── Auto-set subject when template is picked ────────────────────────
  useEffect(() => {
    if (!chosenTemplateId || !templates) return
    const tpl = templates.find(t => t.id === chosenTemplateId)
    if (!tpl) return
    if (!subject) setSubject(`Please sign: ${tpl.name}`)
  }, [chosenTemplateId, templates, subject])

  // ── Recipient editing ───────────────────────────────────────────────
  const addRecipient = () => setRecipients(rs => [...rs, { name: '', email: '', role: 'Signer', order: rs.length + 1 }])
  const removeRecipient = (i) => setRecipients(rs => {
    if (rs.length === 1) return rs
    const next = rs.filter((_, idx) => idx !== i)
    return next.map((r, idx) => ({ ...r, order: idx + 1 }))
  })
  const updateRecipient = (i, field, value) => setRecipients(rs => rs.map((r, idx) => idx === i ? { ...r, [field]: value } : r))

  // ── Submit ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    // Final validation
    for (const r of recipients) {
      if (!r.name?.trim())  { toast.error('Every recipient needs a name'); return }
      if (!r.email?.trim()) { toast.error(`Recipient "${r.name}" needs an email`); return }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email))  { toast.error(`"${r.email}" is not a valid email`); return }
    }
    const orders = new Set(recipients.map(r => r.order))
    if (orders.size !== recipients.length) { toast.error('Recipient order numbers must be unique'); return }

    setSubmitting(true)
    setStep('sending')
    try {
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const resp = await fetch(`${FN_BASE}/send-envelope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          document_template_id: chosenTemplateId,
          parent_object: parentObject,
          parent_record_id: parentRecordId,
          recipients: recipients.map(r => ({
            name: r.name.trim(), email: r.email.trim(), role: r.role || null, order: r.order,
          })),
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          signing_base_url: window.location.origin,
        }),
      })
      const body = await resp.json()
      if (!resp.ok) throw new Error(body.error || `Send failed (${resp.status})`)
      setSendResult(body)
      setStep('sent')
    } catch (e) {
      toast.error(e.message || 'Send failed')
      setStep('review')
    } finally {
      setSubmitting(false)
    }
  }, [chosenTemplateId, parentObject, parentRecordId, recipients, subject, message, toast])

  // ── Step navigation guards ──────────────────────────────────────────
  const canProceedFromPick = !!chosenTemplateId
  const canProceedFromRecipients = recipients.every(r => r.name?.trim() && r.email?.trim())

  if (!open) return null
  return (
    <div onClick={onClose} style={modalBackdropStyle}>
      <div onClick={e => e.stopPropagation()} style={modalCardStyle}>
        <header style={modalHeaderStyle}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.emerald, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Anura Signing</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary }}>Send for Signature</div>
            <div style={{ fontSize: 12, color: C.textSecondary }}>{parentRecordLabel || `${parentObject} ${parentRecordId.slice(0, 8)}`}</div>
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Close">×</button>
        </header>

        <Stepper step={step} />

        <div style={{ padding: '18px 22px', flex: 1, overflowY: 'auto' }}>
          {step === 'pick' && (
            <PickStep
              templates={templates}
              loadError={loadError}
              chosenTemplateId={chosenTemplateId}
              onPick={setChosenTemplateId}
              parentObject={parentObject}
            />
          )}
          {step === 'recipients' && (
            <RecipientsStep
              recipients={recipients}
              onAdd={addRecipient}
              onRemove={removeRecipient}
              onChange={updateRecipient}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              template={templates?.find(t => t.id === chosenTemplateId)}
              recipients={recipients}
              subject={subject}
              message={message}
              onSubject={setSubject}
              onMessage={setMessage}
            />
          )}
          {step === 'sending' && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
              Rendering merged PDF, scanning signature anchors, generating signing tokens…
            </div>
          )}
          {step === 'sent' && (
            <SentStep result={sendResult} />
          )}
        </div>

        <footer style={modalFooterStyle}>
          {step === 'pick' && (
            <>
              <span />
              <button onClick={() => setStep('recipients')} disabled={!canProceedFromPick} style={primaryBtn(canProceedFromPick)}>Next</button>
            </>
          )}
          {step === 'recipients' && (
            <>
              <button onClick={() => setStep('pick')} style={secondaryBtn}>Back</button>
              <button onClick={() => setStep('review')} disabled={!canProceedFromRecipients} style={primaryBtn(canProceedFromRecipients)}>Next</button>
            </>
          )}
          {step === 'review' && (
            <>
              <button onClick={() => setStep('recipients')} style={secondaryBtn}>Back</button>
              <button onClick={handleSend} disabled={submitting} style={primaryBtn(!submitting)}>
                {submitting ? 'Sending…' : 'Send for Signature'}
              </button>
            </>
          )}
          {step === 'sent' && (
            <>
              <span />
              <button onClick={onClose} style={primaryBtn(true)}>Done</button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

// ─── Step content ──────────────────────────────────────────────────────

function Stepper({ step }) {
  const steps = [
    { key: 'pick',       label: 'Template' },
    { key: 'recipients', label: 'Recipients' },
    { key: 'review',     label: 'Review' },
    { key: 'sent',       label: 'Sent' },
  ]
  // 'sending' shares position with 'sent' — collapse for display
  const stepDisplay = step === 'sending' ? 'sent' : step
  const idx = steps.findIndex(s => s.key === stepDisplay)
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, padding: '8px 22px', gap: 0 }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{
          flex: 1, padding: '10px 6px',
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: i === idx ? C.emerald : (i < idx ? C.textPrimary : C.textMuted),
          textAlign: 'center',
          borderBottom: `2px solid ${i === idx ? C.emerald : 'transparent'}`,
        }}>
          {i + 1}. {s.label}
        </div>
      ))}
    </div>
  )
}

function PickStep({ templates, loadError, chosenTemplateId, onPick, parentObject }) {
  if (loadError) return <div style={{ color: '#b03a2e', fontSize: 13 }}>{loadError}</div>
  if (templates === null) return <div style={{ color: C.textMuted, fontSize: 13 }}>Loading templates…</div>
  if (templates.length === 0) {
    return (
      <div style={{ padding: 18, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, fontSize: 13, color: '#92400e' }}>
        No Active document templates are available for <b>{parentObject}</b>. An admin needs to publish a template in Setup → Document Templates that targets this object (or has no related-object filter).
      </div>
    )
  }
  return (
    <>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 10 }}>
        Pick the document template to send. Only Active templates compatible with <b>{parentObject}</b> are shown.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map(t => (
          <label key={t.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12,
            border: `1px solid ${chosenTemplateId === t.id ? C.emerald : C.border}`,
            background: chosenTemplateId === t.id ? '#ecfdf5' : '#fff',
            borderRadius: 6, cursor: 'pointer', transition: 'all 120ms ease',
          }}>
            <input
              type="radio" name="tpl" value={t.id}
              checked={chosenTemplateId === t.id}
              onChange={() => onPick(t.id)}
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{t.name}</span>
                <span style={{ fontSize: 11, color: C.textMuted }}>{t.dt_record_number}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                  background: t.authoring?.picklist_value === 'docx' ? '#eff6ff' : '#fef9c3',
                  color: t.authoring?.picklist_value === 'docx' ? '#1e40af' : '#854d0e',
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>
                  {t.authoring?.picklist_value || 'unknown'}
                </span>
              </div>
              {t.description && <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4, lineHeight: 1.4 }}>{t.description}</div>}
            </div>
          </label>
        ))}
      </div>
    </>
  )
}

function RecipientsStep({ recipients, onAdd, onRemove, onChange }) {
  return (
    <>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
        Add the people who need to sign. They'll receive in order — recipient #1 signs first, then #2, etc. Anchors in the template (<code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>{`\\sig1\\`}</code>, <code style={{ background: '#f1f5f9', padding: '0 4px', borderRadius: 3 }}>{`\\initial2\\`}</code>) bind to recipients by their order.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recipients.map((r, i) => (
          <div key={i} style={{
            display: 'grid', gap: 8, gridTemplateColumns: '40px 1fr 1fr 130px 36px',
            padding: 10, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fafbfd',
            alignItems: 'center',
          }}>
            <input type="number" min="1" value={r.order} onChange={e => onChange(i, 'order', parseInt(e.target.value) || 1)}
              style={inputStyle} title="Sign order"/>
            <input type="text" placeholder="Name" value={r.name} onChange={e => onChange(i, 'name', e.target.value)} style={inputStyle}/>
            <input type="email" placeholder="Email" value={r.email} onChange={e => onChange(i, 'email', e.target.value)} style={inputStyle}/>
            <input type="text" placeholder="Role" value={r.role || ''} onChange={e => onChange(i, 'role', e.target.value)} style={inputStyle}/>
            <button
              onClick={() => onRemove(i)}
              disabled={recipients.length === 1}
              title="Remove"
              style={{
                background: 'transparent', border: 'none', color: C.textMuted, cursor: recipients.length === 1 ? 'not-allowed' : 'pointer',
                fontSize: 18, padding: 0, opacity: recipients.length === 1 ? 0.3 : 1,
              }}>×</button>
          </div>
        ))}
      </div>
      <button onClick={onAdd} style={{
        marginTop: 10, background: 'transparent', border: `1px dashed ${C.borderDark}`,
        color: C.textSecondary, padding: '8px 12px', fontSize: 12.5, borderRadius: 5, cursor: 'pointer', width: '100%',
      }}>+ Add recipient</button>
    </>
  )
}

function ReviewStep({ template, recipients, subject, message, onSubject, onMessage }) {
  return (
    <>
      <div style={{ marginBottom: 14, padding: 12, background: '#f1f5f9', borderRadius: 6, fontSize: 12.5, color: C.textPrimary }}>
        <div><b>Template:</b> {template?.name} ({template?.dt_record_number})</div>
        <div style={{ marginTop: 4 }}><b>Recipients:</b> {recipients.map(r => `${r.order}. ${r.name}`).join(' → ')}</div>
      </div>
      <label style={labelStyle}>Subject</label>
      <input type="text" value={subject} onChange={e => onSubject(e.target.value)} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
      <label style={{ ...labelStyle, marginTop: 12 }}>Message (optional)</label>
      <textarea
        value={message} onChange={e => onMessage(e.target.value)} rows={4}
        placeholder="A brief note for the recipients."
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      />
    </>
  )
}

function SentStep({ result }) {
  if (!result) return null
  const copyUrl = (url) => {
    try { navigator.clipboard.writeText(url) } catch {}
  }
  // Email send results from send-envelope v2 — one entry per recipient that
  // was attempted (currently only recipient #1; the rest get emailed by
  // signing-portal-submit when their predecessor signs).
  const emailResults = result.email_send_results || []
  const firstResult  = emailResults.find(r => r.order === 1) || null

  return (
    <>
      <div style={{ padding: 14, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, marginBottom: 14, fontSize: 13, color: '#065f46' }}>
        Envelope <b>{result.env_record_number}</b> created.
      </div>

      {/* Email send banner — green if Outlook delivered to recipient #1, amber
          if no Outlook connection (user can copy the URL below as fallback),
          red if the send attempt failed. */}
      {firstResult && firstResult.status === 'sent' && (
        <div style={{ padding: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, marginBottom: 14, fontSize: 12.5, color: '#065f46' }}>
          ✓ Signing request emailed to <b>{(result.signing_urls || []).find(u => u.order === 1)?.email || 'recipient'}</b> via your Outlook. A copy is saved on this record.
          {result.signing_urls?.length > 1 && ' The next signer will be emailed automatically when this one completes.'}
        </div>
      )}
      {firstResult && firstResult.status === 'not_connected' && (
        <div style={{ padding: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, marginBottom: 14, fontSize: 12.5, color: '#92400e' }}>
          <b>Outlook isn't connected.</b> Copy the signing link below and send it manually. Connect Outlook from the user menu (Integrations) so future signing requests email out automatically.
        </div>
      )}
      {firstResult && firstResult.status === 'failed' && (
        <div style={{ padding: 10, background: '#fdecea', border: '1px solid #f3b9b3', borderRadius: 6, marginBottom: 14, fontSize: 12.5, color: '#8a2c20' }}>
          <b>Email send failed.</b> Copy the signing link below and send it manually. {firstResult.failure_reason && <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, fontFamily: 'monospace' }}>{firstResult.failure_reason}</span>}
        </div>
      )}

      {result.dropped_anchors?.length > 0 && (
        <div style={{ padding: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, marginBottom: 14, fontSize: 12.5, color: '#92400e' }}>
          <b>Note:</b> {result.dropped_anchors.length} anchor{result.dropped_anchors.length === 1 ? ' was' : 's were'} skipped because no recipient matched their order: {result.dropped_anchors.join(', ')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(result.signing_urls || []).map(u => (
          <div key={u.recipient_id} style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{u.order}. {u.name}</div>
              <div style={{ fontSize: 12, color: C.textSecondary }}>{u.email}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                readOnly value={u.signing_url}
                style={{ ...inputStyle, flex: 1, fontSize: 11, fontFamily: 'monospace' }}
                onFocus={e => e.target.select()}
              />
              <button onClick={() => copyUrl(u.signing_url)} style={{
                background: C.emerald, border: 'none', color: '#fff', padding: '6px 12px',
                fontSize: 12, fontWeight: 500, borderRadius: 4, cursor: 'pointer',
              }}>Copy</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── styles ────────────────────────────────────────────────────────────

const modalBackdropStyle = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 12,
}
const modalCardStyle = {
  background: '#fff', borderRadius: 10, width: '100%', maxWidth: 640, maxHeight: '90vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 40px rgba(0,0,0,0.30)',
}
const modalHeaderStyle = {
  padding: '16px 22px',
  borderBottom: `1px solid ${C.border}`,
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
}
const modalFooterStyle = {
  borderTop: `1px solid ${C.border}`, padding: '12px 22px',
  display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
}
const closeBtnStyle = {
  background: 'transparent', border: 'none', fontSize: 28, lineHeight: 1, cursor: 'pointer',
  color: C.textMuted, padding: '0 4px',
}
const inputStyle = {
  padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 5, background: '#fff', color: C.textPrimary,
}
const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary,
  letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 5,
}
const primaryBtn = (enabled) => ({
  background: enabled ? C.emerald : C.textMuted,
  border: 'none', color: '#fff', padding: '9px 20px', fontSize: 13, fontWeight: 600,
  borderRadius: 5, cursor: enabled ? 'pointer' : 'not-allowed',
})
const secondaryBtn = {
  background: '#fff', border: `1px solid ${C.borderDark}`, color: C.textSecondary,
  padding: '9px 18px', fontSize: 13, borderRadius: 5, cursor: 'pointer',
}
