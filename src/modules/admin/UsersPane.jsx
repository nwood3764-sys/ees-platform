import { useCallback, useEffect, useState } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { ListView } from '../../components/ListView'
import HelpIcon from '../../components/help/HelpIcon'
import { fetchUsers } from '../../data/adminService'
import { supabase } from '../../lib/supabase'
import InviteUserModal from './InviteUserModal'
import TechnicianSetupWizard from './TechnicianSetupWizard'

/**
 * UsersPane — Administration > Users.
 *
 * Differs from the generic NodePage in three ways:
 *
 *   1. The "New" button opens an InviteUserModal that sends a Supabase Auth
 *      invite email rather than creating a blank public.users row. Creating
 *      a row without a corresponding auth account would result in an
 *      orphan that can't sign in — so we never expose that path here.
 *
 *   2. A custom Sign-In column shows the auth-link state per row. Rows that
 *      have no auth_user_id get a "Send invite" inline action that
 *      provisions an auth account and links it to the existing row.
 *      Rows that DO have an auth_user_id get a "Reset password" inline
 *      action that triggers a Supabase Auth recovery email through the
 *      admin-reset-user-password edge function.
 *
 *   3. Refreshing after invite — the list re-fetches so the user just
 *      invited appears (or the orphan row's link state flips) without a
 *      page reload.
 */
export default function UsersPane({ onOpenRecord }) {
  const [data, setData]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Modal state. `mode` is 'new' or 'relink'. `existingUser` carries the
  // row we're re-inviting in relink mode; null otherwise.
  const [modal, setModal] = useState(null) // { mode, existingUser }
  const [wizardOpen, setWizardOpen] = useState(false)

  // Password-reset modal state. Three phases:
  //   { phase: 'confirm', user }     — admin clicked Reset, awaiting confirmation
  //   { phase: 'sending', user }     — edge function call in flight
  //   { phase: 'done',    user, email } — succeeded; show confirmation
  //   { phase: 'error',   user, message } — failed; show retry
  // null when no reset is in progress.
  const [resetModal, setResetModal] = useState(null)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchUsers()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  // Fire the admin-reset-user-password edge function. The user's auth
  // session JWT is attached automatically by supabase.functions.invoke,
  // and the edge function verifies the caller's Admin role server-side
  // before sending the recovery email.
  // Fire the admin-reset-user-password edge function. We use fetch()
  // directly rather than supabase.functions.invoke() because invoke()
  // discards the response body on non-2xx responses — it surfaces only
  // the HTTP status as the error message. Our edge function returns
  // detailed JSON like { error: "Reset email send failed: <msg>" } on
  // 500; we need to read that to diagnose anything.
  const sendReset = async (user) => {
    setResetModal({ phase: 'sending', user })
    try {
      // Get the current session JWT to send as the bearer token.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setResetModal({ phase: 'error', user, message: 'Not signed in.' })
        return
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-reset-user-password`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: user._id }),
      })

      // Always try to parse the body, even on 5xx. The edge function
      // returns structured JSON in both success and error paths.
      let payload = null
      try { payload = await resp.json() } catch { /* fall through */ }

      if (!resp.ok) {
        const detail = payload?.error
          || payload?.message
          || `HTTP ${resp.status} ${resp.statusText}`
        setResetModal({ phase: 'error', user, message: detail })
        return
      }
      if (!payload?.ok) {
        setResetModal({ phase: 'error', user, message: payload?.error || 'Reset failed.' })
        return
      }
      setResetModal({
        phase: 'done',
        user,
        email: payload.email || user.email,
        recovery_url: payload.recovery_url || null,
      })
    } catch (e) {
      setResetModal({ phase: 'error', user, message: e?.message || 'Unexpected error.' })
    }
  }

  // Custom cell renderer for the Sign-In column. Returns null for any
  // other column so ListView falls back to its default cell renderer.
  // We render a full <td> here; ListView expects renderCell to return
  // either a complete cell or a falsy value.
  const renderCell = (col, row) => {
    if (col.field !== 'authStatus') return null
    return (
      <td key="authStatus" style={cellStyle}>
        {row.hasAuthLink ? (
          <span style={authLinkedWrap}>
            <span style={badgeOk}>Active</span>
            <button
              type="button"
              // Stop the click from bubbling — the row click would otherwise
              // toggle the detail panel underneath us.
              onClick={(e) => {
                e.stopPropagation()
                setResetModal({ phase: 'confirm', user: row })
              }}
              style={resetBtnStyle}
              title="Send this user a password-reset email so they can choose a new password."
            >
              Reset password
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setModal({ mode: 'relink', existingUser: row })
            }}
            style={inviteBtnStyle}
            title="Send a Supabase Auth invite email so this user can set a password and sign in."
          >
            Send invite
          </button>
        )}
      </td>
    )
  }

  const systemViews = [
    { id: 'AV',    name: 'All',                  filters: [], sortField: 'lastName', sortDir: 'asc' },
    { id: 'PEND',  name: 'Awaiting Sign-In',     filters: [{ field: 'authStatus', op: 'equals', value: 'Pending' }], sortField: 'lastName', sortDir: 'asc' },
    { id: 'INACT', name: 'Inactive',             filters: [{ field: 'status',     op: 'equals', value: 'Inactive' }], sortField: 'lastName', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Users</div>
          <HelpIcon anchors={[{ type: 'concept', concept: 'users-and-passwords' }]} />
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setWizardOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, fontWeight: 500, padding: '6px 12px', borderRadius: 6,
              background: C.emerald, color: '#fff', border: `1px solid ${C.emeraldMid}`, cursor: 'pointer',
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
            </svg>
            Set Up Technician
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.length} record${data.length === 1 ? '' : 's'}` +
              (data.length
                ? ` · ${data.filter(u => !u.hasAuthLink).length} awaiting sign-in`
                : '')}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          // Inject a virtual `authStatus` field on each row so ListView's
          // filter/sort code can reference it — the renderCell for that
          // column produces the actual button/badge.
          data={data.map(u => ({ ...u, authStatus: u.hasAuthLink ? 'Active' : 'Pending' }))}
          columns={USER_COLS}
          renderCell={renderCell}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel="User"
          onNew={() => setModal({ mode: 'new', existingUser: null })}
          onOpenRecord={onOpenRecord
            ? row => row?._id && onOpenRecord({ table: 'users', id: row._id, name: row.name || row.id })
            : undefined}
          onRefresh={reload}
        />
      )}

      {wizardOpen && (
        <TechnicianSetupWizard
          onClose={() => setWizardOpen(false)}
          onComplete={() => { reload() }}
        />
      )}

      {modal && (
        <InviteUserModal
          mode={modal.mode}
          existingUser={modal.existingUser}
          onClose={() => setModal(null)}
          onInvited={() => { reload() }}
        />
      )}

      {resetModal && (
        <ResetPasswordModal
          state={resetModal}
          onConfirm={() => sendReset(resetModal.user)}
          onClose={() => setResetModal(null)}
        />
      )}
    </div>
  )
}

