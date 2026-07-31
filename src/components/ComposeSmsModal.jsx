// ─── ComposeSmsModal ───────────────────────────────────────────────────────
// Start a new outbound SMS thread from a record's SMS conversation panel.
// Sends through send-notification-sms (Twilio) via sendNewSms, which threads
// the message onto the account/contact so it appears in the panel below and
// inbound replies auto-thread. Runs in mock mode until Twilio is configured.
//
// Deliberately lightweight vs. ComposeEmailModal (no mailbox/subject/HTML) —
// SMS is a phone number + up to 1600 plain-text characters.

import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { useToast } from './Toast'
import { sendNewSms, normalizePhoneE164 } from '../data/conversationsService'

const SMS_MAX = 1600

export default function ComposeSmsModal({
  open, onClose, onSent,
  defaultToPhone = null, recipientName = null,
  accountId = null, contactId = null, projectId = null, serviceAppointmentId = null,
}) {
  const toast = useToast()
  const [toPhone, setToPhone] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bodyRef = useRef(null)

  // Reset the form each time the modal opens, seeding the recipient phone.
  useEffect(() => {
    if (open) {
      setToPhone(defaultToPhone || '')
      setBody('')
      setSending(false)
      setTimeout(() => bodyRef.current?.focus(), 40)
    }
  }, [open, defaultToPhone])

  if (!open) return null

  const normalized = normalizePhoneE164(toPhone)
  const phoneOk = !!normalized
  const canSend = phoneOk && body.trim().length > 0 && body.length <= SMS_MAX && !sending

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const res = await sendNewSms({
        toPhone, bodyText: body,
        accountId, contactId, projectId, serviceAppointmentId,
      })
      toast.success(res?.mode === 'mock'
        ? 'Text queued (mock mode — Twilio not configured)'
        : 'Text sent')
      onSent?.({ conversationId: res?.conversation_id || null })
      onClose?.()
    } catch (e) {
      if (e?.code === 'bad_phone') toast.error('Enter a valid US mobile number (e.g. 555-123-4567).')
      else toast.error(e?.message || 'Text failed to send')
      setSending(false)
    }
  }

  const lab = { fontSize: 11.5, fontWeight: 600, color: C.textSecondary, display: 'block', marginBottom: 5 }
  const inp = { width: '100%', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', color: C.textPrimary }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 10, width: 480, maxWidth: '94vw', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>New Text{recipientName ? ` · ${recipientName}` : ''}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={lab}>To (mobile number)</label>
            <input style={{ ...inp, borderColor: toPhone && !phoneOk ? C.sky : C.borderDark }} value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="e.g. 555-123-4567" inputMode="tel" />
            {toPhone && !phoneOk && <div style={{ fontSize: 11.5, color: '#1a5a8a', marginTop: 4 }}>That doesn't look like a valid US mobile number.</div>}
            {phoneOk && <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>Sending to {normalized}</div>}
          </div>
          <div>
            <label style={lab}>Message</label>
            <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={5}
              placeholder="Type your text message…"
              style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 11.5, color: body.length > SMS_MAX ? '#1a5a8a' : C.textMuted }}>
              <span>Replies thread back here automatically.</span>
              <span>{body.length} / {SMS_MAX}</span>
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button disabled={!canSend} onClick={send} style={{ padding: '8px 18px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.55 }}>
            {sending ? 'Sending…' : 'Send text'}
          </button>
        </div>
      </div>
    </div>
  )
}
