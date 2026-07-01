// ===========================================================================
// AddToPortalModal — grant a CONTACT access to the Multi-Family Project Portal.
//
// Opened from the "Add to Portal" action on a Contact record. Adding the
// contact to the portal IS the single place access is granted: you pick the
// portal role (Property Administrator / Property Viewer) and toggle exactly
// which of the contact's account's properties they can see. There is no
// separate "add account to portal" step.
//
// HARD SECURITY RULE, enforced server-side and reinforced in the UI:
//   A portal user can ONLY ever see properties on their own account. The
//   property picker is sourced solely from the contact's account, and every
//   grant is re-validated against the portal user's bound account by the RPC.
//
// Sending the invitation EMAIL is a separate, explicit opt-in — creating a
// pending portal user + grants never contacts the person, so the whole thing
// can be set up and tested before anyone is emailed. LEAP design system.
// ===========================================================================

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { C } from '../data/constants'
import {
  fetchPortalRoles, fetchAccountProperties, fetchPortalUserAccess,
  createPortalInvite, setPortalGrants, revokePortalAccess, sendPortalInvite,
} from '../data/portalService'

export default function AddToPortalModal({ contactId, contact, onClose, onDone }) {
  // The contact record row is passed straight from RecordDetail.
  const contactName  = contact?.contact_name || 'this contact'
  const contactEmail = contact?.contact_email || ''
  const accountId    = contact?.contact_account_id || null
  const existingPortalUserId = contact?.contact_portal_user_id || null

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)
  const [busy, setBusy]         = useState(false)

  const [accountName, setAccountName] = useState('')
  const [properties, setProperties]   = useState([])
  const [roles, setRoles]             = useState([])
  const [mode, setMode]               = useState('create') // 'create' | 'manage'
  const [access, setAccess]           = useState(null)

  const [roleId, setRoleId]       = useState('')
  const [selected, setSelected]   = useState(() => new Set())
  const [sendEmail, setSendEmail] = useState(false)
  const [propQuery, setPropQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!accountId) {
          if (!cancelled) { setError('This contact isn’t linked to an account, so it can’t be given portal access. Set the contact’s account first.'); setLoading(false) }
          return
        }
        const [props, r, acct, existingAccess] = await Promise.all([
          fetchAccountProperties(accountId),
          fetchPortalRoles(),
          supabase.from('accounts').select('account_name').eq('id', accountId).maybeSingle(),
          existingPortalUserId ? fetchPortalUserAccess(existingPortalUserId) : Promise.resolve(null),
        ])
        if (cancelled) return
        setProperties(props)
        setRoles(r)
        setAccountName(acct?.data?.account_name || 'this account')
        if (existingAccess) {
          setMode('manage')
          setAccess(existingAccess)
          setRoleId(existingAccess.portalRole || '')
          setSelected(new Set(existingAccess.grantedPropertyIds))
        } else {
          setMode('create')
          setRoleId(r.find(x => /viewer/i.test(x.label))?.id || r[0]?.id || '')
          setSelected(new Set(props.map(p => p.id))) // default: all properties on
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId, existingPortalUserId])

  const filteredProps = useMemo(() => {
    const q = propQuery.trim().toLowerCase()
    if (!q) return properties
    return properties.filter(p =>
      (p.name + ' ' + p.recordNumber + ' ' + p.city + ' ' + p.state).toLowerCase().includes(q))
  }, [properties, propQuery])

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const selectAll  = () => setSelected(new Set(properties.map(p => p.id)))
  const selectNone = () => setSelected(new Set())

  async function doCreate() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await createPortalInvite({ contactId, portalRoleId: roleId, propertyIds: [...selected] })
      const puId = res?.portal_user_id
      if (sendEmail && puId) {
        await sendPortalInvite({ portalUserId: puId })
        onDone?.({ message: `Invitation sent to ${contactEmail}. ${contactName} can now set a password and sign in.` })
      } else {
        onDone?.({ message: `Portal access set up for ${contactName} (${selected.size} propert${selected.size === 1 ? 'y' : 'ies'}). No email was sent — send the invitation when you're ready.` })
      }
    } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }

  async function doSaveGrants() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await setPortalGrants({ portalUserId: access.portalUserId, propertyIds: [...selected] })
      const n = res?.active_count ?? selected.size
      setNotice(`Saved — ${contactName} can now see ${n} propert${n === 1 ? 'y' : 'ies'}.`)
      setBusy(false)
    } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }

  async function doSendInvite() {
    setBusy(true); setError(null); setNotice(null)
    try {
      await sendPortalInvite({ portalUserId: access.portalUserId })
      onDone?.({ message: `Invitation sent to ${access.email}.` })
    } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }

  async function doRevoke() {
    if (!window.confirm(`Revoke portal access for ${contactName}? They will immediately lose access to all properties. This can be re-granted later.`)) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await revokePortalAccess({ portalUserId: access.portalUserId, reason: 'Revoked from contact' })
      onDone?.({ message: `Portal access revoked for ${contactName}.` })
    } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={card}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Add to Portal</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              Multi-Family Project Portal access for <strong style={{ color: C.textSecondary }}>{contactName}</strong>
              {contactEmail ? ` (${contactEmail})` : ''}
            </div>
          </div>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={body}>
          {error && <div style={errorBox}>{error}</div>}
          {notice && <div style={noticeBox}>{notice}</div>}

          {!loading && !error && (
            <div style={securityBox}>
              <span style={{ fontWeight: 700 }}>Account-scoped.</span> {contactName} will only ever see
              properties on <strong>{accountName}</strong> — never any property on another account.
            </div>
          )}

          {loading ? (
            <div style={muted}>Loading portal options…</div>
          ) : error ? null : (
            <>
              {mode === 'manage' && (
                <div style={contactBanner}>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>Current portal status</div>
                  <span style={badge(access?.isInvited ? C.emeraldMid : C.sky, access?.isInvited ? '#ecfdf5' : '#eff6ff')}>
                    {access?.status || (access?.isInvited ? 'Invited' : 'Pending')}
                  </span>
                </div>
              )}

              {/* Role */}
              <label style={lbl}>Portal role</label>
              {mode === 'create' ? (
                <select value={roleId} onChange={e => setRoleId(e.target.value)} style={input} disabled={busy}>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              ) : (
                <div style={{ ...input, background: C.cardSecondary || '#f7f9fc', color: C.textSecondary }}>
                  {access?.portalRoleLabel || '—'}
                </div>
              )}

              {/* Property picker */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 6px' }}>
                <label style={{ ...lbl, margin: 0 }}>Properties {contactName} can view ({selected.size} of {properties.length})</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={selectAll} style={linkBtn} disabled={busy}>All</button>
                  <button onClick={selectNone} style={linkBtn} disabled={busy}>None</button>
                </div>
              </div>
              {properties.length > 8 && (
                <input value={propQuery} onChange={e => setPropQuery(e.target.value)}
                  placeholder="Filter properties…" style={{ ...input, marginBottom: 8 }} />
              )}
              {properties.length === 0 ? (
                <div style={muted}>{accountName} has no properties to grant.</div>
              ) : (
                <div style={{ ...listBox, maxHeight: 260 }}>
                  {filteredProps.map(p => {
                    const on = selected.has(p.id)
                    return (
                      <div key={p.id} onClick={() => !busy && toggle(p.id)} style={propRow}>
                        <span style={checkbox(on)}>{on ? '✓' : ''}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: C.textMuted }}>
                            {[p.recordNumber, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {filteredProps.length === 0 && <div style={muted}>No properties match “{propQuery}”.</div>}
                </div>
              )}

              {/* Create-mode send toggle */}
              {mode === 'create' && (
                <label style={sendToggle}>
                  <input type="checkbox" checked={sendEmail} onChange={e => setSendEmail(e.target.checked)} disabled={busy} />
                  <span>
                    <span style={{ fontWeight: 600, color: C.textPrimary }}>Send the invitation email now</span>
                    <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                      Leave off to set everything up and test first — no email is sent until you turn this on.
                    </span>
                  </span>
                </label>
              )}
            </>
          )}
        </div>

        <div style={footer}>
          <div />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnGhost} disabled={busy}>Close</button>
            {!loading && !error && mode === 'create' && (
              <button onClick={doCreate} disabled={busy || !roleId} style={btnPrimary(busy || !roleId)}>
                {busy ? 'Working…' : sendEmail ? 'Create & send invite' : 'Create portal access'}
              </button>
            )}
            {!loading && !error && mode === 'manage' && (
              <>
                <button onClick={doRevoke} style={btnGhost} disabled={busy}>Revoke access</button>
                {!access?.isInvited && (
                  <button onClick={doSendInvite} style={btnSecondary(busy)} disabled={busy}>
                    {busy ? 'Working…' : 'Send invite'}
                  </button>
                )}
                <button onClick={doSaveGrants} disabled={busy} style={btnPrimary(busy)}>
                  {busy ? 'Saving…' : 'Save properties'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── styles (LEAP design system) ──
const overlay = { position: 'fixed', inset: 0, background: 'rgba(13,26,46,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: 20 }
const card = { background: '#fff', borderRadius: 12, width: '100%', maxWidth: 620, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif' }
const header = { padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const body = { padding: 20, overflowY: 'auto', flex: 1 }
const footer = { padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const xBtn = { background: 'transparent', border: 'none', fontSize: 16, color: C.textMuted, cursor: 'pointer', lineHeight: 1 }
const lbl = { display: 'block', fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }
const input = { width: '100%', border: `1px solid ${C.border}`, borderRadius: 7, padding: '9px 11px', fontSize: 13, outline: 'none', fontFamily: 'inherit', color: C.textPrimary, boxSizing: 'border-box' }
const muted = { padding: '12px', fontSize: 12.5, color: C.textMuted }
const listBox = { border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }
const propRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderTop: `1px solid ${C.border}`, background: '#fff' }
const contactBanner = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: C.cardSecondary || '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 16 }
const securityBox = { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#166247', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, lineHeight: 1.4, marginBottom: 14 }
const errorBox = { background: '#eff6ff', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }
const noticeBox = { background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#166247', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }
const sendToggle = { display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 16, padding: '11px 12px', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: C.textSecondary }
const linkBtn = { background: 'transparent', border: 'none', color: C.emeraldMid, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 0 }
const btnGhost = { background: '#fff', border: `1px solid ${C.border}`, borderRadius: 7, padding: '8px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer', fontWeight: 500 }
const badge = (color, bg) => ({ fontSize: 10.5, fontWeight: 700, letterSpacing: '.2px', color, background: bg, border: `1px solid ${color}33`, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap' })
const checkbox = (on) => ({ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: on ? C.emerald : '#fff', border: `1.5px solid ${on ? C.emerald : C.borderDark}` })
function btnPrimary(disabled) {
  return { background: disabled ? C.textMuted : C.emerald, border: 'none', borderRadius: 7, padding: '8px 16px', fontSize: 12.5, color: '#fff', cursor: disabled ? 'default' : 'pointer', fontWeight: 600 }
}
function btnSecondary(disabled) {
  return { background: disabled ? '#cbd5e1' : C.sky, border: 'none', borderRadius: 7, padding: '8px 14px', fontSize: 12.5, color: '#0d1a2e', cursor: disabled ? 'default' : 'pointer', fontWeight: 600 }
}
