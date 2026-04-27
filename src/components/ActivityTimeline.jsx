// -----------------------------------------------------------------------------
// ActivityTimeline.jsx
//
// Salesforce-style activity feed for a single record. Renders a vertical
// timeline of every tracked change pulled from audit_log + field_history.
//
// Layout:
//   - Left rail: avatar dot + connecting line
//   - Right: card with actor, relative timestamp, action type badge, and an
//     inline diff list for field changes
//
// Entries are produced by fetchActivityTimeline() in activityService.js,
// which batches per-second field changes into a single logical "update".
// -----------------------------------------------------------------------------

import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { fetchActivityTimeline } from '../data/activityService'
import { supabase } from '../lib/supabase'

// Relative time: "just now", "5 min ago", "2 hr ago", "yesterday", or full date
function relativeTime(iso) {
  const then = new Date(iso)
  const now = Date.now()
  const diffMs = now - then.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60)        return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60)        return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)         return `${hr} hr ago`
  const day = Math.floor(hr / 24)
  if (day === 1)       return 'yesterday'
  if (day < 7)         return `${day} days ago`
  return then.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Full timestamp for hover tooltip
function fullTimestamp(iso) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Map a timeline entry's kind → badge style and label
const KIND_STYLES = {
  create:       { label: 'Created',      bg: '#e8f8f2', color: '#1a7a4e', dot: C.emeraldMid },
  update:       { label: 'Updated',      bg: '#e8f3fb', color: '#1a5a8a', dot: C.sky },
  soft_delete:  { label: 'Deleted',      bg: '#fce8e8', color: '#8a1a1a', dot: C.danger },
  restore:      { label: 'Restored',     bg: '#e8f8f2', color: '#1a7a4e', dot: C.emeraldMid },
  hard_delete:  { label: 'Hard Deleted', bg: '#fce8e8', color: '#8a1a1a', dot: C.danger },
  email:        { label: 'Email Sent',   bg: '#eef4fc', color: '#2557a7', dot: '#2557a7' },
  email_failed: { label: 'Email Failed', bg: '#fce8e8', color: '#8a1a1a', dot: C.danger },
}

// Convert a row from list_email_sends_for_record() RPC into a TimelineEntry
// with kind='email' (or 'email_failed' on Failed status). The body_html is
// kept on entry.email so EmailEntryBody can render it inside the entry card.
function toEmailEntry(row) {
  const failed = row.status === 'Failed'
  return {
    id: `email_${row.id}`,
    timestamp: row.sent_at || row.created_at,
    kind: failed ? 'email_failed' : 'email',
    actorName: row.sent_by_name || row.sender_email || 'System',
    changes: [],
    email: {
      subject: row.subject,
      recipients_to: row.recipients_to,
      body_html: row.body_html,
      status: row.status,
      failure_reason: row.failure_reason,
      record_number: row.email_send_record_number,
    },
  }
}

