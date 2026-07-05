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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import TiptapEmailComposer from './TiptapEmailComposer'
import {
  resolveOutboundMailboxForAnchor,
  sendNewEmail,
  sendNewEmailHtml,
  sendTemplateEmail,
  fetchActiveEmailTemplates,
  fetchEmailTemplate,
  uploadAttachmentToStorage,
  registerAttachmentRows,
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
  maxWidth: 760,
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

  // Resolved-mailbox state. Mailbox is NOT user-selectable — it is
  // resolved from the anchor record's parent chain to a state and then
  // to the single active outbound_mailbox for that state. The UI shows
  // it as a read-only display. send-email-v1 also runs the same
  // resolver server-side and rejects payloads that disagree.
  const [resolvedMailbox, setResolvedMailbox] = useState(null)   // null while loading
  const [resolvedMailboxError, setResolvedMailboxError] = useState(null)
  // Convenience alias for downstream code that still references mailboxId
  const mailboxId = resolvedMailbox?.outbound_mailbox_id || ''

  const [toEmail, setToEmail] = useState('')
  const [toName, setToName]   = useState('')
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')   // legacy state — preserved
                                                  // for the plain-text send
                                                  // path until a final cutover

  // Rich-text editor — the source of truth for the message body.
  const editorRef = useRef(null)
  const [bodyHtml, setBodyHtml] = useState('')   // live HTML mirror of editor

  // Template picker. null = none selected (free-form mode). Otherwise the
  // hydrated row including locked_regions, default_outbound_mailbox,
  // default_subject, ai_assist_allowed.
  const [templates, setTemplates] = useState(null)   // null=loading, []=none, [...]=ready
  const [templatesError, setTemplatesError] = useState(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [activeTemplate, setActiveTemplate] = useState(null)
  const [editableRegionsByTemplate, setEditableRegionsByTemplate] = useState({})
  //                ^ keyed by templateId → { region_id: html } so flipping
  //                  between templates preserves what the user typed

  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState(null)  // payload from edge fn on success

  // Staged attachments — File objects held client-side until Send. Each file
  // gets a stable client-id so list operations don't have to depend on
  // identity.
  const [stagedFiles, setStagedFiles] = useState([])  // [{ clientId, file, error? }]
  const fileInputRef = useRef(null)

  // ── Derived: which mode are we in? ──────────────────────────────────
  // Template mode requires the selected template to have a non-empty
  // locked_regions structure. Otherwise the template just prefills the
  // body and the send path stays free-form (the edge function ignores
  // editable_regions when locked_regions is empty).
  const hasLockedRegions = Array.isArray(activeTemplate?.template_locked_regions)
    && activeTemplate.template_locked_regions.length > 0
  const mode = hasLockedRegions ? 'template' : 'free-form'

  // ── Reset state when the modal opens ────────────────────────────────
  useEffect(() => {
    if (!open) return
    setToEmail(defaultRecipientEmail || '')
    setToName(defaultRecipientName || '')
    setSubject('')
    setBodyText('')
    setBodyHtml('')
    setLastResult(null)
    setResolvedMailbox(null)
    setResolvedMailboxError(null)
    setStagedFiles([])
    setTemplates(null)
    setTemplatesError(null)
    setSelectedTemplateId('')
    setActiveTemplate(null)
    setEditableRegionsByTemplate({})
  }, [open, defaultRecipientEmail, defaultRecipientName])

  // ── Resolve outbound mailbox once per open ──────────────────────────
  // Programmatic, not user-selectable. Walks the anchor's parent chain
  // (project → property → state) → active outbound_mailbox for that
  // state. If the resolver returns nothing (no state on the property,
  // or no active mailbox configured for that state), surface a hard
  // error in the UI and disable Send. Defense in depth: send-email-v1
  // runs the same resolver server-side.
  useEffect(() => {
    if (!open) return
    let alive = true
    setResolvedMailbox(null)
    setResolvedMailboxError(null)
    resolveOutboundMailboxForAnchor({ anchorObject, anchorRecordId })
      .then(row => {
        if (!alive) return
        if (!row) {
          setResolvedMailboxError(
            `No outbound mailbox could be resolved for this record. ` +
            `The property's state may be missing, or no active mailbox is ` +
            `configured for that state. Contact your administrator.`
          )
          return
        }
        setResolvedMailbox(row)
      })
      .catch(err => {
        if (alive) setResolvedMailboxError(err.message || String(err))
      })
    return () => { alive = false }
  }, [open, anchorObject, anchorRecordId])

  // ── Load active email templates once per open ───────────────────────
  useEffect(() => {
    if (!open) return
    let alive = true
    fetchActiveEmailTemplates({ anchorObject })
      .then(rows => {
        if (alive) setTemplates(rows || [])
      })
      .catch(err => {
        if (alive) setTemplatesError(err.message || String(err))
      })
    return () => { alive = false }
  }, [open, anchorObject])

  // ── Template selection → hydrate the active template row ────────────
  useEffect(() => {
    if (!selectedTemplateId) {
      setActiveTemplate(null)
      return
    }
    let alive = true
    fetchEmailTemplate(selectedTemplateId)
      .then(row => {
        if (!alive) return
        setActiveTemplate(row)
        // Seed subject from template default if user hasn't typed one
        if (row?.subject && !subject) {
          setSubject(row.subject)
        }
        // NOTE: template.template_default_outbound_mailbox_id is intentionally
        // ignored. Mailbox selection is resolver-driven (anchor → state →
        // mailbox) and not overridable by template, user, or any other source.
        // The column may be retired in a later schema slice.
      })
      .catch(err => {
        if (alive) toast.error(`Failed to load template: ${err.message || err}`)
      })
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplateId])

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
    if (!mailboxId) {
      toast.error('Pick an outbound mailbox before sending.')
      return
    }

    // Body-content validation differs between modes. Template mode requires
    // at least one editable region to have content; free-form requires the
    // editor body to be non-empty.
    const editorEmpty = editorRef.current?.isEmpty?.() ?? true
    const regions = editorRef.current?.getEditableRegions?.() || {}
    if (mode === 'free-form' && editorEmpty) {
      toast.error('Message body is empty.')
      return
    }
    if (mode === 'template') {
      const anyFilled = Object.values(regions).some(html =>
        (html || '').replace(/<[^>]*>/g, '').trim().length > 0
      )
      if (!anyFilled) {
        toast.error('Fill in at least one editable section before sending.')
        return
      }
    }

    setSubmitting(true)
    try {
      // Upload staged attachments BEFORE the send so the actual files ride the
      // outgoing email (the old post-send upload meant the email left without
      // them). An upload failure aborts the send — never send an email missing
      // a file the user attached.
      const uploads = []
      for (const sf of stagedFiles) {
        uploads.push(await uploadAttachmentToStorage(sf.file))
      }

      let result
      if (mode === 'template') {
        result = await sendTemplateEmail({
          anchorObject,
          anchorRecordId,
          to: { email: toEmail.trim(), name: toName.trim() || undefined },
          emailTemplateId:  activeTemplate.id,
          editableRegions:  regions,
          outboundMailboxId: mailboxId,
          contactId:         defaultContactId || undefined,
          subjectOverride:   subject.trim(),
          attachments:       uploads,
        })
      } else {
        result = await sendNewEmailHtml({
          anchorObject,
          anchorRecordId,
          to: { email: toEmail.trim(), name: toName.trim() || undefined },
          subject: subject.trim(),
          bodyHtml: editorRef.current?.getHtml?.() || '',
          outboundMailboxId: mailboxId,
          contactId: defaultContactId || undefined,
          attachments: uploads,
        })
      }
      setLastResult(result)
      const isMock = result?.mode === 'mock'

      // Link the pre-uploaded files to the new message so they show on the
      // thread. The email already carried them; this is record-keeping, so a
      // failure here only warns.
      if (uploads.length > 0) {
        try {
          await registerAttachmentRows({ messageId: result.message_id, uploads })
        } catch (e) {
          toast.error(`Email sent with attachments, but recording them on the thread failed: ${e.message || e}`)
        }
      }
      if (uploads.length > 0) {
        toast.success(`${isMock ? 'Email queued (mock mode)' : 'Email sent'} with ${uploads.length} attachment${uploads.length === 1 ? '' : 's'}.`)
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
    anchorObject, anchorRecordId, activeTemplate, defaultContactId, mode,
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

          {/* From — programmatic, NOT user-selectable. Resolver picks the
              single active outbound mailbox for this anchor's state. */}
          <div>
            <label style={FIELD_LABEL}>From</label>
            {resolvedMailboxError && (
              <div style={{
                padding: 8, fontSize: 12, color: '#1e466b',
                background: '#e8f1fb', border: `1px solid #bcd9f2`,
                borderRadius: 5,
              }}>
                {resolvedMailboxError}
              </div>
            )}
            {!resolvedMailboxError && !resolvedMailbox && (
              <div style={{ fontSize: 12, color: C.textMuted, padding: '8px 0' }}>
                Resolving mailbox from record…
              </div>
            )}
            {!resolvedMailboxError && resolvedMailbox && (
              <div style={{
                ...INPUT_STYLE,
                background: C.cardSecondary || '#f7f9fc',
                cursor: 'not-allowed',
                color: C.textPrimary,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
              title={`Resolved via: ${resolvedMailbox.resolution_path}`}
              >
                <span style={{ flex: 1 }}>
                  {resolvedMailbox.obm_display_name} — {resolvedMailbox.obm_address} ({resolvedMailbox.obm_state})
                </span>
                <span style={{
                  fontSize: 10, color: C.textMuted, fontWeight: 600,
                  letterSpacing: 0.4, textTransform: 'uppercase',
                }}>
                  Auto
                </span>
              </div>
            )}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              Mailbox is determined by the record's program and state. Not user-selectable.
            </div>
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

          {/* Template picker */}
          <div>
            <label style={FIELD_LABEL}>Template</label>
            {templatesError && (
              <div style={{
                padding: 8, fontSize: 12, color: '#1e466b',
                background: '#e8f1fb', border: `1px solid #bcd9f2`,
                borderRadius: 5,
              }}>
                Failed to load templates: {templatesError}
              </div>
            )}
            {!templatesError && (
              <select
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value)}
                disabled={submitting || templates === null}
                style={{ ...INPUT_STYLE, fontFamily: 'inherit' }}
              >
                <option value="">
                  {templates === null
                    ? 'Loading templates…'
                    : `(no template — free-form${(templates?.length || 0) > 0 ? `, ${templates.length} available` : ''})`}
                </option>
                {Array.isArray(templates) && templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.et_record_number ? `${t.et_record_number} · ` : ''}{t.name}
                  </option>
                ))}
              </select>
            )}
            {activeTemplate && (
              <div style={{
                marginTop: 6, fontSize: 11, color: C.textMuted,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>Locked sections render verbatim from the template; editable sections accept your content.</span>
                {activeTemplate.template_ai_assist_allowed === false && (
                  <span style={{
                    padding: '1px 6px', borderRadius: 3,
                    background: '#e8f1fb', color: '#1e466b',
                    fontWeight: 600, fontSize: 10, letterSpacing: 0.3,
                  }}>
                    AI assist disabled
                  </span>
                )}
              </div>
            )}
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

          {/* Body — TipTap rich-text editor */}
          <div>
            <label style={FIELD_LABEL}>Message</label>
            <TiptapEmailComposer
              ref={editorRef}
              mode={mode}
              initialHtml={
                mode === 'free-form' && activeTemplate?.body_html
                  ? activeTemplate.body_html
                  : ''
              }
              templateLockedRegions={hasLockedRegions ? activeTemplate.template_locked_regions : null}
              placeholder={
                mode === 'template'
                  ? 'Fill in the editable sections below…'
                  : 'Type your message. Use {{ to insert a merge field, or click Merge field above.'
              }
              onChange={(html) => setBodyHtml(html)}
              disabled={submitting}
            />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
              {mode === 'template'
                ? <>Locked sections render verbatim and cannot be edited. Type <code>{'{{'}</code> in any editable section to insert a merge field.</>
                : activeTemplate
                  ? <>Template body prefilled. You can edit freely; <code>{'{{'}</code> tokens render with live record values at send time.</>
                  : <>Type <code>{'{{'}</code> to insert a merge field inline.</>
              }
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
              background: lastResult.mode === 'mock' ? '#e8f1fb' : '#e8f8f2',
              border: `1px solid ${lastResult.mode === 'mock' ? '#bcd9f2' : '#bfe7d3'}`,
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
              disabled={submitting || !mailboxId || !resolvedMailbox}
              style={{
                ...BUTTON_PRIMARY,
                opacity: (submitting || !mailboxId || !resolvedMailbox) ? 0.6 : 1,
                cursor: (submitting || !mailboxId || !resolvedMailbox) ? 'wait' : 'pointer',
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
