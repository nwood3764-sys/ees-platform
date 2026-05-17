import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import {
  fetchConversationsForParent,
  fetchMessagesForConversation,
  markConversationRead,
  sendReplyToConversation,
  describeChannel,
  describeDirection,
} from '../data/conversationsService'

// ---------------------------------------------------------------------------
// ConversationPanel — Salesforce Service Cloud Messaging-style split-pane
// rendered on the parent record's Related tab. Replaces the previous
// related_list rendering of the `conversations` table on contact, account,
// project, and service_appointment page layouts.
//
// Layout:
//   ┌──────────── card header (collapsible) ─────────────┐
//   │ icon  Conversations  [3]                  refresh ↻│
//   ├─────────────────┬───────────────────────────────────┤
//   │ thread list     │ active thread timeline            │
//   │ (left pane)     │ (right pane: header + bubbles)    │
//   │                 │                                   │
//   │                 │ ───────── composer ─────────────  │
//   │                 │ [ textarea …………… ] [ Send ]       │
//   └─────────────────┴───────────────────────────────────┘
//
// Mobile (≤768px): single-column. Thread list shows when no thread selected;
// selecting a thread swaps the whole inner body to the thread view with a
// back button at top to return to the list.
// ---------------------------------------------------------------------------

const PANE_HEIGHT_DESKTOP = 520
const PANE_HEIGHT_MOBILE  = 560
const THREAD_LIST_WIDTH   = 280

