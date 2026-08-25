// -----------------------------------------------------------------------------
// LogDroppedEmailModal.jsx
//
// What you see after dropping an email on a record, before anything is written.
//
// The whole value of this feature is that LEAP reads WHO WAS INVOLVED, so this
// screen's job is to show that reading and let it be checked: every From/To/Cc
// address with the contact, account, EES person or EES mailbox it resolved to,
// and — just as plainly — the ones that matched nobody. Filing silently would
// hide exactly the thing worth seeing.
//
// Nothing here decides a match. resolve_email_participants does that in the
// database, where contacts and accounts are visible under RLS.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { C } from '../data/constants'
import { Icon } from './UI'
import { participantAddresses, parsedEmailBlockers } from '../lib/emailMessageParse'
import { resolveEmailParticipants, importParsedEmail } from '../data/omniChannelService'

const OVERLAY = {
  position: 'fixed', inset: 0,
  background: 'rgba(13, 26, 46, 0.55)',
  backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: '40px 16px', zIndex: 1100, overflowY: 'auto',
}

const MODAL = {
  background: C.card, borderRadius: 10, width: '100%', maxWidth: 620,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  border: `1px solid ${C.borderDark || C.border}`,
  overflow: 'hidden', fontSize: 13, color: C.textPrimary,
}

const SECTION_LABEL = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
  color: C.textSecondary, marginBottom: 6, display: 'block',
}

