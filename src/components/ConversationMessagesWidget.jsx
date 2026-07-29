import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import {
  fetchMessagesForConversation,
  fetchAttachmentsForMessages,
  createAttachmentSignedUrl,
  describeDirection,
  formatBytes,
} from '../data/conversationsService'

// Renders a conversation's messages as a readable email thread on the
// conversation record page (each message shown email-style: direction, date,
// subject, From/To, and the sanitized HTML body). The plain related-list of
// messages only showed metadata columns — you couldn't read the email. This
// widget is the "open it and read it like an email" view.

const PAL = {
  border: '#e4e9f2', card: '#ffffff', card2: '#f7f9fc',
  text: '#0d1a2e', text2: '#4a5e7a', muted: '#8fa0b8', link: '#2f5b86',
}

function isEmailHtml(m) {
  return m.msg_channel === 'email'
    && typeof m.msg_body === 'string'
    && /<[a-z][\s\S]*>/i.test(m.msg_body)
}

function fmtDateTime(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function ConversationMessagesWidget({ widget, parentRecordId }) {
  const [messages, setMessages] = useState([])
  const [attByMsg, setAttByMsg] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!parentRecordId) return
    let alive = true
    setLoading(true); setError(null)
    fetchMessagesForConversation(parentRecordId)
      .then(async (msgs) => {
        if (!alive) return
        setMessages(msgs)
        try {
          const ids = (msgs || []).map(m => m.id)
          const atts = ids.length ? await fetchAttachmentsForMessages(ids) : []
          const grouped = {}
          for (const a of (atts || [])) {
            (grouped[a.ma_message_id] = grouped[a.ma_message_id] || []).push(a)
          }
          if (alive) setAttByMsg(grouped)
        } catch { /* attachments are optional */ }
      })
      .catch(e => { if (alive) setError(e.message || 'Could not load messages') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [parentRecordId])

  const openAttachment = async (att, e) => {
    if (e) e.preventDefault()
    try {
      const url = await createAttachmentSignedUrl(att)
      if (!url) throw new Error('No download URL returned')
      window.open(url, '_blank', 'noopener')
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert('Could not open attachment: ' + (err.message || err))
    }
  }

  const title = (widget && widget.widget_title) || 'Email'

  return (
    <div style={{ background: PAL.card, border: `1px solid ${PAL.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${PAL.border}`, fontWeight: 600, fontSize: 13.5, color: PAL.text }}>
        {title}
      </div>
      <div style={{ padding: 14 }}>
        {loading && <div style={{ color: PAL.muted, fontSize: 13 }}>Loading…</div>}
        {error && <div style={{ color: PAL.link, fontSize: 13 }}>{error}</div>}
        {!loading && !error && messages.length === 0 && (
          <div style={{ color: PAL.muted, fontSize: 13 }}>No messages on this conversation yet.</div>
        )}
        {messages.map(m => {
          const dir = describeDirection(m.msg_direction)
          const atts = attByMsg[m.id] || []
          return (
            <div key={m.id} style={{ border: `1px solid ${PAL.border}`, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ background: dir.bg, borderBottom: `1px solid ${dir.border}`, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: dir.meta, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                    {dir.label}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: PAL.text2, whiteSpace: 'nowrap' }}>
                    {fmtDateTime(m.msg_sent_at || m.msg_created_at)}
                  </span>
                </div>
                {m.msg_subject && (
                  <div style={{ fontWeight: 600, fontSize: 14, color: PAL.text, marginBottom: 5 }}>{m.msg_subject}</div>
                )}
                <div style={{ fontSize: 12, color: PAL.text2 }}><strong>From:</strong> {m.msg_from_address || '—'}</div>
                <div style={{ fontSize: 12, color: PAL.text2 }}><strong>To:</strong> {m.msg_to_address || '—'}</div>
              </div>
              <div style={{ padding: '12px 14px', fontSize: 13.5, lineHeight: 1.5, color: PAL.text, wordBreak: 'break-word', overflowX: 'auto' }}>
                {isEmailHtml(m)
                  // eslint-disable-next-line react/no-danger
                  ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(m.msg_body) }} />
                  : <div style={{ whiteSpace: 'pre-wrap' }}>{m.msg_body || '—'}</div>}
              </div>
              {atts.length > 0 && (
                <div style={{ padding: '0 14px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {atts.map(a => {
                    const blocked = a.ma_virus_scan_status === 'infected' || a.ma_virus_scan_status === 'blocked'
                    return (
                      <button
                        key={a.id}
                        disabled={blocked}
                        onClick={blocked ? undefined : (e) => openAttachment(a, e)}
                        title={blocked ? 'Attachment blocked by virus scan' : 'Open ' + a.ma_file_name}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px',
                          background: PAL.card2, border: `1px solid ${PAL.border}`, borderRadius: 6,
                          fontSize: 12, color: blocked ? PAL.muted : PAL.link,
                          cursor: blocked ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        {a.ma_file_name}{a.ma_file_size_bytes ? ' · ' + formatBytes(a.ma_file_size_bytes) : ''}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
