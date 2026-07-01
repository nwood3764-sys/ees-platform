// ===========================================================================
// AddToPortalModal — invite a contact into the Multi-Family Project Portal and
// manage which of the account's properties they may view.
//
// Opened from the "Add to Portal" action on an Account record. The account is
// fixed (the record you're on); you pick one of its contacts, a portal role
// (Property Administrator / Property Viewer), and toggle exactly which of the
// account's properties that user can see.
//
// HARD SECURITY RULE, enforced server-side and reinforced here in the UI:
//   A portal user can ONLY ever see properties on their own account. The
//   property picker is sourced solely from this account, and every grant is
//   re-validated against the portal user's bound account by the RPC. There is
//   no way — from this modal or otherwise — to grant a property on a different
//   account.
//
// Sending the invitation EMAIL is a separate, explicit opt-in. Creating a
// pending portal user + grants never contacts the person; you can set up and
// verify everything, then send when ready. LEAP design system — navy / emerald,
// no red.
// ===========================================================================

import { useState, useEffect, useMemo } from 'react'
import { C } from '../data/constants'
import {
  fetchPortalRoles, fetchAccountContacts, fetchAccountProperties,
  fetchPortalUserAccess, createPortalInvite, setPortalGrants,
  revokePortalAccess, sendPortalInvite,
} from '../data/portalService'

