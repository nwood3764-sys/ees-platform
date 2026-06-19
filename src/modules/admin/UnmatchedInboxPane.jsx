// =============================================================================
// UnmatchedInboxPane — Communications Module v1 Slice 4
//
// Triage queue for inbound emails that fell through all three resolution rules
// in the inbound-email-webhook (plus-address, In-Reply-To/References, sender→
// contact→thread). A coordinator works the queue by selecting a row from the
// left pane, reading the body preview + headers on the right, and either:
//
//   • Linking to an existing conversation (search the email threads on the
//     same shared mailbox, pick one, click Link — the message is inserted
//     onto the thread and the unmatched row is stamped 'linked').
//
//   • Dismissing the row with a reason (spam, internal forward, vendor
//     correspondence not customer-facing, etc.).
//
// Status filter at top — defaults to 'awaiting_triage' so coordinators see
// only the work queue. Toggleable to 'linked' / 'dismissed' / all.
// =============================================================================

import { useEffect, useMemo, useState, useCallback } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import HelpIcon from '../../components/help/HelpIcon'
import { useToast } from '../../components/Toast'
import {
  fetchUnmatchedInbox,
  fetchRecentEmailConversations,
  linkUnmatchedToConversation,
  dismissUnmatchedRow,
} from '../../data/conversationsService'

