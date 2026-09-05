import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import { useIsMobile } from '../lib/useMediaQuery'
import {
  fetchConversationById,
  fetchMessagesForConversation,
  markConversationRead,
  sendReplyToConversation,
  describeChannel,
  describeDirection,
  fetchAttachmentsForMessages,
  createAttachmentSignedUrl,
  formatBytes,
} from '../data/conversationsService'
import { fetchCommunicationTimeline } from '../data/omniChannelService'
import { dragCarriesEmail, snapshotDrop, readDropSnapshot } from '../lib/droppedEmail'
import ComposeEmailModal from './ComposeEmailModal'
import ComposeSmsModal from './ComposeSmsModal'
import LogActivityModal from './LogActivityModal'
import LogDroppedEmailModal from './LogDroppedEmailModal'
// The widget knows its parent only through widget_config.fk, so the modal
// cannot infer the anchor table itself. One definition, shared with the
// layout palette and the reply path (conversationAnchors.js).
import { FK_TO_ANCHOR_OBJECT } from '../lib/conversationAnchors'
import { CONVERSATION_CARD_TITLE } from '../lib/layoutCards'


// ---------------------------------------------------------------------------
// ConversationPanel — the OMNI-CHANNEL communication area on a record.
//
// Nicholas, 2026-08-25: "we definitely need to make sure we have one omni
// channel for communication and tracking area for reach. For contacts and
// accounts," and "phone call messages need to be listed under the Conversations
// tab, which I'd prefer."
//
// So the left pane is no longer a list of email/SMS threads. It is every
// communication with this record in one time-ordered list — email threads,
// text threads, and logged calls, meetings and notes — fed by
// list_communication_timeline. On an account it also carries the contacts'
// own history, labelled with the contact it came through, because a call with
// a person at a company is a call with the company.
//
// Three ways in, all from this one card:
//   • New Email / New Text — LEAP sends it.
//   • Log a Call           — a call that happened on somebody's phone.
//   • Drop an email on it  — a message that happened in Outlook. The card is
//                            a drop target; what was read is shown for
//                            checking before anything is written.
//
// Layout:
//   ┌──────────── card header (collapsible) ─────────────┐
//   │ icon  Conversations  [3]      Log a Call · New ↻   │
//   ├─────────────────┬───────────────────────────────────┤
//   │ omni-channel    │ thread timeline, or the detail of │
//   │ feed            │ a logged call                     │
//   │                 │ ───────── composer ─────────────  │
//   └─────────────────┴───────────────────────────────────┘
//
// Mobile (≤768px): single-column, same as before.
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

