// -----------------------------------------------------------------------------
// LogCallModal.jsx
//
// Salesforce-style "Log a Call" composer. Opened from the Activity tab on a
// record (opportunities in particular, for outreach). Writes a Call activity
// to public.activities via callActivityService.logCall(), optionally linked to
// a contact associated with the record.
//
// Direction options come from the activities.direction picklist; the contact
// list comes from opportunity_contact_roles for opportunities (empty elsewhere,
// in which case the contact field is simply hidden).
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import {
  logCall,
  fetchActivityPicklist,
  fetchLinkedContactsForRecord,
} from '../data/callActivityService'

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(13, 26, 46, 0.55)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '48px 16px',
  zIndex: 1000,
  overflowY: 'auto',
}

const MODAL_STYLE = {
  background: C.card,
  borderRadius: 10,
  width: '100%',
  maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
  border: `1px solid ${C.borderDark || C.border}`,
  overflow: 'hidden',
  fontSize: 13,
  color: C.textPrimary,
}

const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  background: '#fafbfd',
  borderBottom: `1px solid ${C.border}`,
}

const FIELD_LABEL = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  color: C.textSecondary,
  marginBottom: 4,
  display: 'block',
}

const INPUT_STYLE = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  background: C.card,
  color: C.textPrimary,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

const FOOTER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: '12px 18px',
  background: '#fafbfd',
  borderTop: `1px solid ${C.border}`,
  gap: 10,
}

const BUTTON_PRIMARY = {
  background: C.emerald || '#3ecf8e',
  color: '#fff',
  border: 'none',
  borderRadius: 5,
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const BUTTON_SECONDARY = {
  background: C.card,
  color: C.textSecondary,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

// Format a Date into the value a <input type="datetime-local"> expects
// (local time, no timezone suffix): "YYYY-MM-DDTHH:mm".
function toDatetimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export default function LogCallModal({ tableName, recordId, onClose, onLogged }) {
  const [directionOptions, setDirectionOptions] = useState([])
  const [contacts, setContacts] = useState([])

  const [direction, setDirection] = useState('Outbound')
  const [contactId, setContactId] = useState('')
  const [subject, setSubject] = useState('Call')
  const [occurredAtLocal, setOccurredAtLocal] = useState(() => toDatetimeLocal(new Date()))
  const [durationMinutes, setDurationMinutes] = useState('')
  const [comments, setComments] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Load picklist + linked contacts once when opened.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchActivityPicklist('direction').catch(() => []),
      fetchLinkedContactsForRecord(tableName, recordId).catch(() => []),
    ]).then(([dirs, cts]) => {
      if (cancelled) return
      setDirectionOptions(dirs)
      setContacts(cts)
      // Default direction to the first option if 'Outbound' isn't present.
      if (dirs.length && !dirs.some(d => d.value === 'Outbound')) {
        setDirection(dirs[0].value)
      }
      // Default the contact to the primary one when there's a clear choice.
      const primary = cts.find(c => c.isPrimary)
      if (primary) setContactId(primary.id)
    })
    return () => { cancelled = true }
  }, [tableName, recordId])

  const canSave = useMemo(() => !saving && subject.trim().length > 0, [saving, subject])

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const occurredAt = occurredAtLocal ? new Date(occurredAtLocal).toISOString() : null
      const newId = await logCall({
        tableName,
        recordId,
        subject,
        direction,
        durationMinutes,
        occurredAt,
        contactId: contactId || null,
        comments,
      })
      onLogged?.(newId)
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div style={OVERLAY_STYLE} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-label="Log a Call">
        <div style={HEADER_STYLE}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Log a Call</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: 20, lineHeight: 1, color: C.textMuted, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Direction + duration on one row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={FIELD_LABEL}>Direction</label>
              <select
                style={INPUT_STYLE}
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                {directionOptions.length === 0 && <option value="Outbound">Outbound</option>}
                {directionOptions.map(d => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <label style={FIELD_LABEL}>Duration (min)</label>
              <input
                type="number"
                min="0"
                step="1"
                style={INPUT_STYLE}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="e.g. 5"
              />
            </div>
          </div>

          {/* Contact — only shown when the record has linked contacts */}
          {contacts.length > 0 && (
            <div>
              <label style={FIELD_LABEL}>Contact</label>
              <select
                style={INPUT_STYLE}
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
              >
                <option value="">— No contact —</option>
                {contacts.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` · ${c.phone}` : ''}{c.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={FIELD_LABEL}>Subject</label>
            <input
              type="text"
              style={INPUT_STYLE}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Call"
            />
          </div>

          <div>
            <label style={FIELD_LABEL}>When</label>
            <input
              type="datetime-local"
              style={INPUT_STYLE}
              value={occurredAtLocal}
              onChange={(e) => setOccurredAtLocal(e.target.value)}
            />
          </div>

          <div>
            <label style={FIELD_LABEL}>Comments</label>
            <textarea
              style={{ ...INPUT_STYLE, minHeight: 90, resize: 'vertical' }}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="What was discussed, next steps, outcome…"
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: '#1e466b', background: '#e8f1fb',
              border: '1px solid #bcd9f2', borderRadius: 5, padding: '8px 10px',
            }}>
              Couldn't log the call: {error}
            </div>
          )}
        </div>

        <div style={FOOTER_STYLE}>
          <button type="button" style={BUTTON_SECONDARY} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...BUTTON_PRIMARY, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Log Call'}
          </button>
        </div>
      </div>
    </div>
  )
}
