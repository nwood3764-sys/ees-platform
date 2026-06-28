import { useState, useEffect, useRef, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { supabase } from '../lib/supabase'
import {
  loadUnreadCount,
  loadRecent,
  markRead,
  markAllRead,
} from '../data/notificationsService'

/**
 * In-app notification bell that lives in the global topbar. Shows an unread
 * badge sourced from notifications_unread_count() and opens a popover listing
 * the most recent 30 notifications via notifications_list_recent(). Clicking
 * a row marks it read and jumps to its source record. Marks-all-read clears
 * the badge in one shot.
 *
 * Notifications are produced server-side only — by the tasks AFTER trigger
 * (tasks_create_notification_iu) and by the automation executor as it fires.
 * The client never inserts to the notifications table.
 *
 * Live delivery: subscribes to the supabase_realtime publication on the
 * notifications table. The RLS policy notifications_select_own restricts
 * realtime payloads to rows where recipient_id matches the caller's
 * public.users.id, so the subscription only fires for the current user's
 * notifications — no client-side filtering required and no other user's
 * data is ever transmitted. Slow 5-minute poll kept as a fallback in case
 * the websocket drops; the realtime channel handles the common case.
 */
export default function NotificationBell({ onNavigateToRecord }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [busyAll, setBusyAll] = useState(false)
  const wrapRef = useRef(null)
  const pollRef = useRef(null)
  const channelRef = useRef(null)
  const openRef = useRef(false)
  useEffect(() => { openRef.current = open }, [open])

  // Refresh badge count from the server.
  const refreshUnread = useCallback(async () => {
    try { setUnread(await loadUnreadCount()) } catch { /* ignore polling errors */ }
  }, [])

  // Initial fetch + slow-poll fallback (every 5 min) in case realtime drops.
  useEffect(() => {
    refreshUnread()
    pollRef.current = setInterval(refreshUnread, 5 * 60 * 1000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [refreshUnread])

  // Realtime subscription: pop new notifications instantly when they land.
  // We only listen for INSERTs — UPDATE/DELETE on notifications happens via
  // RPC and we always know about those locally.
  //
  // RLS scopes the broadcast to the caller's own rows server-side, so the
  // event will only fire for notifications addressed to this user.
  //
  // Subscription is bound once on mount and torn down on unmount; we read
  // the current `open` state from openRef instead of including it in deps,
  // which would otherwise re-bind the channel on every toggle.
  useEffect(() => {
    const channel = supabase
      .channel('notification-bell')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
      }, (payload) => {
        const row = payload?.new
        if (!row) return
        setUnread(u => u + 1)
        // If the popover is open, prepend the new row so the user sees it
        // immediately. If it's closed, we let loadRecent() refetch on next
        // open — keeping the items array tight to what's been viewed avoids
        // memory bloat on long sessions.
        if (openRef.current) {
          setItems(arr => [row, ...arr].slice(0, 30))
        }
      })
      .subscribe()
    channelRef.current = channel
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [])

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // ESC to close.
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const handleOpen = useCallback(async () => {
    setOpen(o => !o)
    if (!open) {
      setLoading(true); setError(null)
      try {
        const [rows, count] = await Promise.all([loadRecent(30), loadUnreadCount()])
        setItems(rows); setUnread(count)
      } catch (err) {
        setError(err?.message || String(err))
      } finally {
        setLoading(false)
      }
    }
  }, [open])

  const handleRowClick = useCallback(async (n) => {
    setBusyId(n.id)
    try {
      if (!n.is_read) {
        const flipped = await markRead(n.id)
        if (flipped > 0) {
          setUnread(u => Math.max(0, u - 1))
          setItems(arr => arr.map(x => x.id === n.id ? { ...x, is_read: true } : x))
        }
      }
      setOpen(false)
      if (n.related_object && n.related_id && typeof onNavigateToRecord === 'function') {
        onNavigateToRecord({ table: n.related_object, id: n.related_id })
      }
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusyId(null)
    }
  }, [onNavigateToRecord])

  const handleMarkAllRead = useCallback(async () => {
    setBusyAll(true)
    try {
      const n = await markAllRead()
      setUnread(0)
      setItems(arr => arr.map(x => x.is_read ? x : { ...x, is_read: true }))
      if (n === 0) setError(null)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusyAll(false)
    }
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={handleOpen}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
        style={{
          background: open ? '#eef2f7' : 'transparent',
          color: C.textSecondary,
          border: 'none',
          borderRadius: 6,
          padding: 6,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = '#eef2f7' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Bell icon */}
        <Icon
          path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          size={18}
          color={C.textSecondary}
        />
        {unread > 0 && (
          <span style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: C.emerald,
            color: '#fff',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: '16px',
            textAlign: 'center',
            border: '1.5px solid #fff',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            width: 360,
            maxHeight: 480,
            background: '#fff',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            boxShadow: '0 6px 16px rgba(15, 23, 42, 0.10)',
            zIndex: 50,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 14px',
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{
              fontSize: 11.5, fontWeight: 600,
              color: C.textMuted,
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              Notifications {unread > 0 && <span style={{ color: C.emerald }}>· {unread} unread</span>}
            </div>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={busyAll || unread === 0}
              style={{
                background: 'none', border: 'none',
                color: unread === 0 ? C.textMuted : C.emerald,
                cursor: unread === 0 ? 'default' : 'pointer',
                fontSize: 11.5, fontWeight: 500,
                opacity: busyAll ? 0.5 : 1,
                padding: 2,
              }}
            >
              Mark all read
            </button>
          </div>

          {/* Body */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading && (
              <div style={{ padding: 16, fontSize: 12.5, color: C.textMuted }}>Loading…</div>
            )}
            {!loading && error && (
              <div style={{ padding: 16, fontSize: 12.5, color: '#2c5f8a' }}>{error}</div>
            )}
            {!loading && !error && items.length === 0 && (
              <div style={{ padding: 16, fontSize: 12.5, color: C.textMuted }}>
                No notifications yet. New tasks, automation rules, and assignments will show up here.
              </div>
            )}
            {!loading && !error && items.map(n => (
              <NotificationRow
                key={n.id}
                n={n}
                onClick={() => handleRowClick(n)}
                busy={busyId === n.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NotificationRow({ n, onClick, busy }) {
  const unread = !n.is_read
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      role="menuitem"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: unread ? '#f5fbf8' : '#fff',
        borderTop: 'none',
        borderRight: 'none',
        borderLeft: unread ? `3px solid ${C.emerald}` : '3px solid transparent',
        borderBottom: `1px solid ${C.border}`,
        padding: '10px 14px',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = unread ? '#ecf7f1' : '#f8fafc' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = unread ? '#f5fbf8' : '#fff' }}
    >
      <div style={{
        fontSize: 12.5,
        fontWeight: unread ? 600 : 500,
        color: C.textPrimary,
        marginBottom: 2,
        lineHeight: 1.35,
      }}>
        {n.title}
      </div>
      {n.body && (
        <div style={{
          fontSize: 11.5,
          color: C.textSecondary,
          lineHeight: 1.4,
          marginBottom: 4,
          whiteSpace: 'pre-line',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}>
          {n.body}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: C.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{formatRelative(n.created_at)}</span>
        {n.is_automated && (
          <span style={{
            background: '#e8f1fb', color: '#1e466b',
            padding: '1px 5px', borderRadius: 3,
            fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
          }}>
            AUTO
          </span>
        )}
        {n.related_object && (
          <span style={{ color: C.textMuted }}>· {prettyTable(n.related_object)}</span>
        )}
      </div>
    </button>
  )
}

function formatRelative(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function prettyTable(t) {
  if (!t) return ''
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
