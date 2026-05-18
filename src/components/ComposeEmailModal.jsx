// =============================================================================
// ComposeEmailModal
//
// MVP compose-email modal for the Communications Module v1 (Slice 2).
//
// Free-form compose only — no template selection in this version. Template-
// driven compose with locked-region rendering and TipTap editor lands in
// Slice 4 (rich-text editor integration).
//
// The modal sits behind the Conversation Panel's "New Email" button. The
// caller passes the anchor record (object + id) plus an optional recipient
// prefill (used when the parent record is a Contact and we already know the
// email address). On submit, calls the conversationsService.sendNewEmail
// helper which invokes send-email-v1.
//
// Mock mode is the active state in production today (Graph credentials not
// yet scoped to the shared mailboxes). The edge function still writes the
// messages + conversations rows so the new thread surfaces immediately on
// the Conversation Panel's related list — the only thing skipped is the
// actual Graph sendMail HTTP call.
//
// On successful send, the modal closes and the caller is notified via
// onSent so it can refresh the thread list and optionally select the new
// thread.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  fetchOutboundMailboxes,
  sendNewEmail,
} from '../data/conversationsService'

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(13, 26, 46, 0.55)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '48px 16px',
  zIndex: 1000,
  overflowY: 'auto',
}

const MODAL_STYLE = {
  background: C.card,
  borderRadius: 10,
  width: '100%',
  maxWidth: 640,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  border: `1px solid ${C.borderDark || C.border}`,
  overflow: 'hidden',
  fontSize: 13,
  color: C.textPrimary,
}

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  background: '#fafbfd',
  borderBottom: `1px solid ${C.border}`,
}

const FIELD_LABEL = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  color: C.textSecondary,
  marginBottom: 4,
  display: 'block',
}

const INPUT_STYLE = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  background: C.card,
  color: C.textPrimary,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const FOOTER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 18px',
  background: '#fafbfd',
  borderTop: `1px solid ${C.border}`,
  gap: 10,
}