const BUTTON_PRIMARY = {
  background: C.emerald || '#3ecf8e', color: '#fff', border: 'none',
  borderRadius: 5, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

const BUTTON_SECONDARY = {
  background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`,
  borderRadius: 5, padding: '9px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}

// How a resolved address is described in one short phrase. The basis is shown,
// not just the name, because "we matched this because the domain belongs to
// one account" is a weaker claim than "this is the contact's own address" and
// the person filing should be able to tell them apart.
const MATCH_LABEL = {
  outbound_mailbox:       'EES mailbox',
  user_email:             'EES staff',
  contact_email:          'Contact',
  account_email:          'Account email',
  account_website_domain: 'Account, matched by domain',
  unmatched:              'Not in LEAP',
}

const ROLE_LABEL = { from: 'From', to: 'To', cc: 'Cc', bcc: 'Bcc' }

function formatWhen(iso) {
  if (!iso) return 'Time not recorded on the message'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Time not recorded on the message'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

const SOURCE_LABEL = {
  outlook_msg_file: 'Outlook message file',
  eml_file:         'Email source file',
  dragged_text:     'Text from the drag',
  pasted_text:      'Pasted email text',
}

export default function LogDroppedEmailModal({
  parsed,            // ParsedEmail from droppedEmail.js
  targetObject,      // table the email is being filed on
  targetId,
  targetLabel,       // what to call that record in the sentence
  onClose,
  onFiled,           // (result, parsed) => void
}) {
  const [matches, setMatches] = useState(null)   // null = still resolving
  const [resolveError, setResolveError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const addresses = useMemo(() => participantAddresses(parsed), [parsed])
  const blockers = useMemo(() => parsedEmailBlockers(parsed), [parsed])

  useEffect(() => {
    let alive = true
    if (!addresses.length) { setMatches([]); return undefined }
    setMatches(null)
    setResolveError(null)
    resolveEmailParticipants(addresses)
      .then(rows => { if (alive) setMatches(rows) })
      .catch(err => {
        if (!alive) return
        // A failed lookup must not block filing — the database resolves the
        // participants again when it writes them, so the email still lands
        // correctly. All that is lost is the preview.
        setResolveError(err.message || String(err))
        setMatches([])
      })
    return () => { alive = false }
  }, [addresses])

  const matchFor = (address) =>
    (matches || []).find(m => m.address?.toLowerCase() === address.toLowerCase()) || null

  // Every person on the email, in reading order, each with its role.
  const people = useMemo(() => {
    const rows = []
    if (parsed?.from?.address) rows.push({ role: 'from', ...parsed.from })
    for (const p of parsed?.to || []) rows.push({ role: 'to', ...p })
    for (const p of parsed?.cc || []) rows.push({ role: 'cc', ...p })
    return rows
  }, [parsed])

  const unmatchedCount = (matches || []).filter(m => m.match_basis === 'unmatched').length
  const eesSide = (matches || []).filter(m => m.is_ees_side)
  const direction = matches === null
    ? null
    : (matchFor(parsed?.from?.address || '')?.is_ees_side ? 'outbound' : 'inbound')

  const handleFile = async () => {
    if (saving || blockers.length) return
    setSaving(true)
    setError(null)
    try {
      const result = await importParsedEmail({ targetObject, targetId, parsed })
      onFiled?.(result, parsed)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  const bodyPreview = parsed?.bodyHtml
    ? DOMPurify.sanitize(parsed.bodyHtml)
    : null

  return (
    <div style={OVERLAY} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={MODAL} onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 24, height: 24, borderRadius: 5, background: '#e8f3fb',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon path="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6"
                    size={13} color="#1a5a8a" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>File this email</div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 1 }}>
                on {targetLabel || 'this record'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.textMuted, padding: 4, display: 'flex',
          }} title="Cancel">
            <Icon path="M18 6L6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        <div style={{ padding: 18, maxHeight: '62vh', overflowY: 'auto' }}>
          {/* The message itself */}
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 8,
            background: C.cardSecondary || '#f7f9fc', padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
              {parsed?.subject || '(no subject)'}
            </div>
            <div style={{ fontSize: 11.5, color: C.textSecondary, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <span>{formatWhen(parsed?.sentAt)}</span>
              <span style={{ color: C.textMuted }}>·</span>
              <span>{SOURCE_LABEL[parsed?.source] || 'Email'}</span>
              {parsed?.fileName && (
                <>
                  <span style={{ color: C.textMuted }}>·</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{parsed.fileName}</span>
                </>
              )}
              {direction && (
                <>
                  <span style={{ color: C.textMuted }}>·</span>
                  <span style={{ fontWeight: 600, color: direction === 'outbound' ? '#1a7a4e' : '#1a5a8a' }}>
                    {direction === 'outbound' ? 'Sent by EES' : 'Received by EES'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Who's involved */}
          <span style={SECTION_LABEL}>Who was involved</span>
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14,
          }}>
            {people.map((person, i) => {
              const m = matchFor(person.address)
              const basis = m?.match_basis || null
              const matched = basis && basis !== 'unmatched'
              return (
                <div key={`${person.role}-${person.address}`} style={{
                  display: 'flex', alignItems: 'baseline', gap: 10,
                  padding: '8px 12px',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                  background: matched ? C.card : '#fbfcfe',
                }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
                    color: C.textMuted, width: 34, flexShrink: 0, letterSpacing: 0.3,
                  }}>
                    {ROLE_LABEL[person.role]}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 12.5, color: C.textPrimary,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {m?.matched_label || person.name || person.address}
                    </div>
                    <div style={{
                      fontSize: 11, color: C.textSecondary,
                      fontFamily: 'JetBrains Mono, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {person.address}
                    </div>
                    {m?.account_name && basis !== 'account_email' && basis !== 'account_website_domain' && (
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>
                        {m.account_name}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 600, flexShrink: 0,
                    padding: '2px 8px', borderRadius: 10,
                    background: matches === null ? C.page : (matched ? '#e8f8f2' : '#e8f1fb'),
                    color: matches === null ? C.textMuted : (matched ? '#1a7a4e' : '#1e466b'),
                  }}>
                    {matches === null ? 'Checking…' : (MATCH_LABEL[basis] || 'Not in LEAP')}
                  </span>
                </div>
              )
            })}
            {!people.length && (
              <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>
                No addresses could be read from this message.
              </div>
            )}
          </div>

          {/* What the reading means, stated plainly */}
          {matches !== null && (
            <div style={{ fontSize: 11.5, color: C.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
              {eesSide.length > 0
                ? `Filed as ${direction === 'outbound' ? 'sent by' : 'received by'} EES, under ${
                    direction === 'outbound' ? parsed.from.address : (eesSide[0]?.address || 'your address')}.`
                : 'No EES address is on this message, so it will be filed under your own address as the person who filed it.'}
              {unmatchedCount > 0 && (
                <> {unmatchedCount === 1 ? 'One address is' : `${unmatchedCount} addresses are`} not in LEAP.
                  They are recorded on the message as unmatched, so a contact can be created for them later.</>
              )}
            </div>
          )}

          {resolveError && (
            <div style={{
              padding: 10, marginBottom: 12, fontSize: 12, color: '#1e466b',
              background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6,
            }}>
              The match preview could not be loaded ({resolveError}). Filing still works — the
              participants are resolved again when the email is written.
            </div>
          )}

          {(parsed?.warnings || []).map((w, i) => (
            <div key={i} style={{
              padding: 10, marginBottom: 10, fontSize: 12, color: '#1e466b',
              background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6, lineHeight: 1.5,
            }}>
              {w}
            </div>
          ))}

          {blockers.map((b, i) => (
            <div key={i} style={{
              padding: 10, marginBottom: 10, fontSize: 12, color: '#1e466b',
              background: '#e8f1fb', border: '1px solid #7eb3e8', borderRadius: 6,
              fontWeight: 600, lineHeight: 1.5,
            }}>
              {b}
            </div>
          ))}

          {/* Body preview */}
          <span style={SECTION_LABEL}>Message</span>
          <div style={{
            border: `1px solid ${C.border}`, borderRadius: 8, padding: 12,
            maxHeight: 200, overflowY: 'auto', fontSize: 12.5, lineHeight: 1.5,
            background: C.card, wordBreak: 'break-word',
          }}>
            {bodyPreview
              // eslint-disable-next-line react/no-danger
              ? <div dangerouslySetInnerHTML={{ __html: bodyPreview }} />
              : <div style={{ whiteSpace: 'pre-wrap' }}>{parsed?.bodyText || '(no body)'}</div>}
          </div>

          {error && (
            <div style={{
              marginTop: 12, padding: 10, fontSize: 12, color: '#1e466b',
              background: '#e8f1fb', border: '1px solid #7eb3e8', borderRadius: 6,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
          padding: '12px 18px', background: '#fafbfd', borderTop: `1px solid ${C.border}`,
        }}>
          <button onClick={onClose} style={BUTTON_SECONDARY} disabled={saving}>Cancel</button>
          <button
            onClick={handleFile}
            disabled={saving || blockers.length > 0}
            style={{
              ...BUTTON_PRIMARY,
              opacity: (saving || blockers.length > 0) ? 0.55 : 1,
              cursor: (saving || blockers.length > 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Filing…' : 'File Email'}
          </button>
        </div>
      </div>
    </div>
  )
}