// Convert a name into initials, e.g. "Nicholas Wood" → "NW"
function initials(name) {
  if (!name || name === 'System') return 'SY'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Deterministic avatar color from a name string (just hashes the char codes)
function avatarColor(name) {
  const palette = [C.emeraldMid, C.sky, '#a78bfa', C.amber, '#5eead4', '#fb923c']
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return palette[h % palette.length]
}

// A single change row inside an update entry: "Status: Draft → Submitted"
function ChangeRow({ change }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 6,
      fontSize: 12, lineHeight: 1.5, color: C.textSecondary,
      padding: '3px 0',
    }}>
      <span style={{ color: C.textPrimary, fontWeight: 500 }}>{change.fieldLabel}:</span>
      <span style={{
        background: C.page, padding: '1px 6px', borderRadius: 3,
        color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11, maxWidth: '100%', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{change.oldValue}</span>
      <span style={{ color: C.textMuted }}>→</span>
      <span style={{
        background: '#e8f8f2', padding: '1px 6px', borderRadius: 3,
        color: '#1a7a4e', fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11, fontWeight: 500, maxWidth: '100%', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{change.newValue}</span>
    </div>
  )
}

function TimelineEntry({ entry, isLast }) {
  const kindStyle = KIND_STYLES[entry.kind] || KIND_STYLES.update
  const aColor = avatarColor(entry.actorName)

  return (
    <div style={{ display: 'flex', gap: 14, position: 'relative' }}>
      {/* Left rail: avatar dot + connecting line down */}
      <div style={{
        flexShrink: 0, width: 32, display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: aColor,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 600, fontFamily: 'Inter, sans-serif',
          boxShadow: '0 1px 3px rgba(13, 26, 46, 0.15)',
          zIndex: 1,
        }}>
          {initials(entry.actorName)}
        </div>
        {!isLast && (
          <div style={{
            flex: 1, width: 2, background: C.border, marginTop: 4, minHeight: 24,
          }} />
        )}
      </div>

      {/* Right: entry card */}
      <div style={{
        flex: 1, paddingBottom: isLast ? 0 : 20, minWidth: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          marginBottom: entry.changes.length > 0 ? 8 : 2,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 500, color: C.textPrimary,
          }}>{entry.actorName}</span>
          <span style={{
            background: kindStyle.bg, color: kindStyle.color,
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
            textTransform: 'uppercase', letterSpacing: 0.3,
          }}>{kindStyle.label}</span>
          <span
            title={fullTimestamp(entry.timestamp)}
            style={{ fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}
          >
            {relativeTime(entry.timestamp)}
          </span>
        </div>

        {entry.changes.length > 0 && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
            padding: '6px 10px',
          }}>
            {entry.changes.map((c, i) => <ChangeRow key={`${c.field}-${i}`} change={c} />)}
          </div>
        )}

        {entry.email && <EmailEntryBody email={entry.email} />}
      </div>
    </div>
  )
}