// ─── ResetPasswordModal ─────────────────────────────────────────────────────
// Four phases driven by the parent's resetModal state:
//   confirm — "send a password-reset email to <email>?" with Send + Cancel
//   sending — disabled state while the edge function call is in flight
//   done    — success confirmation ("Email sent to <address>")
//   error   — failure with the server message + Try again
function ResetPasswordModal({ state, onConfirm, onClose }) {
  const { phase, user } = state
  const email = state.email || user?.email || '(no email)'

  const heading =
    phase === 'done'    ? 'Recovery link ready' :
    phase === 'error'   ? 'Reset failed'        :
                          'Reset this user\u2019s password?'

  return (
    <div style={modalBackdrop} onClick={phase === 'sending' ? undefined : onClose}>
      <div
        style={modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-heading"
      >
        <div id="reset-modal-heading" style={modalTitle}>{heading}</div>

        {phase === 'confirm' && (
          <>
            <div style={modalBody}>
              A one-time password-reset link will be generated for <strong>{email}</strong>.
              The link expires in 1 hour. You'll get the link in the next screen — send
              it to the user via email, text, or whatever channel works. They click it,
              set a new password, and sign in.
            </div>
            <div style={modalActions}>
              <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
              <button type="button" onClick={onConfirm} style={btnPrimary}>Generate link</button>
            </div>
          </>
        )}

        {phase === 'sending' && (
          <>
            <div style={modalBody}>Generating recovery link for <strong>{email}</strong>…</div>
            <div style={modalActions}>
              <button type="button" disabled style={{ ...btnPrimary, opacity: 0.6, cursor: 'default' }}>
                Generating…
              </button>
            </div>
          </>
        )}

        {phase === 'done' && (
          <DonePhase email={email} url={state.recovery_url} onClose={onClose} />
        )}

        {phase === 'error' && (
          <>
            <div style={{ ...modalBody, color: '#8a2d20' }}>
              {state.message || 'The reset email could not be sent.'}
            </div>
            <div style={modalActions}>
              <button type="button" onClick={onClose}   style={btnGhost}>Close</button>
              <button type="button" onClick={onConfirm} style={btnPrimary}>Try again</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── DonePhase ───────────────────────────────────────────────────────────────
// Shown after the recovery link is generated. Auto-copies the link to the
// clipboard on mount; surfaces it visibly so the admin can verify what was
// copied; offers a Copy-again button (clipboard ops can fail in some browsers
// without a user gesture, so we always show the URL too); offers "Open in
// Mail" which pops the OS default mail app with a pre-filled subject/body.
function DonePhase({ email, url, onClose }) {
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'copied' | 'failed'

  // Auto-copy on first render. If permission was previously granted (or the
  // browser allows it without a gesture in this admin context) the admin
  // doesn't even have to click Copy.
  useEffect(() => {
    if (!url) return
    if (!navigator?.clipboard?.writeText) {
      setCopyState('failed')
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'))
  }, [url])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  // Pre-filled mailto. The body uses %0D%0A line breaks per RFC 6068; some
  // mail clients prefer \n, but %0D%0A is the safest cross-client encoding.
  const subject = encodeURIComponent('Reset your LEAP password')
  const body = encodeURIComponent(
    `Hi,\r\n\r\n` +
    `Use the link below to set a password and sign in to LEAP. ` +
    `The link expires in 1 hour.\r\n\r\n` +
    `${url}\r\n\r\n` +
    `If you have any trouble, reply to this email and we'll help you out.\r\n`
  )
  const mailtoHref = url ? `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}` : '#'

  return (
    <>
      <div style={modalBody}>
        Recovery link generated for <strong>{email}</strong>.
        {copyState === 'copied' && (
          <span style={{ marginLeft: 6, color: '#196f3d', fontSize: 12, fontWeight: 600 }}>
            ✓ Copied to clipboard
          </span>
        )}
        {copyState === 'failed' && (
          <span style={{ marginLeft: 6, color: '#8a2d20', fontSize: 12 }}>
            (auto-copy failed — use the Copy button below)
          </span>
        )}
      </div>

      {/* The URL itself, selectable + scrollable. Monospace so admins can
          eyeball the token if needed. We render in a <pre> so long URLs
          wrap on their own without breaking the modal layout. */}
      <pre style={{
        background: '#f7f9fc',
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        padding: '10px 12px',
        fontSize: 11.5,
        fontFamily: 'JetBrains Mono, monospace',
        color: C.textPrimary,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 120,
        overflowY: 'auto',
        margin: '0 0 12px 0',
      }}>{url || ''}</pre>

      <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14, lineHeight: 1.5 }}>
        Send this link to the user via your normal email or messaging tool.
        It works for 1 hour and can only be used once. Once they click it,
        they'll set a new password and be signed in.
      </div>

      <div style={modalActions}>
        <button type="button" onClick={handleCopy} style={btnGhost}>
          {copyState === 'copied' ? 'Copied' : 'Copy link'}
        </button>
        <a href={mailtoHref}
           style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>
          Open in Mail
        </a>
        <button type="button" onClick={onClose} style={btnPrimary}>Done</button>
      </div>
    </>
  )
}
// authStatus is a virtual column — its content comes from renderCell above.
// It still has a `field` because ListView uses field for keying, sorting,
// and filtering. The value `'Active' | 'Pending'` lives on each row inside
// UsersPane (mapped from hasAuthLink) so filters/sorts behave naturally.
const USER_COLS = [
  { field: 'id',         label: 'Record #',  type: 'text',   sortable: true,  filterable: false },
  { field: 'name',       label: 'Name',      type: 'text',   sortable: true,  filterable: true  },
  { field: 'role',       label: 'Role',      type: 'text',   sortable: true,  filterable: true  },
  { field: 'title',      label: 'Title',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'email',      label: 'Email',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'phone',      label: 'Phone',     type: 'text',   sortable: false, filterable: false },
  { field: 'authStatus', label: 'Sign-In',   type: 'select', sortable: true,  filterable: true,  options: ['Active', 'Pending'] },
  { field: 'status',     label: 'Status',    type: 'select', sortable: true,  filterable: true,  options: ['Active', 'Inactive'] },
]

// ─── Inline styles ──────────────────────────────────────────────────────────
const cellStyle = {
  padding: '8px 14px',
  fontSize: 12.5,
  color: C.textPrimary,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
}

const badgeOk = {
  display: 'inline-block',
  padding: '2px 9px',
  fontSize: 11,
  fontWeight: 500,
  color: '#1a6e44',
  background: '#dff5e9',
  borderRadius: 999,
  border: '1px solid #b7e3cb',
}

const inviteBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 11.5,
  fontWeight: 500,
  color: C.emerald,
  background: '#ffffff',
  border: `1px solid ${C.emerald}`,
  borderRadius: 5,
  cursor: 'pointer',
}

// Used inside the Sign-In cell to put the Active badge and the Reset
// password button side-by-side without disturbing the cell padding.
const authLinkedWrap = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
}

// Visually subordinate to the green "Send invite" — same shape but
// neutral colors, so admins notice the primary "needs invite" cases
// before they notice the maintenance "reset" cases on already-linked
// users.
const resetBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  fontSize: 11.5,
  fontWeight: 500,
  color: C.textSecondary,
  background: '#ffffff',
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: 5,
  cursor: 'pointer',
}

// ─── Modal styles ───────────────────────────────────────────────────────────
const modalBackdrop = {
  position: 'fixed', inset: 0,
  background: 'rgba(13, 26, 46, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, padding: 24,
  fontFamily: 'Inter, -apple-system, sans-serif',
}

const modalCard = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '22px 24px',
  width: '100%',
  maxWidth: 440,
  boxShadow: '0 20px 50px rgba(13, 26, 46, 0.25)',
}

const modalTitle = {
  fontSize: 16,
  fontWeight: 600,
  color: C.textPrimary,
  marginBottom: 10,
}

const modalBody = {
  fontSize: 13,
  color: C.textSecondary,
  lineHeight: 1.55,
  marginBottom: 18,
}

const modalActions = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
}

const btnPrimary = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  color: '#ffffff',
  background: C.emerald,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

const btnGhost = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  color: C.textSecondary,
  background: '#ffffff',
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: 6,
  cursor: 'pointer',
}
