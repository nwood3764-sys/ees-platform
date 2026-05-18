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

import { useCallback, useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  fetchOutboundMailboxes,
  sendNewEmail,
  uploadAttachmentForMessage,
  validateAttachmentFile,
  formatBytes,
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

  // Staged attachments — File objects held client-side until Send. Each file
  // gets a stable client-id so list operations don't have to depend on
  // identity.
  const [stagedFiles, setStagedFiles] = useState([])  // [{ clientId, file, error? }]
  const fileInputRef = useRef(null)

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
    setStagedFiles([])
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

      // Upload staged attachments now that we know the message id. Sequential
      // rather than parallel — mock-mode storage uploads are fast enough and
      // it keeps the error path cleanly attributable to one file.
      const attachmentResults = []
      const successfulFiles = []
      for (const sf of stagedFiles) {
        try {
          const row = await uploadAttachmentForMessage({
            messageId:      result.message_id,
            conversationId: result.conversation_id,
            file:           sf.file,
          })
          attachmentResults.push({ ok: true, name: sf.file.name, row })
          successfulFiles.push(sf.file.name)
        } catch (e) {
          attachmentResults.push({ ok: false, name: sf.file.name, error: e.message || String(e) })
        }
      }
      const failedAttachments = attachmentResults.filter(r => !r.ok)
      if (failedAttachments.length > 0) {
        // Don't roll back the email — it sent. Just warn about the partial
        // failure and leave the toast visible long enough to read.
        toast.error(`Email sent but ${failedAttachments.length} of ${stagedFiles.length} attachment${stagedFiles.length === 1 ? '' : 's'} failed to upload: ${failedAttachments[0].error}`)
      } else if (successfulFiles.length > 0) {
        toast.success(`${isMock ? 'Email queued (mock mode)' : 'Email sent'} with ${successfulFiles.length} attachment${successfulFiles.length === 1 ? '' : 's'}.`)
      } else {
        toast.success(isMock
          ? 'Email queued in mock mode — Graph credentials not yet configured. Row written to messages.'
          : `Email sent (${result?.msg_record_number || 'queued'}).`)
      }
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
    mailboxId, onClose, onSent, stagedFiles, subject, submitting, toEmail, toName, toast,
  ])

  // ── File staging ────────────────────────────────────────────────────
  const handleFilesPicked = useCallback((e) => {
    const files = Array.from(e.target?.files || [])
    if (files.length === 0) return
    const additions = []
    for (const file of files) {
      try {
        validateAttachmentFile(file)
        additions.push({
          clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
        })
      } catch (err) {
        toast.error(err.message || `Refused: ${file.name}`)
      }
    }
    if (additions.length > 0) setStagedFiles(prev => [...prev, ...additions])
    // Reset input value so the same file can be re-picked after removal
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [toast])

  const removeStagedFile = useCallback((clientId) => {
    setStagedFiles(prev => prev.filter(sf => sf.clientId !== clientId))
  }, [])

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

          {/* Attachments */}
          <div>
            <label style={FIELD_LABEL}>Attachments</label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFilesPicked}
              disabled={submitting}
              style={{ display: 'none' }}
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.png,.jpg,.jpeg,.heic,.heif,.gif,.webp,.csv,.tsv,.txt,.md,.zip"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              style={{
                background: C.card, color: C.textSecondary,
                border: `1px dashed ${C.border}`, borderRadius: 5,
                padding: '8px 14px', fontSize: 12.5, cursor: submitting ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: submitting ? 0.4 : 1,
              }}
            >
              <Icon path="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" size={13} color="currentColor" />
              Attach file{stagedFiles.length > 0 ? 's' : ''}…
            </button>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              Files ≤25 MB ride along as normal email attachments. Files &gt;25 MB ship as a 30-day signed download link. Virus scan is pending — `ma_virus_scan_status` flips to clean/infected once the ClamAV hook lands.
            </div>
            {stagedFiles.length > 0 && (
              <div style={{
                marginTop: 8, border: `1px solid ${C.border}`, borderRadius: 5,
                background: '#fafbfd',
              }}>
                {stagedFiles.map(sf => (
                  <div
                    key={sf.clientId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <Icon path="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" size={14} color={C.textSecondary} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sf.file.name}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>
                        {formatBytes(sf.file.size)} · {sf.file.size > 25 * 1024 * 1024 ? 'will ship as signed link' : 'inline attachment'}
                      </div>
                    </div>
                    <button
                      onClick={() => removeStagedFile(sf.clientId)}
                      disabled={submitting}
                      title="Remove"
                      style={{
                        background: 'transparent', border: 'none',
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        color: C.textMuted, padding: 4,
                      }}
                    >
                      <Icon path="M6 6l12 12 M6 18l12-12" size={13} color="currentColor" />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