const BUTTON_PRIMARY = {
  background: C.emerald || '#3ecf8e',
  color: '#fff',
  border: 'none',
  borderRadius: 5,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

const BUTTON_SECONDARY = {
  background: C.card,
  color: C.textSecondary,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

export default function ComposeEmailModal({
  open,
  onClose,
  onSent,
  anchorObject,
  anchorRecordId,
  defaultRecipientEmail = '',
  defaultRecipientName = '',
  defaultContactId = null,
}) {
  const toast = useToast()

  const [mailboxes, setMailboxes] = useState(null)   // null = loading, [] = none, [...] = ready
  const [mailboxError, setMailboxError] = useState(null)
  const [mailboxId, setMailboxId] = useState('')

  const [toEmail, setToEmail] = useState('')
  const [toName, setToName]   = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState(null)  // payload from edge fn on success

  // ── Reset state when the modal opens ────────────────────────────────
  useEffect(() => {
    if (!open) return
    setToEmail(defaultRecipientEmail || '')
    setToName(defaultRecipientName || '')
    setSubject('')
    setBodyText('')
    setLastResult(null)
    setMailboxes(null)
    setMailboxError(null)
    setMailboxId('')
  }, [open, defaultRecipientEmail, defaultRecipientName])

  // ── Load mailboxes once per open ────────────────────────────────────
  useEffect(() => {
    if (!open) return
    let alive = true
    fetchOutboundMailboxes()
      .then(rows => {
        if (!alive) return
        setMailboxes(rows)
        // Default selection: first active mailbox (no state heuristic yet —
        // user can change via dropdown if it's not the right one)
        if (rows.length > 0) setMailboxId(rows[0].id)
      })
      .catch(err => {
        if (alive) setMailboxError(err.message || String(err))
      })
    return () => { alive = false }
  }, [open])

  // ── Submit ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (submitting) return
    if (!anchorObject || !anchorRecordId) {
      toast.error('No anchor record — cannot send.')
      return
    }
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      toast.error('Recipient email is not a valid address.')
      return
    }
    if (!subject.trim()) {
      toast.error('Subject is required.')
      return
    }
    if (!bodyText.trim()) {
      toast.error('Message body is empty.')
      return
    }
    if (!mailboxId) {
      toast.error('Pick an outbound mailbox before sending.')
      return
    }

    setSubmitting(true)
    try {
      const result = await sendNewEmail({
        anchorObject,
        anchorRecordId,
        to: { email: toEmail.trim(), name: toName.trim() || undefined },
        subject: subject.trim(),
        bodyText: bodyText.trim(),
        outboundMailboxId: mailboxId,
        contactId: defaultContactId || undefined,
      })
      setLastResult(result)
      const isMock = result?.mode === 'mock'
      toast.success(isMock
        ? 'Email queued in mock mode — Graph credentials not yet configured. Row written to messages.'
        : `Email sent (${result?.msg_record_number || 'queued'}).`)
      // Hand the new conversation id back to the panel so it can refresh +
      // optionally select the new thread.
      if (onSent && result?.conversation_id) {
        onSent({
          conversationId: result.conversation_id,
          messageId: result.message_id,
          mode: result.mode,
        })
      }
      // Close after a short pause so the toast is visible
      setTimeout(() => {
        if (onClose) onClose()
      }, 150)
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSubmitting(false)
    }
  }, [
    anchorObject, anchorRecordId, bodyText, defaultContactId,
    mailboxId, onClose, onSent, subject, submitting, toEmail, toName, toast,
  ])

  if (!open) return null

  return (
    <div
      style={OVERLAY_STYLE}
      onClick={(e) => {
        // Click outside closes — except while submitting
        if (e.target === e.currentTarget && !submitting && onClose) onClose()
      }}
    >
      <div style={MODAL_STYLE} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={HEADER_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 5,
              background: '#e8f3fb',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon
                path="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6"
                size={14}
                color="#1a5a8a"
              />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>New Email</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                Anchored to {anchorObject || '—'} · {anchorRecordId ? anchorRecordId.slice(0, 8) : '—'}
              </div>
            </div>
          </div>
          <button
            onClick={() => !submitting && onClose && onClose()}
            disabled={submitting}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.textMuted, padding: 4, opacity: submitting ? 0.4 : 1,
            }}
            title="Close"
          >
            <Icon path="M6 6l12 12 M6 18l12-12" size={16} color="currentColor" />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Mailbox picker */}
          <div>
            <label style={FIELD_LABEL}>From</label>
            {mailboxError && (
              <div style={{
                padding: 8, fontSize: 12, color: '#8a1a1a',
                background: '#fce8e8', border: `1px solid #f3c8c8`,
                borderRadius: 5,
              }}>
                Failed to load mailboxes: {mailboxError}
              </div>
            )}
            {!mailboxError && mailboxes === null && (
              <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>
                Loading mailboxes…
              </div>
            )}
            {!mailboxError && Array.isArray(mailboxes) && mailboxes.length === 0 && (
              <div style={{
                padding: 8, fontSize: 12, color: '#8a5a1a',
                background: '#fff4e0', border: `1px solid #f0d7a0`,
                borderRadius: 5,
              }}>
                No active outbound mailboxes are configured. Seed at least one
                row in <code>outbound_mailboxes</code> before sending.
              </div>
            )}
            {!mailboxError && Array.isArray(mailboxes) && mailboxes.length > 0 && (
              <select
                value={mailboxId}
                onChange={e => setMailboxId(e.target.value)}
                disabled={submitting}
                style={{ ...INPUT_STYLE, fontFamily: 'inherit' }}
              >
                {mailboxes.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.obm_display_name || m.obm_address} — {m.obm_address} ({m.obm_state})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* To */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={FIELD_LABEL}>To · Email</label>
              <input
                type="email"
                value={toEmail}
                onChange={e => setToEmail(e.target.value)}
                disabled={submitting}
                placeholder="recipient@example.com"
                style={INPUT_STYLE}
                autoFocus={!defaultRecipientEmail}
              />
            </div>
            <div>
              <label style={FIELD_LABEL}>To · Name (optional)</label>
              <input
                type="text"
                value={toName}
                onChange={e => setToName(e.target.value)}
                disabled={submitting}
                placeholder="First Last"
                style={INPUT_STYLE}
              />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label style={FIELD_LABEL}>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={submitting}
              placeholder="Subject line"
              style={INPUT_STYLE}
              autoFocus={!!defaultRecipientEmail}
            />
          </div>

          {/* Body */}
          <div>
            <label style={FIELD_LABEL}>Message</label>
            <textarea
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              disabled={submitting}
              placeholder="Write your message…"
              rows={9}
              style={{ ...INPUT_STYLE, resize: 'vertical', fontFamily: 'inherit', minHeight: 160 }}
            />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              Plain text for now. Rich-text editor + locked-region templates land in a follow-up slice.
            </div>
          </div>

          {/* Result preview after success */}
          {lastResult && (
            <div style={{
              padding: 10, fontSize: 12,
              background: lastResult.mode === 'mock' ? '#fff4e0' : '#e8f8f2',
              border: `1px solid ${lastResult.mode === 'mock' ? '#f0d7a0' : '#bfe7d3'}`,
              borderRadius: 5,
              color: C.textPrimary,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {lastResult.mode === 'mock' ? 'Mock mode — Graph send skipped' : 'Sent via Microsoft Graph'}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textSecondary }}>
                {lastResult.msg_record_number} · From {lastResult.from_address}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={FOOTER_STYLE}>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            Sends through <code>send-email-v1</code>; threads on{' '}
            <code>(customer email, mailbox)</code>.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => !submitting && onClose && onClose()}
              disabled={submitting}
              style={{ ...BUTTON_SECONDARY, opacity: submitting ? 0.4 : 1 }}
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={submitting || !mailboxId || mailboxes === null}
              style={{
                ...BUTTON_PRIMARY,
                opacity: (submitting || !mailboxId || mailboxes === null) ? 0.6 : 1,
                cursor: (submitting || !mailboxId || mailboxes === null) ? 'wait' : 'pointer',
              }}
            >
              <Icon path="M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z" size={13} color="currentColor" />
              {submitting ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