// "12 min" / "1 hr 5 min" — a logged call's length, as a person would say it.
function formatDuration(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return null
  const mins = Math.round(s / 60)
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`
}

export default function ConversationPanelWidget({
  widget, parentRecordId, parentTable,
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
  // The record this card lives on — its Related To. RecordDetail passes its
  // table name; a card placed since 2026-09-05 stores the object it sits on;
  // the FK map is the fallback for a card seeded before that.
  const parentObject = parentTable || config.related_object || FK_TO_ANCHOR_OBJECT[fk] || null
  // SMS compose context: the account/contact/project the new thread anchors to
  // (derived from this panel's own FK when it matches, else from config), plus
  // an optional prefilled recipient phone + name for the composer.
  const smsAccountId = fk === 'account_id' ? parentRecordId : (config.sms_account_id || null)
  const smsContactId = fk === 'contact_id' ? parentRecordId : (config.sms_contact_id || null)
  const smsProjectId = fk === 'project_id' ? parentRecordId : (config.sms_project_id || null)
  const smsToPhone = config.sms_to_phone || null
  const smsRecipientName = config.sms_recipient_name || null
  // Email compose defaults — mirror the SMS ones. A caller (e.g. the
  // service-provider panel) can seed the composer's recipient directly;
  // otherwise the composer resolves a default from the anchor record.
  const emailToEmail = config.email_to || null
  const emailRecipientName = config.email_recipient_name || null
  const emailContactId = fk === 'contact_id' ? parentRecordId : (config.email_contact_id || null)
  const isMobile = useIsMobile()
  const toast = useToast()

  const [collapsed, setCollapsed] = useState(false)
  // The omni-channel feed: conversations AND logged activities, newest first.
  const [entries, setEntries] = useState([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState(null)

  // What's open in the right pane — a thread or a logged activity.
  const [selectedId, setSelectedId] = useState(null)
  const [thread, setThread] = useState(null)        // full conversation row (carries the reply anchors)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState(null)
  // Attachments keyed by message id. Fetched once when the thread loads,
  // re-fetched when the messages list refreshes (after a send).
  const [attachmentsByMessage, setAttachmentsByMessage] = useState({})

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // New-email composer modal — opens via the header "New Email" button.
  const [showCompose, setShowCompose] = useState(false)
  // New-text composer modal — opens via the header "New Text" button on SMS panels.
  const [showSmsCompose, setShowSmsCompose] = useState(false)
  // Log-a-call composer — a call that happened on somebody's phone.
  const [showLogActivity, setShowLogActivity] = useState(false)
  // Emails dropped on the card, waiting to be checked and filed. A queue,
  // because a drag can carry more than one message.
  const [droppedEmails, setDroppedEmails] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [dropBusy, setDropBusy] = useState(false)

  const messagesScrollRef = useRef(null)
  const composerRef = useRef(null)
  const dragDepth = useRef(0)

  const selectedEntry = useMemo(
    () => entries.find(e => e.entry_id === selectedId) || null,
    [entries, selectedId],
  )
  const isActivityOpen = selectedEntry?.entry_kind === 'activity'

  // ── Loaders ─────────────────────────────────────────────────────────
  const refreshFeed = useCallback(async (opts = {}) => {
    if (!parentObject || !parentRecordId) {
      setEntries([])
      setFeedLoading(false)
      return
    }
    if (!opts.background) setFeedLoading(true)
    setFeedError(null)
    try {
      const rows = await fetchCommunicationTimeline(parentObject, parentRecordId, channelFilter)
      setEntries(rows)
      // Keep the current selection if it's still in the list; otherwise
      // clear it so the right pane returns to the empty state.
      setSelectedId(prev => (prev && rows.some(r => r.entry_id === prev) ? prev : null))
    } catch (err) {
      setFeedError(err.message || String(err))
    } finally {
      if (!opts.background) setFeedLoading(false)
    }
  }, [parentObject, parentRecordId, channelFilter])

  useEffect(() => { refreshFeed() }, [refreshFeed])

  // Fetch the selected thread in full plus its messages. A logged activity
  // needs neither — the feed row already carries everything it shows.
  useEffect(() => {
    if (!selectedId || selectedEntry?.entry_kind !== 'conversation') {
      setThread(null)
      setMessages([])
      setMessagesError(null)
      setAttachmentsByMessage({})
      return undefined
    }
    let alive = true
    setMessagesLoading(true)
    setMessagesError(null)
    Promise.all([
      fetchConversationById(selectedId),
      fetchMessagesForConversation(selectedId),
      markConversationRead(selectedId),
    ])
      .then(async ([conv, rows]) => {
        if (!alive) return
        setThread(conv)
        setMessages(rows)
        // Pull attachments for every message in one batched query
        if (rows.length > 0) {
          try {
            const byMsg = await fetchAttachmentsForMessages(rows.map(r => r.id))
            if (alive) setAttachmentsByMessage(byMsg)
          } catch (e) {
            // Non-fatal — the bubble renders without paperclips if the
            // attachments query failed.
            // eslint-disable-next-line no-console
            console.warn('fetchAttachmentsForMessages failed', e)
            if (alive) setAttachmentsByMessage({})
          }
        } else {
          setAttachmentsByMessage({})
        }
        // Optimistically clear the thread's unread badge in local state so
        // the left pane updates immediately. The next refreshFeed call
        // will reconcile against the server-rolled-up value.
        setEntries(prev => prev.map(t =>
          t.entry_id === selectedId ? { ...t, unread_count: 0 } : t,
        ))
      })
      .catch(err => { if (alive) setMessagesError(err.message || String(err)) })
      .finally(() => { if (alive) setMessagesLoading(false) })
    return () => { alive = false }
  }, [selectedId, selectedEntry?.entry_kind])

  // Scroll to bottom on message-list change so the latest reply is visible.
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, selectedId])

  // ── Send handler ────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!thread) return
    const body = draft.trim()
    if (!body) return
    const channel = thread.conv_channel
    // SMS hard cap at 1600 chars (Twilio segmented limit); email is effectively
    // unlimited at the messages-table level.
    if (channel === 'sms' && body.length > 1600) {
      toast.error('Message exceeds 1600-character SMS limit. Shorten and try again.')
      return
    }
    setSending(true)
    try {
      const result = await sendReplyToConversation(thread, body)
      const isMock = result?.mode === 'mock'
      const channelName = channel === 'email' ? 'Email reply' : 'Reply'
      const provider = channel === 'email' ? 'Graph not yet configured' : 'Twilio not configured'
      toast.success(isMock ? `${channelName} queued (mock mode — ${provider})` : `${channelName} sent`)
      setDraft('')
      // Refetch both panes so the new outbound message and the rolled-up
      // last-message preview/timestamp are reflected immediately.
      const [refreshedMsgs] = await Promise.all([
        fetchMessagesForConversation(thread.id),
        refreshFeed({ background: true }),
      ])
      setMessages(refreshedMsgs)
      if (refreshedMsgs.length > 0) {
        try {
          const byMsg = await fetchAttachmentsForMessages(refreshedMsgs.map(r => r.id))
          setAttachmentsByMessage(byMsg)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('fetchAttachmentsForMessages on refresh failed', e)
        }
      }
      // Keep focus on composer for rapid-fire replies.
      composerRef.current?.focus()
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }, [draft, refreshFeed, thread, toast])

  // ── Compose-modal callback ──────────────────────────────────────────
  // The modal calls onSent with the newly-created conversation_id and
  // message_id. We refresh the feed in the background and select the new
  // thread so the user sees their just-sent email immediately.
  const handleComposeSent = useCallback(async ({ conversationId }) => {
    await refreshFeed({ background: true })
    if (conversationId) setSelectedId(conversationId)
  }, [refreshFeed])

  // ── Dropping an email on the card ───────────────────────────────────
  //
  // The DataTransfer is snapshotted synchronously: its item list is emptied
  // the moment this handler returns, so reading it after an await silently
  // loses the file — which is how a drop target ends up doing nothing at all.
  const handleDrop = useCallback(async (e) => {
    if (!parentObject) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragActive(false)
    const snapshot = snapshotDrop(e.dataTransfer)
    setDropBusy(true)
    try {
      const { emails, errors } = await readDropSnapshot(snapshot)
      if (emails.length) setDroppedEmails(prev => [...prev, ...emails])
      for (const message of errors) toast.error(message)
    } catch (err) {
      toast.error(err.message || 'That drop could not be read as an email.')
    } finally {
      setDropBusy(false)
    }
  }, [parentObject, toast])

  const handleDragEnter = useCallback((e) => {
    if (!parentObject || !dragCarriesEmail(e.dataTransfer)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }, [parentObject])

  const handleDragOver = useCallback((e) => {
    if (!parentObject || !dragCarriesEmail(e.dataTransfer)) return
    // Without preventDefault the browser navigates away to the dropped file.
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [parentObject])

  const handleDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }, [])

  const handleEmailFiled = useCallback(async (result) => {
    setDroppedEmails(prev => prev.slice(1))
    if (result?.was_duplicate) {
      toast.success('That email was already filed — opening the copy already on this record.')
    } else {
      const matched = (result?.participants || []).filter(p => p.matched_object).length
      const total = (result?.participants || []).length
      toast.success(total
        ? `Email filed — ${matched} of ${total} ${total === 1 ? 'address' : 'addresses'} matched to LEAP records.`
        : 'Email filed.')
    }
    await refreshFeed({ background: true })
    if (result?.conversation_id) setSelectedId(result.conversation_id)
  }, [refreshFeed, toast])

  const handleActivityLogged = useCallback(async () => {
    setShowLogActivity(false)
    toast.success('Logged.')
    await refreshFeed({ background: true })
  }, [refreshFeed, toast])

  // Composer submit on Cmd/Ctrl + Enter; plain Enter inserts a newline.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const title = widget.widget_title || CONVERSATION_CARD_TITLE
  const entryCount = entries.length
  const totalUnread = entries.reduce((sum, t) => sum + (t.unread_count || 0), 0)
  // Calls and other logged activities belong to the record, not to a thread,
  // so a channel-filtered panel (an SMS-only card, say) never shows them.
  const canLogActivity = !!parentObject && !channelFilter
  const canFileEmail = !!parentObject && channelFilter !== 'sms'

  // ── Render ──────────────────────────────────────────────────────────
  const paneHeight = isMobile ? PANE_HEIGHT_MOBILE : PANE_HEIGHT_DESKTOP

  // Mobile: an entry is "open" when selectedId is set; the back button
  // returns to the list view. Desktop shows both panes side-by-side.
  const showMobileList = isMobile && !selectedId
  const showMobileThread = isMobile && selectedId

  const headerButton = (extra = {}) => ({
    background: C.card, color: C.textSecondary,
    border: `1px solid ${C.border}`, borderRadius: 5,
    padding: isMobile ? '8px 10px' : '4px 8px',
    fontSize: isMobile ? 13 : 11.5,
    cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 4,
    minHeight: isMobile ? 36 : undefined,
    fontFamily: 'inherit',
    ...extra,
  })

  return (
    <>
      <div
        onDragEnter={canFileEmail ? handleDragEnter : undefined}
        onDragOver={canFileEmail ? handleDragOver : undefined}
        onDragLeave={canFileEmail ? handleDragLeave : undefined}
        onDrop={canFileEmail ? handleDrop : undefined}
        style={{
          background: C.card,
          border: `1px solid ${dragActive ? (C.emerald || '#3ecf8e') : C.border}`,
          boxShadow: dragActive ? `0 0 0 3px rgba(62,207,142,0.18)` : 'none',
          borderRadius: 8,
          marginBottom: 12,
          overflow: 'hidden',
          position: 'relative',
          transition: 'border-color 150ms ease, box-shadow 150ms ease',
        }}
      >
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
            {entryCount}
          </span>
          {totalUnread > 0 && (
            <span style={{
              background: '#e8f1fb', color: '#1e466b',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
              padding: '2px 8px', borderRadius: 10,
              textTransform: 'uppercase',
            }}>
              {totalUnread} unread
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {canLogActivity && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowLogActivity(true) }}
              title="Log a call, meeting or note that happened outside LEAP"
              style={headerButton()}
            >
              <Icon path="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z"
                    size={isMobile ? 13 : 11} color="currentColor" />
              {isMobile ? '' : 'Log a Call'}
            </button>
          )}
          {channelFilter === 'sms' ? (
            <button
              onClick={(e) => { e.stopPropagation(); setShowSmsCompose(true) }}
              title="Send a new text message related to this record"
              style={headerButton({
                background: C.emerald || '#3ecf8e', color: '#fff',
                border: 'none', fontWeight: 600,
                padding: isMobile ? '8px 10px' : '4px 10px',
              })}
            >
              <Icon path="M12 5v14 M5 12h14" size={isMobile ? 13 : 11} color="currentColor" />
              {isMobile ? '' : 'New Text'}
            </button>
          ) : parentObject && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCompose(true) }}
              title="Compose a new email related to this record"
              style={headerButton({
                background: C.emerald || '#3ecf8e', color: '#fff',
                border: 'none', fontWeight: 600,
                padding: isMobile ? '8px 10px' : '4px 10px',
              })}
            >
              <Icon path="M12 5v14 M5 12h14" size={isMobile ? 13 : 11} color="currentColor" />
              {isMobile ? '' : 'New Email'}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); refreshFeed() }}
            title="Refresh"
            disabled={feedLoading}
            style={headerButton({
              cursor: feedLoading ? 'wait' : 'pointer',
              opacity: feedLoading ? 0.6 : 1,
            })}
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
          {/* Left pane — the omni-channel feed */}
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
                {feedLoading && (
                  <div style={{
                    padding: 24, fontSize: 12, color: C.textMuted,
                    textAlign: 'center',
                  }}>
                    Loading…
                  </div>
                )}
                {feedError && (
                  <div style={{
                    padding: 12, fontSize: 12, color: '#1e466b',
                    background: '#e8f1fb', borderBottom: `1px solid ${C.border}`,
                  }}>
                    {feedError}
                  </div>
                )}
                {!feedLoading && !feedError && entries.length === 0 && (
                  <div style={{
                    padding: '32px 20px',
                    fontSize: 12.5, color: C.textMuted,
                    textAlign: 'center', lineHeight: 1.6,
                  }}>
                    <div style={{ marginBottom: 6, fontWeight: 600, color: C.textSecondary }}>
                      Nothing logged yet
                    </div>
                    Emails and texts appear here when they are sent or received.
                    {canLogActivity && <> Use <strong>Log a Call</strong> for a call that happened on the phone,</>}
                    {canFileEmail && <> or drag an email straight onto this card to file it.</>}
                  </div>
                )}
                {entries.map(entry => (
                  <FeedListItem
                    key={`${entry.entry_kind}-${entry.entry_id}`}
                    entry={entry}
                    selected={entry.entry_id === selectedId}
                    onSelect={() => setSelectedId(entry.entry_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Right pane — the open thread, or the open logged activity */}
          {(!isMobile || showMobileThread) && (
            <div style={{
              flex: 1, minWidth: 0,
              display: 'flex', flexDirection: 'column',
              background: C.cardSecondary || '#f7f9fc',
            }}>
              {isActivityOpen ? (
                <ActivityDetailPane
                  entry={selectedEntry}
                  isMobile={isMobile}
                  onBack={isMobile ? () => setSelectedId(null) : null}
                />
              ) : !thread ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 20, textAlign: 'center',
                  color: C.textMuted, fontSize: 12.5, lineHeight: 1.6,
                }}>
                  {messagesLoading
                    ? 'Loading…'
                    : entries.length === 0
                      ? (channelFilter === 'sms'
                          ? 'Click New Text above to send this provider a text and start a thread.'
                          : 'Send an email, log a call, or drag an email onto this card to start the record of who you have reached.')
                      : 'Select an entry on the left to read it.'}
                </div>
              ) : (
                <>
                  <ThreadHeader
                    thread={thread}
                    isMobile={isMobile}
                    onBack={isMobile ? () => setSelectedId(null) : null}
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
                        padding: 10, fontSize: 12, color: '#1e466b',
                        background: '#e8f1fb', border: '1px solid #bcd9f2',
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
                      <MessageBubble
                        key={msg.id}
                        message={msg}
                        attachments={attachmentsByMessage[msg.id] || []}
                      />
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
                    channel={thread.conv_channel}
                    customerAddress={thread.conv_customer_address}
                    isMobile={isMobile}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Drop affordance — only while something is actually being dragged over
          the card, so it never competes with the content the rest of the time. */}
      {(dragActive || dropBusy) && canFileEmail && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(240, 250, 246, 0.94)',
          border: `2px dashed ${C.emerald || '#3ecf8e'}`,
          borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 8, pointerEvents: 'none', zIndex: 3,
          textAlign: 'center', padding: 20,
        }}>
          <Icon path="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6"
                size={22} color="#1a7a4e" />
          <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0d1a2e' }}>
            {dropBusy ? 'Reading the message…' : 'Drop the email here to file it'}
          </div>
          {!dropBusy && (
            <div style={{ fontSize: 11.5, color: C.textSecondary, maxWidth: 320, lineHeight: 1.5 }}>
              LEAP reads who it is from, who it went to, and when — and shows you
              before anything is saved.
            </div>
          )}
        </div>
      )}
      </div>

      {/* Compose new email modal — opened by the header "New Email" button */}
      <ComposeEmailModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        onSent={handleComposeSent}
        anchorObject={parentObject}
        anchorRecordId={parentRecordId}
        defaultRecipientEmail={emailToEmail || ''}
        defaultRecipientName={emailRecipientName || ''}
        defaultContactId={emailContactId}
      />
      {/* Compose new text modal — opened by the header "New Text" button on SMS panels */}
      <ComposeSmsModal
        open={showSmsCompose}
        onClose={() => setShowSmsCompose(false)}
        onSent={handleComposeSent}
        defaultToPhone={smsToPhone}
        recipientName={smsRecipientName}
        accountId={smsAccountId}
        contactId={smsContactId}
        projectId={smsProjectId}
        anchorObject={parentObject}
        anchorRecordId={parentRecordId}
      />
      {/* Log a call / meeting / note — the same composer the Activity tab uses,
          reached from the one place all communication is read. */}
      {showLogActivity && parentObject && (
        <LogActivityModal
          tableName={parentObject}
          recordId={parentRecordId}
          defaultType="Call"
          onClose={() => setShowLogActivity(false)}
          onLogged={handleActivityLogged}
        />
      )}
      {/* One dropped email at a time, checked before it is written. */}
      {droppedEmails.length > 0 && parentObject && (
        <LogDroppedEmailModal
          key={`${droppedEmails[0].internetMessageId || droppedEmails[0].subject}-${droppedEmails.length}`}
          parsed={droppedEmails[0]}
          targetObject={parentObject}
          targetId={parentRecordId}
          targetLabel={title === CONVERSATION_CARD_TITLE ? 'this record' : title}
          onClose={() => setDroppedEmails(prev => prev.slice(1))}
          onFiled={handleEmailFiled}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// FeedListItem — one row in the omni-channel feed.
//
// A thread and a logged call are different things, and the row says which:
// a thread shows its counterparty and last message, a call shows who logged it
// and how long it ran. What they share is the channel icon and the time, which
// is what makes one list readable.
// ---------------------------------------------------------------------------
function FeedListItem({ entry, selected, onSelect }) {
  const isActivity = entry.entry_kind === 'activity'
  const channel = describeChannel(entry.channel)
  const unread = entry.unread_count || 0
  const preview = entry.preview || (isActivity ? 'No notes recorded' : '—')
  const badge = isActivity ? (entry.activity_type || channel.label) : channel.label
  const duration = isActivity ? formatDuration(entry.duration_seconds) : null

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
          fontSize: isActivity ? 11 : 12.5,
          fontWeight: isActivity ? 700 : 600,
          color: isActivity ? channel.color : C.textPrimary,
          fontFamily: isActivity ? 'inherit' : 'JetBrains Mono, monospace',
          textTransform: isActivity ? 'uppercase' : 'none',
          letterSpacing: isActivity ? 0.3 : 0,
          flexShrink: 0,
        }}>
          {isActivity ? badge : entry.record_number}
        </span>
        {unread > 0 && (
          <span style={{
            background: '#7eb3e8', color: '#fff',
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
          {relativeTime(entry.occurred_at)}
        </span>
      </div>
      {entry.subject && (
        <div style={{
          fontSize: 12.5, fontWeight: 600, color: C.textPrimary, marginBottom: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.subject}
        </div>
      )}
      <div style={{
        fontSize: 12, color: C.textSecondary, marginBottom: 2,
        fontFamily: isActivity ? 'inherit' : 'JetBrains Mono, monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {isActivity
          ? [entry.contact_name, entry.actor_name && `logged by ${entry.actor_name}`, duration]
              .filter(Boolean).join(' · ') || '—'
          : (entry.counterparty || '—')}
      </div>
      <div style={{
        fontSize: 11.5, color: C.textMuted,
        overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        lineHeight: 1.4,
      }}>
        {!isActivity && entry.direction === 'outbound' && (
          <span style={{ color: C.textMuted, fontStyle: 'italic' }}>You: </span>
        )}
        {preview}
      </div>
      {/* On an account, history reached through one of its contacts says so —
          otherwise a call with a person reads as a call with the company and
          there is no way to tell which person it was. */}
      {entry.via_label && (
        <div style={{
          marginTop: 5, display: 'inline-block',
          fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
          color: '#1e466b', background: '#e8f1fb',
          padding: '1px 7px', borderRadius: 9,
        }}>
          via {entry.via_label}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActivityDetailPane — the right pane for a logged call, meeting or note.
//
// It deliberately has no composer: a logged call is a record of something that
// already happened, and there is nothing to reply to.
// ---------------------------------------------------------------------------
function ActivityDetailPane({ entry, isMobile, onBack }) {
  const channel = describeChannel(entry.channel)
  const duration = formatDuration(entry.duration_seconds)
  const facts = [
    entry.direction && { label: 'Direction', value: entry.direction === 'outbound' ? 'Outbound' : 'Inbound' },
    duration && { label: 'Duration', value: duration },
    entry.contact_name && { label: 'Contact', value: entry.contact_name },
    entry.actor_name && { label: 'Logged by', value: entry.actor_name },
    entry.via_label && { label: 'On', value: entry.via_label },
  ].filter(Boolean)

  return (
    <>
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
              padding: 4, display: 'flex', alignItems: 'center', color: C.textSecondary,
            }}
            title="Back to the list"
          >
            <Icon path="M15 18l-6-6 6-6" size={16} color="currentColor" />
          </button>
        )}
        <div style={{
          width: 26, height: 26, borderRadius: 5, background: channel.bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon path={channel.iconPath} size={13} color={channel.color} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
              {entry.subject || entry.activity_type || 'Logged activity'}
            </span>
            <span style={{
              fontSize: 11, color: channel.color, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>
              {entry.activity_type || channel.label}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>
            {absoluteTime(entry.occurred_at) || 'Time not recorded'}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', minHeight: 0 }}>
        {facts.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '8px 18px',
            padding: '10px 12px', marginBottom: 12,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          }}>
            {facts.map(f => (
              <div key={f.label}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                  textTransform: 'uppercase', color: C.textMuted, marginBottom: 2,
                }}>
                  {f.label}
                </div>
                <div style={{ fontSize: 12.5, color: C.textPrimary }}>{f.value}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          padding: 12, fontSize: 13, lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: entry.body ? C.textPrimary : C.textMuted,
        }}>
          {entry.body || 'No notes were recorded on this activity.'}
        </div>
      </div>
    </>
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

// An email message whose body contains markup should render as HTML; plain
// bodies (SMS, or emails that arrived as plain text) keep the text path.
function isEmailHtml(message) {
  return message.msg_channel === 'email'
      && typeof message.msg_body === 'string'
      && /<[a-z][\s\S]*>/i.test(message.msg_body)
}

// ---------------------------------------------------------------------------
// MessageBubble — one row in the message timeline
// ---------------------------------------------------------------------------
function MessageBubble({ message, attachments = [] }) {
  const dir = describeDirection(message.msg_direction)
  const isFailed = message.msg_status === 'failed'
  const isQueued = message.msg_status === 'queued'

  // Open one attachment — mints a 5-min signed URL on click. Errors surface
  // via window.alert here because MessageBubble doesn't have access to the
  // toast context (it's rendered inside the message-list scroll container).
  const handleAttachmentClick = async (att, evt) => {
    if (evt) evt.preventDefault()
    try {
      const url = await createAttachmentSignedUrl(att)
      if (!url) throw new Error('No signed URL returned')
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      // eslint-disable-next-line no-alert
      window.alert(`Could not open attachment: ${e.message || e}`)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: dir.align,
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '78%',
        background: isFailed ? '#e8f1fb' : dir.bg,
        border: `1px solid ${isFailed ? '#bcd9f2' : dir.border}`,
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 13, lineHeight: 1.45,
        color: isFailed ? '#1e466b' : dir.color,
        whiteSpace: isEmailHtml(message) ? 'normal' : 'pre-wrap',
        wordBreak: 'break-word',
        overflowX: 'auto',
      }}>
        {isEmailHtml(message) ? (
          // Email bodies are HTML (composed in TipTap or received from real
          // mail clients). Render them, sanitized — showing raw markup as
          // text made every email unreadable. SMS stays plain text.
          // eslint-disable-next-line react/no-danger
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.msg_body) }} />
        ) : (
          message.msg_body || '—'
        )}
      </div>

      {/* Attachments — paperclip chips below the body, same max-width and
          alignment as the bubble so they read as part of the same message. */}
      {attachments.length > 0 && (
        <div style={{
          maxWidth: '78%', marginTop: 6,
          display: 'flex', flexDirection: 'column', gap: 4,
          alignItems: 'stretch',
        }}>
          {attachments.map(att => {
            const isPending  = att.ma_virus_scan_status === 'pending'
            const isInfected = att.ma_virus_scan_status === 'infected'
                            || att.ma_virus_scan_status === 'blocked'
            const blocked    = isInfected
            return (
              <button
                key={att.id}
                onClick={blocked ? undefined : (e) => handleAttachmentClick(att, e)}
                disabled={blocked}
                title={blocked
                  ? `Attachment blocked by virus scan — ${att.ma_virus_scan_detail || 'download disabled.'}`
                  : `Open ${att.ma_file_name}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px',
                  background: isFailed ? '#e8f1fb' : (blocked ? '#e8f1fb' : '#ffffff'),
                  border: `1px solid ${isFailed ? '#bcd9f2' : (blocked ? '#bcd9f2' : dir.border)}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: blocked ? '#1e466b' : dir.color,
                  cursor: blocked ? 'not-allowed' : 'pointer',
                  textAlign: 'left', width: '100%',
                  fontFamily: 'inherit',
                }}
              >
                <Icon
                  path="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
                  size={13}
                  color="currentColor"
                />
                <div style={{
                  flex: 1, minWidth: 0,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontWeight: 600,
                }}>
                  {att.ma_file_name}
                </div>
                <div style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
                  {formatBytes(att.ma_file_size_bytes)}
                </div>
                {isPending && (
                  <span style={{
                    background: '#e8f1fb', color: '#1e466b',
                    fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                    padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase',
                  }} title="Virus scan queued — the scanner runs every 5 minutes">
                    Scan pending
                  </span>
                )}
                {isInfected && (
                  <span style={{
                    background: '#e8f1fb', color: '#1e466b',
                    fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                    padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase',
                  }}>
                    Blocked
                  </span>
                )}
                {att.ma_delivery_method === 'signed_link' && (
                  <span style={{
                    background: '#e8f3fb', color: '#1a5a8a',
                    fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
                    padding: '1px 6px', borderRadius: 8, textTransform: 'uppercase',
                  }} title="Large file — ships as signed download link instead of inline attachment">
                    Link
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

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
          <span style={{ color: '#1e466b', fontWeight: 600 }}>
            • failed{message.msg_provider_error_code ? ` (${message.msg_provider_error_code})` : ''}
          </span>
        )}
      </div>

      {/* Failure reason — surfaced inline so the operational error is visible
          on mobile (where tooltips don't fire) and on desktop without hover.
          Wraps long Graph error bodies. */}
      {isFailed && message.msg_provider_error_message && (
        <div style={{
          maxWidth: '78%', marginTop: 4,
          padding: '6px 9px',
          background: '#eef5fc',
          border: '1px solid #bcd9f2',
          borderRadius: 6,
          fontSize: 11, lineHeight: 1.4,
          color: '#1e466b',
          fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.msg_provider_error_message}
        </div>
      )}
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
  // The 1600-char cap is Twilio's segmented-SMS limit; email has no cap.
  const isSms = channel === 'sms'
  const remaining = 1600 - (draft?.length || 0)
  const tooLong = isSms && remaining < 0
  const disabled = sending || !draft.trim() || tooLong

  // SMS and email replies both route through sendReplyToConversation (email
  // stays on this thread via conversation_id → send-email-v1). Anything else
  // has no reply transport yet.
  if (channel !== 'sms' && channel !== 'email') {
    return (
      <div style={{
        padding: '12px 16px',
        borderTop: `1px solid ${C.border}`,
        background: C.card,
        fontSize: 12, color: C.textMuted, fontStyle: 'italic',
        textAlign: 'center',
      }}>
        Replies on {channel || 'this channel'} threads aren't supported yet.
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
        placeholder={isSms
          ? `SMS to ${customerAddress || 'customer'}…`
          : `Email reply to ${customerAddress || 'customer'}…`}
        rows={isMobile ? 3 : 2}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 13,
          fontFamily: 'Inter, sans-serif',
          border: `1px solid ${tooLong ? '#7eb3e8' : C.border}`,
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
        <span style={{ color: tooLong ? '#7eb3e8' : C.textMuted }}>
          {isSms && (tooLong ? `${Math.abs(remaining)} over limit` : `${remaining} characters left`)}
          {!isSms && 'Sends as a Re: on this thread from the state mailbox'}
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