// Renders the email-specific block inside a TimelineEntry. Subject + recipient
// list + collapsible body preview. Body is shown plain-text by default; users
// can expand to see the actual HTML rendering of what was sent.
function EmailEntryBody({ email }) {
  const [expanded, setExpanded] = useState(false)
  const recipients = Array.isArray(email.recipients_to) ? email.recipients_to : []
  const recipientLabel = recipients.length === 0
    ? '(no recipients)'
    : recipients.length === 1
      ? `${recipients[0].name || recipients[0].email}`
      : `${recipients[0].name || recipients[0].email} +${recipients.length - 1} other${recipients.length === 2 ? '' : 's'}`

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
      padding: '8px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>
        <span style={{ color: C.textMuted }}>To:</span>
        <span style={{ color: C.textPrimary, fontWeight: 500 }}>{recipientLabel}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
        {email.subject || '(no subject)'}
      </div>
      {email.status === 'Failed' && email.failure_reason && (
        <div style={{ fontSize: 11, color: '#8a2c20', background: '#fdecea', border: '1px solid #f3b9b3', borderRadius: 4, padding: '4px 8px', marginBottom: 6, fontFamily: 'monospace' }}>
          {email.failure_reason}
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          background: 'transparent', border: 'none', color: C.sky,
          fontSize: 11.5, fontWeight: 500, cursor: 'pointer', padding: 0,
          textDecoration: 'underline',
        }}
      >
        {expanded ? 'Hide message' : 'Show message'}
      </button>
      {expanded && email.body_html && (
        <div style={{
          marginTop: 8, padding: 10, background: '#fff',
          border: `1px solid ${C.border}`, borderRadius: 4,
          maxHeight: 400, overflow: 'auto', fontSize: 13,
        }}>
          {/* eslint-disable-next-line react/no-danger */}
          <div dangerouslySetInnerHTML={{ __html: email.body_html }} />
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// ActivityTimeline — public component
// -----------------------------------------------------------------------------

// Filter chip configuration. Each chip has a predicate run over an entry —
// the feed just filters the accumulated list when a chip is active. This
// keeps filtering purely client-side so switching chips is instant and does
// not trigger a refetch.
const FILTERS = [
  {
    id: 'all',
    label: 'All',
    test: () => true,
  },
  {
    id: 'changes',
    label: 'Field changes',
    test: (e) => e.kind === 'update' && e.changes.length > 0,
  },
  {
    id: 'create_delete',
    label: 'Created / Deleted',
    test: (e) => e.kind === 'create' || e.kind === 'soft_delete'
              || e.kind === 'restore' || e.kind === 'hard_delete',
  },
]

function FilterChips({ active, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16,
    }}>
      {FILTERS.map(f => {
        const isActive = f.id === active
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            disabled={disabled}
            style={{
              background: isActive ? C.emerald : C.card,
              color:      isActive ? '#fff'     : C.textSecondary,
              border:     `1px solid ${isActive ? C.emerald : C.border}`,
              borderRadius: 14,
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: isActive ? 600 : 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
          >
            {f.label}
          </button>
        )
      })}
    </div>
  )
}

export default function ActivityTimeline({ tableName, recordId }) {
  const [entries, setEntries] = useState(null)    // null = initial loading
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [filterId, setFilterId] = useState('all')

  // Initial load — also resets everything when the record changes.
  // Fetches activity timeline and email sends in parallel, then merges them
  // by timestamp. Email entries come from the email_sends table (every email
  // Anura sent through Outlook on behalf of any user, threaded onto the
  // parent record); they sit alongside field-history entries in one feed.
  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setHasMore(false)
    setError(null)
    setFilterId('all')
    Promise.all([
      fetchActivityTimeline(tableName, recordId),
      supabase.rpc('list_email_sends_for_record', {
        p_parent_object: tableName,
        p_parent_record_id: recordId,
      }).then(({ data, error: rpcErr }) => rpcErr ? [] : (data || [])),
    ])
      .then(([{ entries: activityEntries, hasMore }, emailRows]) => {
        if (cancelled) return
        const emailEntries = emailRows.map(toEmailEntry)
        const merged = [...activityEntries, ...emailEntries]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        setEntries(merged)
        setHasMore(hasMore)
      })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
    return () => { cancelled = true }
  }, [tableName, recordId])

  // Load-more handler — paginate using the oldest timestamp currently loaded
  // as the cursor. New entries are appended; hasMore is recomputed from the
  // next page's caps. Captures tableName/recordId at click time so if the
  // record switches mid-request, the stale response is dropped instead of
  // leaking old-record entries into the new view.
  const handleLoadMore = async () => {
    if (loadingMore || !entries || entries.length === 0) return
    const oldest = entries[entries.length - 1].timestamp
    const reqTable = tableName
    const reqId    = recordId
    setLoadingMore(true)
    try {
      const { entries: next, hasMore: more } =
        await fetchActivityTimeline(reqTable, reqId, { before: oldest })
      // Drop the response if the viewer has moved to a different record.
      if (reqTable !== tableName || reqId !== recordId) return
      setEntries(prev => [...(prev || []), ...next])
      setHasMore(more)
    } catch (err) {
      if (reqTable === tableName && reqId === recordId) {
        setError(err.message || String(err))
      }
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) {
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 20, color: C.textSecondary, fontSize: 13,
      }}>
        Couldn't load activity: {error}
      </div>
    )
  }

  if (entries === null) {
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: 20, color: C.textMuted, fontSize: 13, textAlign: 'center',
      }}>
        Loading activity…
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '32px 20px', color: C.textMuted, fontSize: 13, textAlign: 'center',
      }}>
        <div style={{ fontWeight: 500, color: C.textSecondary, marginBottom: 4 }}>
          No activity yet
        </div>
        <div>Changes to tracked fields will appear here.</div>
      </div>
    )
  }

  const activeFilter = FILTERS.find(f => f.id === filterId) || FILTERS[0]
  const visible = entries.filter(activeFilter.test)

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 20,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, marginBottom: 12, flexWrap: 'wrap',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          Activity Timeline
        </div>
        <div style={{ fontSize: 11, color: C.textMuted }}>
          {visible.length === entries.length
            ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
            : `${visible.length} of ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}
        </div>
      </div>

      <FilterChips active={filterId} onChange={setFilterId} disabled={loadingMore} />

      {visible.length === 0 ? (
        <div style={{
          padding: '24px 8px', color: C.textMuted, fontSize: 12.5,
          textAlign: 'center',
        }}>
          No entries match this filter.
        </div>
      ) : (
        <div>
          {visible.map((e, i) => (
            <TimelineEntry key={e.id} entry={e} isLast={i === visible.length - 1} />
          ))}
        </div>
      )}

      {hasMore && (
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`,
          textAlign: 'center',
        }}>
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            style={{
              background: C.card,
              color: C.textSecondary,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 12,
              fontWeight: 500,
              cursor: loadingMore ? 'wait' : 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { if (!loadingMore) e.currentTarget.style.background = '#f7f9fc' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.card }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