// Relative-time helper — "2m ago", "3h ago", "Yesterday", or a date stamp.
// Keeps the thread list compact without obscuring older threads.
function relativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Absolute time helper for bubble timestamps.
function absoluteTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default function ConversationPanelWidget({
  widget, parentRecordId,
}) {
  const config = widget.widget_config || {}
  const fk = config.fk
  // Optional 'sms' | 'email' filter from widget_config. Null means all channels.
  // Anything other than the two known values is normalised to null so a typo
  // in config doesn't silently hide every thread.
  const channelFilter =
    config.channel_filter === 'sms' || config.channel_filter === 'email'
      ? config.channel_filter
      : null
  const isMobile = useIsMobile()
  const toast = useToast()

  const [collapsed, setCollapsed] = useState(false)
  const [threads, setThreads] = useState([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [threadsError, setThreadsError] = useState(null)

  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const messagesScrollRef = useRef(null)
  const composerRef = useRef(null)

  // ── Loaders ─────────────────────────────────────────────────────────
  const refreshThreads = useCallback(async (opts = {}) => {
    if (!fk || !parentRecordId) {
      setThreads([])
      setThreadsLoading(false)
      return
    }
    if (!opts.background) setThreadsLoading(true)
    setThreadsError(null)
    try {
      const rows = await fetchConversationsForParent(fk, parentRecordId, channelFilter)
      setThreads(rows)
      // Keep the current selection if it's still in the list; otherwise
      // clear it so the right pane returns to the empty state.
      setSelectedThreadId(prev => (prev && rows.some(r => r.id === prev) ? prev : null))
    } catch (err) {
      setThreadsError(err.message || String(err))
    } finally {
      if (!opts.background) setThreadsLoading(false)
    }
  }, [fk, parentRecordId, channelFilter])

  useEffect(() => { refreshThreads() }, [refreshThreads])

  // Fetch messages whenever the selected thread changes. Marks the thread
  // read in parallel so the unread badge clears on open.
  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([])
      setMessagesError(null)
      return
    }
    let alive = true
    setMessagesLoading(true)
    setMessagesError(null)
    Promise.all([
      fetchMessagesForConversation(selectedThreadId),
      markConversationRead(selectedThreadId),
    ])
      .then(([rows]) => {
        if (!alive) return
        setMessages(rows)
        // Optimistically clear the thread's unread badge in local state so
        // the left pane updates immediately. The next refreshThreads call
        // will reconcile against the server-rolled-up value.
        setThreads(prev => prev.map(t =>
          t.id === selectedThreadId ? { ...t, conv_inbound_unread_count: 0 } : t,
        ))
      })
      .catch(err => { if (alive) setMessagesError(err.message || String(err)) })
      .finally(() => { if (alive) setMessagesLoading(false) })
    return () => { alive = false }
  }, [selectedThreadId])

  // Scroll to bottom on message-list change so the latest reply is visible.
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, selectedThreadId])

  const selectedThread = useMemo(
    () => threads.find(t => t.id === selectedThreadId) || null,
    [threads, selectedThreadId],
  )

  // ── Send handler ────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!selectedThread) return
    const body = draft.trim()
    if (!body) return
    if (body.length > 1600) {
      toast.error('Message exceeds 1600-character SMS limit. Shorten and try again.')
      return
    }
    setSending(true)
    try {
      const result = await sendReplyToConversation(selectedThread, body)
      const isMock = result?.mode === 'mock'
      toast.success(isMock ? 'Reply queued (mock mode — Twilio not configured)' : 'Reply sent')
      setDraft('')
      // Refetch both panes so the new outbound message and the rolled-up
      // last-message preview/timestamp are reflected immediately.
      const [refreshedMsgs] = await Promise.all([
        fetchMessagesForConversation(selectedThread.id),
        refreshThreads({ background: true }),
      ])
      setMessages(refreshedMsgs)
      // Keep focus on composer for rapid-fire replies.
      composerRef.current?.focus()
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }, [draft, refreshThreads, selectedThread, toast])

  // Composer submit on Cmd/Ctrl + Enter; plain Enter inserts a newline.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const title = widget.widget_title || 'Conversations'
  const threadCount = threads.length
  const totalUnread = threads.reduce((sum, t) => sum + (t.conv_inbound_unread_count || 0), 0)

  // ── Render ──────────────────────────────────────────────────────────
  const paneHeight = isMobile ? PANE_HEIGHT_MOBILE : PANE_HEIGHT_DESKTOP

  // Mobile: a thread is "open" when selectedThreadId is set; the back button
  // returns to the list view. Desktop shows both panes side-by-side.
  const showMobileList = isMobile && !selectedThreadId
  const showMobileThread = isMobile && selectedThreadId

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px 10px 16px',
          background: '#fafbfd',
          borderBottom: collapsed ? 'none' : `1px solid ${C.border}`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 4,
            background: '#e8f8f2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon
              path="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
              size={12}
              color="#1a7a4e"
            />
          </div>
          <span style={{
            fontSize: 13, fontWeight: 600, color: C.textPrimary,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {title}
          </span>
          <span style={{
            background: C.page, color: C.textSecondary,
            fontSize: 11, fontWeight: 600,
            padding: '1px 8px', borderRadius: 10,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {threadCount}
          </span>
          {totalUnread > 0 && (
            <span style={{
              background: '#fce8e8', color: '#8a1a1a',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              padding: '2px 8px', borderRadius: 10,
              textTransform: 'uppercase',
            }}>
              {totalUnread} unread
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); refreshThreads() }}
            title="Refresh"
            disabled={threadsLoading}
            style={{
              background: C.card, color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 5,
              padding: isMobile ? '8px 10px' : '4px 8px',
              fontSize: isMobile ? 13 : 11.5,
              cursor: threadsLoading ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              opacity: threadsLoading ? 0.6 : 1,
              minHeight: isMobile ? 36 : undefined,
            }}
          >
            <Icon path="M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M20.49 15A9 9 0 015.64 18.36L1 14" size={isMobile ? 13 : 11} color="currentColor" />
            {isMobile ? '' : 'Refresh'}
          </button>
          <Icon
            path={collapsed ? 'M9 5l7 7-7 7' : 'M19 9l-7 7-7-7'}
            size={14}
            color={C.textMuted}
          />
        </div>
      </div>

      {/* Collapsed body */}
      {collapsed && null}

      {/* Body */}
      {!collapsed && (
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          height: paneHeight,
          maxHeight: paneHeight,
        }}>
          {/* Left pane — thread list */}
          {(!isMobile || showMobileList) && (
            <div style={{
              width: isMobile ? '100%' : THREAD_LIST_WIDTH,
              flexShrink: 0,
              borderRight: isMobile ? 'none' : `1px solid ${C.border}`,
              borderBottom: isMobile ? `1px solid ${C.border}` : 'none',
              display: 'flex', flexDirection: 'column',
              minHeight: 0,
            }}>
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {threadsLoading && (
                  <div style={{
                    padding: 24, fontSize: 12, color: C.textMuted,
                    textAlign: 'center',
                  }}>
                    Loading threads…
                  </div>
                )}
                {threadsError && (
                  <div style={{
                    padding: 12, fontSize: 12, color: '#8a1a1a',
                    background: '#fce8e8', borderBottom: `1px solid ${C.border}`,
                  }}>
                    {threadsError}
                  </div>
                )}
                {!threadsLoading && !threadsError && threads.length === 0 && (
                  <div style={{
                    padding: '32px 20px',
                    fontSize: 12.5, color: C.textMuted,
                    textAlign: 'center', lineHeight: 1.6,
                  }}>
                    <div style={{ marginBottom: 6, fontWeight: 600, color: C.textSecondary }}>
                      No conversations yet
                    </div>
                    Threads appear here when an SMS or email is sent to — or received from — this record's contact.
                  </div>
                )}
                {threads.map(thread => (
                  <ThreadListItem
                    key={thread.id}
                    thread={thread}
                    selected={thread.id === selectedThreadId}
                    onSelect={() => setSelectedThreadId(thread.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Right pane — active thread */}
          {(!isMobile || showMobileThread) && (
            <div style={{
              flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column',
              background: C.cardSecondary || '#f7f9fc',
            }}>
              {!selectedThread ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 20, textAlign: 'center',
                  color: C.textMuted, fontSize: 12.5, lineHeight: 1.6,
                }}>
                  {threads.length === 0
                    ? 'Send an SMS notification to this record\'s contact to start a thread.'
                    : 'Select a thread on the left to view messages and reply.'}
                </div>
              ) : (
                <>
                  <ThreadHeader
                    thread={selectedThread}
                    isMobile={isMobile}
                    onBack={isMobile ? () => setSelectedThreadId(null) : null}
                  />
                  <div
                    ref={messagesScrollRef}
                    style={{
                      flex: 1, overflowY: 'auto',
                      padding: '12px 16px',
                      background: '#f7f9fc',
                      minHeight: 0,
                    }}
                  >
                    {messagesLoading && (
                      <div style={{
                        fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 16,
                      }}>
                        Loading messages…
                      </div>
                    )}
                    {messagesError && (
                      <div style={{
                        padding: 10, fontSize: 12, color: '#8a1a1a',
                        background: '#fce8e8', border: '1px solid #f3b4b4',
                        borderRadius: 6, marginBottom: 10,
                      }}>
                        {messagesError}
                      </div>
                    )}
                    {!messagesLoading && messages.length === 0 && !messagesError && (
                      <div style={{
                        fontSize: 12, color: C.textMuted, textAlign: 'center', padding: 16,
                      }}>
                        No messages on this thread yet.
                      </div>
                    )}
                    {messages.map(msg => (
                      <MessageBubble key={msg.id} message={msg} />
                    ))}
                  </div>

                  {/* Composer */}
                  <Composer
                    draft={draft}
                    setDraft={setDraft}
                    sending={sending}
                    onSend={handleSend}
                    onKeyDown={handleKeyDown}
                    composerRef={composerRef}
                    channel={selectedThread.conv_channel}
                    customerAddress={selectedThread.conv_customer_address}
                    isMobile={isMobile}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ThreadListItem — one row in the left pane
// ---------------------------------------------------------------------------
function ThreadListItem({ thread, selected, onSelect }) {
  const channel = describeChannel(thread.conv_channel)
  const unread = thread.conv_inbound_unread_count || 0
  const direction = thread.conv_last_message_direction
  const preview = thread.conv_last_message_preview || '—'

  return (
    <div
      onClick={onSelect}
      style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        background: selected ? '#eff6ff' : 'transparent',
        borderLeft: selected ? '3px solid #1a5a8a' : '3px solid transparent',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = '#f7f9fc' }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 3,
          background: channel.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Icon path={channel.iconPath} size={10} color={channel.color} />
        </div>
        <span style={{
          fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
          fontFamily: 'JetBrains Mono, monospace',
          flexShrink: 0,
        }}>
          {thread.conv_record_number}
        </span>
        {unread > 0 && (
          <span style={{
            background: '#e85c5c', color: '#fff',
            fontSize: 10, fontWeight: 700,
            padding: '1px 6px', borderRadius: 9,
            minWidth: 18, textAlign: 'center',
          }}>
            {unread}
          </span>
        )}
        <span style={{
          marginLeft: 'auto', fontSize: 10.5, color: C.textMuted,
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {relativeTime(thread.conv_last_message_at)}
        </span>
      </div>
      <div style={{
        fontSize: 12, color: C.textSecondary, marginBottom: 2,
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {thread.conv_customer_address || '—'}
      </div>
      <div style={{
        fontSize: 11.5, color: C.textMuted,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        lineHeight: 1.4,
      }}>
        {direction === 'outbound' && (
          <span style={{ color: C.textMuted, fontStyle: 'italic' }}>You: </span>
        )}
        {preview}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ThreadHeader — top of the right pane, identifies the active thread
// ---------------------------------------------------------------------------
function ThreadHeader({ thread, isMobile, onBack }) {
  const channel = describeChannel(thread.conv_channel)
  const status = thread.conv_status

  return (
    <div style={{
      padding: '10px 16px',
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 4, display: 'flex', alignItems: 'center',
            color: C.textSecondary,
          }}
          title="Back to thread list"
        >
          <Icon path="M15 18l-6-6 6-6" size={16} color="currentColor" />
        </button>
      )}
      <div style={{
        width: 26, height: 26, borderRadius: 5,
        background: channel.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon path={channel.iconPath} size={13} color={channel.color} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: C.textPrimary,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {thread.conv_record_number}
          </span>
          <span style={{
            fontSize: 11, color: channel.color, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 0.3,
          }}>
            {channel.label}
          </span>
          {status && (
            <span style={{
              fontSize: 10.5, color: C.textMuted,
              padding: '1px 6px', borderRadius: 9,
              background: C.page,
              textTransform: 'capitalize',
            }}>
              {String(status).replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <div style={{
          fontSize: 11.5, color: C.textSecondary, marginTop: 2,
          fontFamily: 'JetBrains Mono, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {thread.conv_customer_address || '—'}
          {!isMobile && thread.conv_our_address && (
            <span style={{ color: C.textMuted }}>{' ← '}{thread.conv_our_address}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageBubble — one row in the message timeline
// ---------------------------------------------------------------------------
function MessageBubble({ message }) {
  const dir = describeDirection(message.msg_direction)
  const isFailed = message.msg_status === 'failed'
  const isQueued = message.msg_status === 'queued'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: dir.align,
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '78%',
        background: isFailed ? '#fce8e8' : dir.bg,
        border: `1px solid ${isFailed ? '#f3b4b4' : dir.border}`,
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 13, lineHeight: 1.45,
        color: isFailed ? '#8a1a1a' : dir.color,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {message.msg_body || '—'}
      </div>
      <div style={{
        marginTop: 3,
        fontSize: 10.5, color: dir.meta,
        display: 'flex', gap: 6, alignItems: 'center',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <span>{message.msg_record_number}</span>
        <span style={{ color: C.textMuted }}>•</span>
        <span>{absoluteTime(message.msg_created_at)}</span>
        {isQueued && (
          <span style={{ color: C.textMuted, fontStyle: 'italic' }}>• queued</span>
        )}
        {isFailed && (
          <span style={{ color: '#8a1a1a', fontWeight: 600 }} title={message.msg_provider_error_message || ''}>
            • failed
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Composer — textarea + Send button at the bottom of the right pane
// ---------------------------------------------------------------------------
function Composer({
  draft, setDraft, sending, onSend, onKeyDown, composerRef,
  channel, customerAddress, isMobile,
}) {
  const remaining = 1600 - (draft?.length || 0)
  const tooLong = remaining < 0
  const disabled = sending || !draft.trim() || tooLong

  // For v1 only SMS replies are wired. Email composer is part of the
  // Communications Module build (TipTap + locked regions); render a
  // friendly notice on non-SMS threads instead of a broken composer.
  if (channel !== 'sms') {
    return (
      <div style={{
        padding: '12px 16px',
        borderTop: `1px solid ${C.border}`,
        background: C.card,
        fontSize: 12, color: C.textMuted, fontStyle: 'italic',
        textAlign: 'center',
      }}>
        Replies on {channel || 'this channel'} threads aren't supported yet — the email composer ships with the Communications Module.
      </div>
    )
  }

  return (
    <div style={{
      padding: '10px 14px 12px 14px',
      borderTop: `1px solid ${C.border}`,
      background: C.card,
    }}>
      <textarea
        ref={composerRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`SMS to ${customerAddress || 'customer'}…`}
        rows={isMobile ? 3 : 2}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: 'Inter, sans-serif',
          border: `1px solid ${tooLong ? '#e85c5c' : C.border}`,
          borderRadius: 6,
          resize: 'vertical',
          outline: 'none',
          background: '#fff',
          color: C.textPrimary,
          minHeight: 60,
          boxSizing: 'border-box',
          lineHeight: 1.4,
        }}
        disabled={sending}
      />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 11, color: C.textMuted,
      }}>
        <span style={{ color: tooLong ? '#e85c5c' : C.textMuted }}>
          {tooLong ? `${Math.abs(remaining)} over limit` : `${remaining} characters left`}
          {!isMobile && (
            <span style={{ marginLeft: 10, fontStyle: 'italic' }}>
              Cmd/Ctrl + Enter to send
            </span>
          )}
        </span>
        <button
          onClick={onSend}
          disabled={disabled}
          style={{
            background: disabled ? C.borderDark : C.emerald,
            color: '#fff',
            border: 'none', borderRadius: 5,
            padding: isMobile ? '10px 18px' : '6px 14px',
            fontSize: isMobile ? 13 : 12,
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            minHeight: isMobile ? 38 : undefined,
          }}
          onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = C.emeraldMid }}
          onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = C.emerald }}
        >
          <Icon
            path="M22 2L11 13 M22 2l-7 20-4-9-9-4 20-7z"
            size={isMobile ? 13 : 11}
            color="#fff"
          />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
