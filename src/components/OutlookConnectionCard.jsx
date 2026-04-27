import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'

// ---------------------------------------------------------------------------
// OutlookConnectionCard — UI for the user's Microsoft Outlook integration.
//
// What it does:
//   • On mount, queries my_outlook_connection_status() RPC to learn whether
//     the current user has an active Outlook connection (token-stripped —
//     the FE never sees access_token or refresh_token).
//   • If connected, shows the linked account email + last-used timestamp,
//     plus a Disconnect button.
//   • If not connected, shows a Connect Outlook button. Clicking it calls
//     outlook-oauth-start, stashes the returned state in sessionStorage,
//     and redirects to Microsoft. The user's OAuth consent flow then
//     redirects back to /auth/outlook-callback, which finishes the dance
//     by calling outlook-oauth-callback and lands the user back here.
//
// State key in sessionStorage: 'anura.outlook.oauth.state' — the value
// round-trips through Microsoft and is validated by OutlookCallback.jsx.
// CSRF protection on the callback comes from the user's Supabase JWT
// being required to invoke outlook-oauth-callback (only the right
// authenticated user can complete their own connection).
//
// Why the connection lives at user-level (not project-level): emails go
// out from the user's actual Outlook mailbox, so the Microsoft account
// is intrinsically tied to the Anura user, not to any single record.
// ---------------------------------------------------------------------------

const STATE_STORAGE_KEY = 'anura.outlook.oauth.state'

export default function OutlookConnectionCard() {
  const [status, setStatus] = useState(null)         // null = loading; {} = loaded
  const [error, setError]   = useState(null)
  const [busy, setBusy]     = useState(false)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const { data, error } = await supabase.rpc('my_outlook_connection_status')
      if (error) throw error
      setStatus(data || { connected: false })
    } catch (e) {
      setError(e.message || 'Failed to load Outlook status')
      setStatus({ connected: false })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Did we just come back from a connect flow? OutlookCallback.jsx sets a
  // localStorage flag we pick up to refresh status without a manual reload.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'anura.outlook.connection.changed') refresh()
    }
    window.addEventListener('storage', onStorage)
    // Also poll once when the tab regains focus, since same-tab callbacks
    // don't fire the storage event.
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const handleConnect = async () => {
    setBusy(true)
    setError(null)
    try {
      // Generate a state token FE-side; outlook-oauth-start round-trips it
      // through Microsoft and back to /auth/outlook-callback for validation.
      const state = crypto.randomUUID()
      sessionStorage.setItem(STATE_STORAGE_KEY, state)

      const { data, error } = await supabase.functions.invoke('outlook-oauth-start', {
        body: { state },
      })
      if (error) throw error
      if (!data?.authorize_url) throw new Error('Server did not return an authorize URL')

      // Hand off to Microsoft. Their consent screen will redirect back to
      // /auth/outlook-callback?code=...&state=... when the user finishes.
      window.location.href = data.authorize_url
    } catch (e) {
      setError(e.message || 'Failed to start Outlook connection')
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Outlook account? Anura will no longer send emails on your behalf, and signing notifications will fall back to copy-paste URLs until you reconnect.')) return
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await supabase.functions.invoke('outlook-disconnect', {
        body: {},
      })
      if (error) throw error
      if (!data?.ok) throw new Error('Server did not confirm disconnect')
      await refresh()
    } catch (e) {
      setError(e.message || 'Failed to disconnect')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 8,
      padding: 18, background: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
        <OutlookGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
            Microsoft Outlook
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 1.5 }}>
            Send signing requests and other client emails from your real Outlook mailbox. A copy of every message is saved to the related record so the conversation history stays with the project.
          </div>
        </div>
      </div>

      {status === null ? (
        <div style={{ fontSize: 12, color: C.textMuted }}>Checking status…</div>
      ) : status.connected ? (
        <ConnectedState status={status} busy={busy} onDisconnect={handleDisconnect} />
      ) : (
        <DisconnectedState busy={busy} onConnect={handleConnect} />
      )}

      {error && (
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: '#fdecea', border: '1px solid #f3b9b3', borderRadius: 5,
          fontSize: 12, color: '#8a2c20',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ─── Sub-views ──────────────────────────────────────────────────────────────

function ConnectedState({ status, busy, onDisconnect }) {
  return (
    <>
      <div style={{
        background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: '10px 12px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: C.emerald,
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.emerald }}>Connected</span>
        </div>
        <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>
          {status.account_display_name && `${status.account_display_name} — `}
          {status.account_email}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
          Connected {formatRelative(status.connected_at)}
          {status.last_used_at && ` • Last used ${formatRelative(status.last_used_at)}`}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onDisconnect}
          disabled={busy}
          style={{
            background: '#fff', border: `1px solid ${C.borderDark}`, color: '#b03a2e',
            padding: '8px 16px', fontSize: 13, fontWeight: 500, borderRadius: 5,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    </>
  )
}

function DisconnectedState({ busy, onConnect }) {
  return (
    <>
      <div style={{
        background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
        padding: '10px 12px', marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.textMuted }} />
        <span style={{ fontSize: 12, color: C.textSecondary }}>Not connected</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onConnect}
          disabled={busy}
          style={{
            background: '#0a66c2', border: 'none', color: '#fff',
            padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 5,
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Redirecting…' : 'Connect Outlook'}
        </button>
      </div>
    </>
  )
}

// ─── Visual helper ──────────────────────────────────────────────────────────

function OutlookGlyph() {
  // Simple inline mark — readable on the white card without depending on any
  // brand asset library. Color matches the Office "blue 600" hue so it reads
  // as Outlook without literally being the Outlook logo.
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x={2} y={4} width={20} height={16} rx={2.5} fill="#0a66c2" />
      <path d="M2 8l10 6 10-6" stroke="#fff" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Time formatting ────────────────────────────────────────────────────────

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const ms = Date.now() - d.getTime()
  const sec = Math.round(ms / 1000)
  if (sec < 60)  return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60)  return `${min} min${min === 1 ? '' : 's'} ago`
  const hr = Math.round(min / 60)
  if (hr < 24)   return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.round(hr / 24)
  if (day < 7)   return `${day} day${day === 1 ? '' : 's'} ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
