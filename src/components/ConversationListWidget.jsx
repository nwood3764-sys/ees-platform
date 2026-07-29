import { useEffect, useState } from 'react'
import { fetchConversationsForParent, describeDirection } from '../data/conversationsService'
import ConversationMessagesWidget from './ConversationMessagesWidget'

// Inbox-style, expandable list of a record's conversations. Each row shows the
// subject, a one-line preview, direction, date and unread badge; a chevron
// expands the row in place to read the full email(s) inline (reusing
// ConversationMessagesWidget in embedded mode) — no navigation needed.

const PAL = {
  border: '#e4e9f2', card: '#ffffff', card2: '#f7f9fc',
  text: '#0d1a2e', text2: '#4a5e7a', muted: '#8fa0b8',
}

function fmtDateTime(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function Chevron({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={PAL.text2}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

export default function ConversationListWidget({ widget, parentRecordId }) {
  const config = (widget && widget.widget_config) || {}
  const fk = config.fk
  const channelFilter = config.channel_filter || null

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openIds, setOpenIds] = useState(() => new Set())

  useEffect(() => {
    if (!fk || !parentRecordId) { setLoading(false); return }
    let alive = true
    setLoading(true); setError(null)
    fetchConversationsForParent(fk, parentRecordId, channelFilter)
      .then(data => { if (alive) setRows(data || []) })
      .catch(e => { if (alive) setError(e.message || 'Could not load conversations') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [fk, parentRecordId, channelFilter])

  const toggle = (id) => {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const title = (widget && widget.widget_title) || 'Conversations'

  return (
    <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${PAL.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13.5, color: PAL.text }}>{title}</span>
        {!loading && !error && (
          <span style={{ fontSize: 12, color: PAL.muted, background: PAL.card2, borderRadius: 10, padding: '1px 8px' }}>{rows.length}</span>
        )}
      </div>

      {loading && <div style={{ padding: 14, color: PAL.muted, fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ padding: 14, color: '#2f5b86', fontSize: 13 }}>{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 14, color: PAL.muted, fontSize: 13 }}>No conversations yet.</div>
      )}

      {!loading && !error && rows.map(c => {
        const open = openIds.has(c.id)
        const dir = describeDirection(c.conv_last_message_direction)
        const unread = c.conv_inbound_unread_count || 0
        return (
          <div key={c.id} style={{ borderBottom: `1px solid ${PAL.border}` }}>
            <div
              onClick={() => toggle(c.id)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 14px', cursor: 'pointer', background: open ? PAL.card2 : 'transparent' }}
              onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#fbfcfe' }}
              onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ paddingTop: 2 }}><Chevron open={open} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: dir.meta, textTransform: 'uppercase',
                    letterSpacing: '.03em', background: dir.bg, border: `1px solid ${dir.border}`,
                    borderRadius: 4, padding: '0 6px', flexShrink: 0,
                  }}>{dir.label}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: PAL.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.conv_subject || c.conv_record_number || '(no subject)'}
                  </span>
                  {unread > 0 && (
                    <span style={{ background: '#7eb3e8', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9, flexShrink: 0 }}>{unread}</span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: PAL.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {fmtDateTime(c.conv_last_message_at)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: PAL.text2, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.conv_last_message_direction === 'outbound' ? 'You: ' : ''}{c.conv_last_message_preview || c.conv_customer_address || '—'}
                </div>
              </div>
            </div>
            {open && (
              <div style={{ padding: '0 14px 12px 38px' }}>
                <ConversationMessagesWidget parentRecordId={c.id} embedded />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