export default function AddToPortalModal({ accountId, account, onClose, onDone }) {
  const accountName = account?.account_name || 'this account'

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [notice, setNotice]     = useState(null)
  const [busy, setBusy]         = useState(false)

  const [contacts, setContacts]     = useState([])
  const [properties, setProperties] = useState([])
  const [roles, setRoles]           = useState([])

  const [contact, setContact]   = useState(null)   // selected contact
  const [mode, setMode]         = useState('pick') // 'pick' | 'create' | 'manage'
  const [access, setAccess]     = useState(null)   // manage-mode loaded access

  const [roleId, setRoleId]     = useState('')
  const [selected, setSelected] = useState(() => new Set()) // property ids toggled on
  const [sendEmail, setSendEmail] = useState(false)
  const [propQuery, setPropQuery] = useState('')

  // ── Initial load: contacts + properties + roles for this account ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [c, p, r] = await Promise.all([
          fetchAccountContacts(accountId),
          fetchAccountProperties(accountId),
          fetchPortalRoles(),
        ])
        if (cancelled) return
        setContacts(c); setProperties(p); setRoles(r)
        setRoleId(r.find(x => /viewer/i.test(x.label))?.id || r[0]?.id || '')
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [accountId])

  const filteredProps = useMemo(() => {
    const q = propQuery.trim().toLowerCase()
    if (!q) return properties
    return properties.filter(p =>
      (p.name + ' ' + p.recordNumber + ' ' + p.city + ' ' + p.state).toLowerCase().includes(q))
  }, [properties, propQuery])

  function resetToPick() {
    setContact(null); setMode('pick'); setAccess(null); setNotice(null); setError(null)
    setSelected(new Set()); setSendEmail(false); setPropQuery('')
  }

  async function pickContact(c) {
    setError(null); setNotice(null)
    if (c.portalUserId) {
      // Existing portal user → manage mode.
      setBusy(true)
      try {
        const a = await fetchPortalUserAccess(c.portalUserId)
        if (!a) { setError('Could not load this portal user.'); return }
        setContact(c); setAccess(a); setRoleId(a.portalRole || roleId)
        setSelected(new Set(a.grantedPropertyIds))
        setMode('manage')
      } catch (e) {
        setError(e.message || String(e))
      } finally { setBusy(false) }
    } else {
      // New portal user → create mode, default all properties on.
      setContact(c)
      setSelected(new Set(properties.map(p => p.id)))
      setMode('create')
    }
  }

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAll()  { setSelected(new Set(properties.map(p => p.id))) }
  function selectNone() { setSelected(new Set()) }

  async function doCreate() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await createPortalInvite({
        contactId: contact.id, portalRoleId: roleId, propertyIds: [...selected],
      })
      const puId = res?.portal_user_id
      if (sendEmail && puId) {
        await sendPortalInvite({ portalUserId: puId })
        onDone?.({ message: `Invitation sent to ${contact.email}. They can now set a password and sign in.` })
      } else {
        onDone?.({ message: `Portal access set up for ${contact.name} (${selected.size} propert${selected.size === 1 ? 'y' : 'ies'}). No email was sent — send the invitation when you're ready.` })
      }
    } catch (e) {
      setError(e.message || String(e)); setBusy(false)
    }
  }

  async function doSaveGrants() {
    setBusy(true); setError(null); setNotice(null)
    try {
      const res = await setPortalGrants({ portalUserId: access.portalUserId, propertyIds: [...selected] })
      setNotice(`Saved — this user can now see ${res?.active_count ?? selected.size} propert${(res?.active_count ?? selected.size) === 1 ? 'y' : 'ies'}.`)
      setBusy(false)
    } catch (e) {
      setError(e.message || String(e)); setBusy(false)
    }
  }

  async function doSendInvite() {
    setBusy(true); setError(null); setNotice(null)
    try {
      await sendPortalInvite({ portalUserId: access.portalUserId })
      onDone?.({ message: `Invitation sent to ${access.email}.` })
    } catch (e) {
      setError(e.message || String(e)); setBusy(false)
    }
  }

  async function doRevoke() {
    if (!window.confirm(`Revoke portal access for ${access.fullName}? They will immediately lose access to all properties. This can be re-granted later.`)) return
    setBusy(true); setError(null); setNotice(null)
    try {
      await revokePortalAccess({ portalUserId: access.portalUserId, reason: 'Revoked from account' })
      onDone?.({ message: `Portal access revoked for ${access.fullName}.` })
    } catch (e) {
      setError(e.message || String(e)); setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={card}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Add to Portal</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              Multi-Family Project Portal access for a contact on <strong style={{ color: C.textSecondary }}>{accountName}</strong>.
            </div>
          </div>
          <button onClick={onClose} style={xBtn}>✕</button>
        </div>

        <div style={body}>
          {error && <div style={errorBox}>{error}</div>}
          {notice && <div style={noticeBox}>{notice}</div>}

          {/* Security assurance — always visible */}
          <div style={securityBox}>
            <span style={{ fontWeight: 700 }}>Account-scoped.</span> A portal user on {accountName} can
            only ever see this account's properties — never any property on another account.
          </div>

          {loading ? (
            <div style={muted}>Loading account contacts and properties…</div>
          ) : mode === 'pick' ? (
            <>
              <label style={lbl}>Choose the contact to give portal access</label>
              {contacts.length === 0 ? (
                <div style={muted}>This account has no contacts. Add a contact with an email address first.</div>
              ) : (
                <div style={listBox}>
                  {contacts.map(c => (
                    <div key={c.id} onClick={() => !busy && pickContact(c)} style={pickRow}
                      onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: C.textMuted }}>{c.email || 'No email on file'}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {c.hasPortalAccess
                          ? <span style={badge(C.emeraldMid, '#ecfdf5')}>Has access — manage</span>
                          : <span style={{ fontSize: 11.5, color: C.emeraldMid, fontWeight: 600 }}>Select →</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Selected contact banner */}
              <div style={contactBanner}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{contact?.name || access?.fullName}</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted }}>{contact?.email || access?.email}</div>
                </div>
                {mode === 'manage' && (
                  <span style={badge(access?.isInvited ? C.emeraldMid : C.sky, access?.isInvited ? '#ecfdf5' : '#eff6ff')}>
                    {access?.status || (access?.isInvited ? 'Invited' : 'Pending')}
                  </span>
                )}
              </div>

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
                <label style={{ ...lbl, margin: 0 }}>Properties this user can view ({selected.size} of {properties.length})</label>
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
                <div style={muted}>This account has no properties to grant.</div>
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

        {/* Footer */}
        <div style={footer}>
          <div>
            {mode !== 'pick' && !busy && (
              <button onClick={resetToPick} style={btnGhost}>← Back</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={btnGhost} disabled={busy}>Close</button>
            {mode === 'create' && (
              <button onClick={doCreate} disabled={busy || !roleId} style={btnPrimary(busy || !roleId)}>
                {busy ? 'Working…' : sendEmail ? 'Create & send invite' : 'Create portal access'}
              </button>
            )}
            {mode === 'manage' && (
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

// ── styles (mirrors AccountMergeModal / LEAP design system) ──
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
const pickRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', cursor: 'pointer', borderTop: `1px solid ${C.border}`, background: '#fff' }
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