// ── Date helpers ─────────────────────────────────────────────────────────
function absoluteTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
function relativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const m = Math.floor((Date.now() - then) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Status pill styling ──────────────────────────────────────────────────
const STATUS_STYLES = {
  awaiting_triage: { bg: '#e8f1fb', color: '#1e466b', label: 'Awaiting triage' },
  linked:          { bg: '#e8f8f2', color: '#1a7a4e', label: 'Linked' },
  dismissed:       { bg: '#f0f3f8', color: '#4a5e7a', label: 'Dismissed' },
}

const STATUS_FILTERS = [
  { id: 'awaiting_triage', label: 'Awaiting triage' },
  { id: 'linked',          label: 'Linked' },
  { id: 'dismissed',       label: 'Dismissed' },
  { id: null,              label: 'All' },
]

export default function UnmatchedInboxPane() {
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState('awaiting_triage')
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  // ── Load ────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchUnmatchedInbox({ status: statusFilter })
      setRows(data)
      setSelectedId(prev => (prev && data.some(r => r.id === prev) ? prev : null))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { refresh() }, [refresh])

  const selected = useMemo(
    () => rows.find(r => r.id === selectedId) || null,
    [rows, selectedId],
  )

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Unmatched Inbox</div>
          <HelpIcon
            anchors={[
              { type: 'route', route: '/admin/unmatched_inbox' },
              { type: 'object', object: 'unmatched_inbox' },
              { type: 'concept', concept: 'unmatched-inbox' },
            ]}
            title="Unmatched Inbox"
          />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' :
            `${rows.length} ${statusFilter ? STATUS_STYLES[statusFilter]?.label?.toLowerCase() : 'total'} row${rows.length === 1 ? '' : 's'} — inbound email that fell through the threading resolution chain. Link to an existing conversation or dismiss.`
          }
        </div>

        {/* Status filter pills + refresh */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id || 'all'}
              onClick={() => setStatusFilter(f.id)}
              style={{
                background: statusFilter === f.id ? '#07111f' : C.card,
                color:      statusFilter === f.id ? '#fff'    : C.textSecondary,
                border:    `1px solid ${statusFilter === f.id ? '#07111f' : C.border}`,
                borderRadius: 5,
                padding: '5px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => refresh()}
            disabled={loading}
            style={{
              background: C.card, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 5,
              padding: '5px 12px', fontSize: 12, fontWeight: 600,
              cursor: loading ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              opacity: loading ? 0.6 : 1,
            }}
          >
            <Icon path="M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M20.49 15A9 9 0 015.64 18.36L1 14" size={11} color="currentColor" />
            Refresh
          </button>
        </div>
      </div>

      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}

      {!loading && !error && rows.length === 0 && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.textMuted, fontSize: 13.5, padding: 40, textAlign: 'center', lineHeight: 1.6,
        }}>
          <div>
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.4 }}>
              <Icon path="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6" size={36} color="currentColor" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
              No {statusFilter ? STATUS_STYLES[statusFilter]?.label?.toLowerCase() : ''} rows
            </div>
            <div>
              {statusFilter === 'awaiting_triage'
                ? "Every inbound email has been threaded automatically. Nice."
                : 'Nothing to show under this filter.'}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Left pane — row list */}
          <div style={{
            width: 360, flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            background: C.card,
            overflowY: 'auto',
            minHeight: 0,
          }}>
            {rows.map(row => (
              <UnmatchedRow
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onSelect={() => setSelectedId(row.id)}
              />
            ))}
          </div>
          {/* Right pane — detail + actions */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, background: '#f7f9fc' }}>
            {selected ? (
              <UnmatchedDetail
                row={selected}
                onRefresh={refresh}
                onActionComplete={() => {
                  setSelectedId(null)
                  refresh()
                }}
              />
            ) : (
              <div style={{
                padding: 40, color: C.textMuted, fontSize: 13.5,
                textAlign: 'center', lineHeight: 1.6,
              }}>
                Pick a row from the list to see the full body and triage options.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row in the left pane ─────────────────────────────────────────────────
function UnmatchedRow({ row, selected, onSelect }) {
  const status = STATUS_STYLES[row.ui_status] || STATUS_STYLES.dismissed
  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        background: selected ? '#e8f3fb' : 'transparent',
        borderLeft: selected ? '3px solid #1a5a8a' : '3px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{
          fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {row.ui_from_address || '(unknown sender)'}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
          {relativeTime(row.ui_received_at)}
        </div>
      </div>
      <div style={{
        fontSize: 12, color: C.textSecondary, marginTop: 2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {row.ui_subject || '(no subject)'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{
          background: status.bg, color: status.color,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
          padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase',
        }}>
          {status.label}
        </span>
        <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
          {row.ui_record_number}
        </span>
      </div>
    </div>
  )
}

// ── Right pane: full row detail + triage actions ─────────────────────────
function UnmatchedDetail({ row, onActionComplete }) {
  const toast = useToast()
  const isAwaiting = row.ui_status === 'awaiting_triage'

  return (
    <div style={{ padding: 20 }}>
      {/* Top metadata block */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 16, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
            {row.ui_subject || '(no subject)'}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
            {row.ui_record_number}
          </div>
        </div>
        <MetaRow label="From"        value={row.ui_from_address || '—'} mono />
        <MetaRow label="To"          value={row.ui_to_address || '—'}   mono />
        <MetaRow label="Received"    value={absoluteTime(row.ui_received_at)} />
        <MetaRow label="Provider ID" value={row.ui_provider_message_id || '—'} mono small />
        {row.ui_in_reply_to_header && (
          <MetaRow label="In-Reply-To" value={row.ui_in_reply_to_header} mono small />
        )}
        {row.ui_references_header && (
          <MetaRow label="References" value={row.ui_references_header} mono small />
        )}
      </div>

      {/* Body preview */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 16, marginBottom: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: C.textSecondary, textTransform: 'uppercase', marginBottom: 8 }}>
          Body preview
        </div>
        {row.ui_body_preview ? (
          <div
            style={{ fontSize: 13, lineHeight: 1.6, color: C.textPrimary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: sanitizePreview(row.ui_body_preview) }}
          />
        ) : (
          <div style={{ fontSize: 12.5, color: C.textMuted, fontStyle: 'italic' }}>
            No body preview captured.
          </div>
        )}
      </div>

      {/* Action pane — only when awaiting_triage */}
      {isAwaiting ? (
        <TriageActions row={row} onComplete={onActionComplete} toast={toast} />
      ) : (
        <ClosedStatusBanner row={row} />
      )}
    </div>
  )
}

// Coarse, defensive HTML sanitization — kill scripts and inline event handlers.
// This is preview-only (`ui_body_preview` is already truncated to 500 chars in
// the webhook) and not a substitute for proper sanitization when we render
// the full body on the messages timeline. Good enough to defang inline JS
// while keeping line breaks and bold/italic readable.
function sanitizePreview(html) {
  if (!html) return ''
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

function MetaRow({ label, value, mono, small }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 4, alignItems: 'baseline' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, width: 90, flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{
        fontSize: small ? 11 : 12.5,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        color: C.textPrimary,
        wordBreak: 'break-all',
        flex: 1,
      }}>
        {value}
      </div>
    </div>
  )
}

function ClosedStatusBanner({ row }) {
  const status = STATUS_STYLES[row.ui_status] || STATUS_STYLES.dismissed
  return (
    <div style={{
      background: status.bg,
      border: `1px solid ${status.color}30`,
      borderRadius: 8, padding: 14, fontSize: 12.5, color: C.textPrimary,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: status.color }}>
        {status.label}
      </div>
      {row.ui_status === 'linked' && (
        <>
          {row.ui_linked_at && (
            <div style={{ color: C.textSecondary }}>Linked at {absoluteTime(row.ui_linked_at)}</div>
          )}
          {row.ui_linked_conversation_id && (
            <div style={{ marginTop: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textSecondary }}>
              Conversation: {row.ui_linked_conversation_id}
            </div>
          )}
        </>
      )}
      {row.ui_status === 'dismissed' && row.ui_dismissed_reason && (
        <div style={{ color: C.textSecondary, fontStyle: 'italic' }}>
          “{row.ui_dismissed_reason}”
        </div>
      )}
    </div>
  )
}

// ── Triage action pane ───────────────────────────────────────────────────
function TriageActions({ row, onComplete, toast }) {
  const [mode, setMode] = useState(null)  // 'link' | 'dismiss' | null

  if (mode === 'link') {
    return <LinkPanel row={row} toast={toast} onCancel={() => setMode(null)} onLinked={onComplete} />
  }
  if (mode === 'dismiss') {
    return <DismissPanel row={row} toast={toast} onCancel={() => setMode(null)} onDismissed={onComplete} />
  }
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 16,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ fontSize: 12.5, color: C.textSecondary }}>
        Decide what to do with this row.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => setMode('dismiss')}
          style={{
            background: C.card, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
        <button
          onClick={() => setMode('link')}
          style={{
            background: '#3ecf8e', color: '#fff',
            border: 'none', borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon path="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71 M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" size={12} color="currentColor" />
          Link to conversation
        </button>
      </div>
    </div>
  )
}

// ── Link panel ───────────────────────────────────────────────────────────
function LinkPanel({ row, toast, onCancel, onLinked }) {
  const [convs, setConvs] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [query, setQuery] = useState('')
  const [chosenId, setChosenId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    fetchRecentEmailConversations({ ourAddress: row.ui_to_address || null, limit: 50 })
      .then(d => { if (alive) setConvs(d) })
      .catch(e => { if (alive) setLoadErr(e.message || String(e)) })
    return () => { alive = false }
  }, [row.ui_to_address])

  const filtered = useMemo(() => {
    if (!convs) return []
    const q = query.trim().toLowerCase()
    if (!q) return convs
    return convs.filter(c =>
      (c.conv_subject || '').toLowerCase().includes(q) ||
      (c.conv_customer_address || '').toLowerCase().includes(q) ||
      (c.conv_record_number || '').toLowerCase().includes(q)
    )
  }, [convs, query])

  const handleLink = useCallback(async () => {
    if (!chosenId) {
      toast.error('Pick a conversation first.')
      return
    }
    setSubmitting(true)
    try {
      const result = await linkUnmatchedToConversation({
        unmatchedId: row.id,
        conversationId: chosenId,
      })
      toast.success(result.alreadyExisted
        ? 'Linked — message was already on the thread'
        : 'Linked to conversation')
      if (onLinked) onLinked()
    } catch (e) {
      toast.error(e.message || 'Link failed')
    } finally {
      setSubmitting(false)
    }
  }, [chosenId, onLinked, row.id, toast])

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
        Link to an existing conversation
      </div>
      <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Showing email threads on the same shared mailbox, newest activity first.
        Picking a thread inserts this email onto it as an inbound message.
      </div>

      <input
        type="text"
        placeholder="Filter by subject, customer email, or conversation #…"
        value={query}
        onChange={e => setQuery(e.target.value)}
        disabled={submitting}
        style={{
          width: '100%', padding: '8px 10px', fontSize: 12.5,
          border: `1px solid ${C.border}`, borderRadius: 5,
          marginBottom: 10, boxSizing: 'border-box', outline: 'none',
        }}
      />

      {loadErr && (
        <div style={{ padding: 8, fontSize: 12, color: '#1e466b', background: '#e8f1fb', borderRadius: 5 }}>
          Failed to load conversations: {loadErr}
        </div>
      )}
      {!loadErr && convs === null && (
        <div style={{ fontSize: 12, color: C.textMuted, padding: 12, textAlign: 'center' }}>
          Loading conversations…
        </div>
      )}
      {!loadErr && Array.isArray(convs) && convs.length === 0 && (
        <div style={{ fontSize: 12.5, color: C.textMuted, padding: 12, textAlign: 'center' }}>
          No email conversations on this mailbox yet.
        </div>
      )}
      {!loadErr && filtered.length > 0 && (
        <div style={{
          maxHeight: 280, overflowY: 'auto',
          border: `1px solid ${C.border}`, borderRadius: 5,
          marginBottom: 12, background: '#fafbfd',
        }}>
          {filtered.map(c => {
            const isChosen = c.id === chosenId
            return (
              <div
                key={c.id}
                onClick={() => !submitting && setChosenId(c.id)}
                style={{
                  padding: '10px 12px',
                  borderBottom: `1px solid ${C.border}`,
                  cursor: submitting ? 'wait' : 'pointer',
                  background: isChosen ? '#e8f8f2' : 'transparent',
                  borderLeft: isChosen ? '3px solid #2aab72' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.conv_subject || '(no subject)'}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                    {c.conv_record_number}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>
                  {c.conv_customer_address || '(no customer)'} · {relativeTime(c.conv_last_message_at)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: C.card, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, cursor: 'pointer',
            opacity: submitting ? 0.4 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleLink}
          disabled={submitting || !chosenId}
          style={{
            background: '#3ecf8e', color: '#fff',
            border: 'none', borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
            cursor: (submitting || !chosenId) ? 'wait' : 'pointer',
            opacity: (submitting || !chosenId) ? 0.6 : 1,
          }}
        >
          {submitting ? 'Linking…' : 'Link'}
        </button>
      </div>
    </div>
  )
}

// ── Dismiss panel ────────────────────────────────────────────────────────
function DismissPanel({ row, toast, onCancel, onDismissed }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleDismiss = useCallback(async () => {
    const r = reason.trim()
    if (!r) {
      toast.error('Reason required.')
      return
    }
    setSubmitting(true)
    try {
      await dismissUnmatchedRow({ unmatchedId: row.id, reason: r })
      toast.success('Dismissed')
      if (onDismissed) onDismissed()
    } catch (e) {
      toast.error(e.message || 'Dismiss failed')
    } finally {
      setSubmitting(false)
    }
  }, [onDismissed, reason, row.id, toast])

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
        Dismiss this row
      </div>
      <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        Reason is required. The dismissed row stays in the audit trail —
        it's marked <code>dismissed</code> with your reason and the timestamp.
      </div>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        disabled={submitting}
        placeholder="e.g. Spam, vendor newsletter, internal forward unrelated to a project, etc."
        rows={3}
        style={{
          width: '100%', padding: '8px 10px', fontSize: 12.5,
          border: `1px solid ${C.border}`, borderRadius: 5,
          marginBottom: 12, boxSizing: 'border-box',
          fontFamily: 'inherit', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            background: C.card, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, cursor: 'pointer',
            opacity: submitting ? 0.4 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleDismiss}
          disabled={submitting || !reason.trim()}
          style={{
            background: '#7eb3e8', color: '#fff',
            border: 'none', borderRadius: 5,
            padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
            cursor: (submitting || !reason.trim()) ? 'wait' : 'pointer',
            opacity: (submitting || !reason.trim()) ? 0.6 : 1,
          }}
        >
          {submitting ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </div>
  )
}
