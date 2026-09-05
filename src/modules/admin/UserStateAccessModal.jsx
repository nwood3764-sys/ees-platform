import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../../data/constants'
import { PINNED_TABLE, ROW_RULE, pinnedHeaderCell } from '../../lib/pinnedTableHeader'
import {
  fetchStateScopesForUser,
  fetchStateScopeOptions,
  grantStateToUser,
  revokeStateFromUser,
  previewUserStateAccess,
} from '../../data/stateScopeService'
import { backdropDismissProps } from '../../lib/modalDismiss'

/**
 * UserStateAccessModal — Administration › Users › Record Access.
 *
 * Grants and revokes a user's geographic (state) record access, and previews
 * what those grants actually mean object by object.
 *
 * Two things this screen has to make unmistakable, because getting either
 * wrong is a security decision:
 *
 *   1. No states granted means UNRESTRICTED, not "no access". That is the
 *      state every existing user is in, and it is why adding this layer
 *      changed nobody's access.
 *
 *   2. A grant restricts reading AND writing. A scoped user cannot create or
 *      edit a record outside their states either — the database refuses it.
 *
 * The preview counts rows rather than listing them, so an administrator can
 * confirm the boundary without the screen itself disclosing records.
 */
export default function UserStateAccessModal({ user, onClose, onChanged }) {
  const [scopes, setScopes]   = useState([])
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [busy, setBusy]       = useState(false)

  const [preview, setPreview]               = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError]     = useState(null)

  const userId = user?._id || user?.id

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, o] = await Promise.all([
        fetchStateScopesForUser(userId),
        fetchStateScopeOptions(),
      ])
      setScopes(s)
      setOptions(o)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  // Any change invalidates the preview — a stale count is worse than none.
  const mutate = async (fn) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setPreview(null)
      await load()
      onChanged?.()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const granted = new Set(scopes.map(s => s.uss_state_code))
  const unrestricted = scopes.length === 0

  const runPreview = async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      setPreview(await previewUserStateAccess(userId))
    } catch (e) {
      setPreviewError(e)
    } finally {
      setPreviewLoading(false)
    }
  }

  const body = (
    <div style={backdrop} {...backdropDismissProps(onClose)}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={header}>
          <div>
            <div style={titleStyle}>Record Access</div>
            <div style={subtitleStyle}>
              {user?.name || 'User'}{user?.role ? ` · ${user.role}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary}
              strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div style={scrollArea}>
          {loading && <div style={mutedLine}>Loading…</div>}
          {error && <div style={noticeStyle}>{error.message || String(error)}</div>}

          {!loading && (
            <>
              <div style={unrestricted ? noticeStyle : grantedNotice}>
                {unrestricted ? (
                  <>
                    <strong>No states granted — this user is unrestricted.</strong> They see
                    every record their role allows, in every state. Grant a state below to
                    limit them to it.
                  </>
                ) : (
                  <>
                    <strong>Restricted to {[...granted].join(', ')}.</strong> This user can only
                    see, create and edit records that resolve to {granted.size === 1 ? 'that state' : 'those states'}.
                    Anything that cannot be traced to {granted.size === 1 ? 'it' : 'one of them'} is
                    hidden from them entirely.
                  </>
                )}
              </div>

              <div style={sectionLabel}>States</div>
              <div style={chipGrid}>
                {options.map(o => {
                  const on = granted.has(o.stateCode)
                  const scope = scopes.find(s => s.uss_state_code === o.stateCode)
                  return (
                    <button
                      key={o.stateCode}
                      type="button"
                      disabled={busy}
                      onClick={() => mutate(() => on
                        ? revokeStateFromUser(scope.id, 'Revoked in LEAP Admin.')
                        : grantStateToUser(userId, o.stateCode))}
                      style={on ? chipOn : chipOff}
                      title={on
                        ? `Remove ${o.stateCode} from this user's access`
                        : `Give this user access to ${o.stateCode}`}
                    >
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                        {o.stateCode}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.75 }}>
                        {o.propertyCount.toLocaleString()}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div style={sectionLabel}>What this user can see</div>
              {!preview && !previewLoading && (
                <button type="button" onClick={runPreview} style={primaryBtn} disabled={busy}>
                  Preview access
                </button>
              )}
              {previewLoading && <div style={mutedLine}>Counting records object by object…</div>}
              {previewError && (
                <div style={noticeStyle}>{previewError.message || String(previewError)}</div>
              )}

              {preview && (
                <div style={tableWrap}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Object</th>
                        <th style={thNum}>Visible</th>
                        <th style={thNum}>Total</th>
                        <th style={thStyle}>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview
                        .filter(r => (r.recordsTotal ?? 0) > 0 || r.note)
                        .map(r => (
                          <tr key={r.objectName}>
                            <td style={tdStyle}>{r.objectName}</td>
                            <td style={tdNum}>
                              {r.recordsVisible === null ? '—' : r.recordsVisible.toLocaleString()}
                            </td>
                            <td style={tdNumMuted}>
                              {r.recordsTotal === null ? '—' : r.recordsTotal.toLocaleString()}
                            </td>
                            <td style={tdNote}>{r.note || ''}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Done</button>
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}

// ─── Styles ────────────────────────────────────────────────────────────────

const backdrop = {
  position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.42)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1200, padding: 20,
}
const sheet = {
  background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
  boxShadow: '0 12px 40px rgba(13,26,46,0.22)',
  width: 'min(760px, 100%)', maxHeight: '88vh',
  display: 'flex', flexDirection: 'column',
  animation: 'none',
}
const header = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}`,
}
const titleStyle = { fontSize: 15.5, fontWeight: 600, color: C.textPrimary }
const subtitleStyle = { fontSize: 12, color: C.textMuted, marginTop: 2 }
const closeBtn = {
  marginLeft: 'auto', background: 'transparent', border: 'none',
  cursor: 'pointer', padding: 4, lineHeight: 0,
}
const scrollArea = { padding: '14px 20px 18px', overflowY: 'auto', flex: 1 }
const footer = {
  padding: '12px 20px', borderTop: `1px solid ${C.border}`,
  display: 'flex', justifyContent: 'flex-end',
}
const sectionLabel = {
  fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
  color: C.textMuted, margin: '18px 0 8px',
}
const mutedLine = { fontSize: 12.5, color: C.textMuted, padding: '6px 0' }
const noticeStyle = {
  fontSize: 12.5, lineHeight: 1.55, color: '#1e466b', background: '#e8f1fb',
  border: `1px solid ${C.sky}`, borderRadius: 6, padding: '10px 12px',
}
const grantedNotice = {
  fontSize: 12.5, lineHeight: 1.55, color: '#1a7a4e', background: '#e8f8f2',
  border: `1px solid ${C.emeraldMid}`, borderRadius: 6, padding: '10px 12px',
}
const chipGrid = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const chipBase = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '7px 12px', borderRadius: 6, fontSize: 12.5,
  cursor: 'pointer', transition: 'background 200ms ease, border-color 200ms ease',
}
const chipOn = {
  ...chipBase, background: '#e8f8f2', color: '#1a7a4e',
  border: `1px solid ${C.emeraldMid}`,
}
const chipOff = {
  ...chipBase, background: C.card, color: C.textSecondary,
  border: `1px solid ${C.borderDark}`,
}
const primaryBtn = {
  fontSize: 12.5, fontWeight: 500, padding: '7px 14px', borderRadius: 6,
  background: C.emerald, color: '#fff', border: `1px solid ${C.emeraldMid}`, cursor: 'pointer',
}
const secondaryBtn = {
  fontSize: 12.5, fontWeight: 500, padding: '7px 14px', borderRadius: 6,
  background: C.card, color: C.textSecondary, border: `1px solid ${C.borderDark}`, cursor: 'pointer',
}
const tableWrap = {
  border: `1px solid ${C.border}`, borderRadius: 6, overflowX: 'auto', marginTop: 4,
}
const tableStyle = { ...PINNED_TABLE, fontSize: 12.5 }
// The preview lists every object in the platform, so it is always taller than
// the modal — pinned, or you scroll three screens of numbers with nothing
// saying which column is Visible and which is Total.
const thStyle = {
  textAlign: 'left', padding: '8px 10px', color: C.textMuted, fontWeight: 600,
  fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3,
  whiteSpace: 'nowrap', ...pinnedHeaderCell(),
}
const thNum = { ...thStyle, textAlign: 'right' }
const tdStyle = {
  padding: '7px 10px', color: C.textPrimary, whiteSpace: 'nowrap', ...ROW_RULE,
}
const tdNum = {
  ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
}
const tdNumMuted = {
  ...tdStyle, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: C.textMuted,
}
const tdNote = { ...tdStyle, color: C.textMuted, whiteSpace: 'normal', fontSize: 11.5 }
