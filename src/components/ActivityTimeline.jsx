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
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// ActivityTimeline — public component
// -----------------------------------------------------------------------------

export default function ActivityTimeline({ tableName, recordId }) {
  const [entries, setEntries] = useState(null)   // null = loading
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    setError(null)
    fetchActivityTimeline(tableName, recordId)
      .then(rows => { if (!cancelled) setEntries(rows) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
    return () => { cancelled = true }
  }, [tableName, recordId])

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

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 20,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5,
        marginBottom: 16,
      }}>
        Activity Timeline
      </div>
      <div>
        {entries.map((e, i) => (
          <TimelineEntry key={e.id} entry={e} isLast={i === entries.length - 1} />
        ))}
      </div>
    </div>
  )
}
