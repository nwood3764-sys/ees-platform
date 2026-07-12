// -----------------------------------------------------------------------------
// LogActivityModal.jsx
//
// Salesforce-style "Log Activity" composer. Opened from a record's header
// action or the Activity tab. Logs a past interaction — call, email, meeting,
// site visit, event, note, etc. — to public.activities via
// callActivityService.logActivity(), optionally linked to a contact on the
// record.
//
// The activity-type list and direction options are managed picklists
// (picklist_object='activities'), so admins can extend them without a code
// change. The form adapts to the chosen type: communication types (Call,
// Email, Text Message) show a Direction; time-based types (Call, Meeting,
// Site Visit, Event) show a Duration.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import {
  logActivity,
  fetchActivityPicklist,
  fetchLinkedContactsForRecord,
  fetchRelatableRecords,
} from '../data/callActivityService'

// Which types get which optional fields. Kept as plain sets so new picklist
// values default gracefully (no Direction/Duration unless listed).
const DIRECTION_TYPES = new Set(['Call', 'Email', 'Text Message'])
const DURATION_TYPES  = new Set(['Call', 'Meeting', 'Site Visit', 'Event'])

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

export default function LogActivityModal({
  tableName,
  recordId,
  defaultType = 'Call',
  onClose,
  onLogged,
}) {
  const [typeOptions, setTypeOptions] = useState([])
  const [directionOptions, setDirectionOptions] = useState([])
  const [contacts, setContacts] = useState([])
  const [relatable, setRelatable] = useState([])
  // Keys ("object:id") of related records the user has chosen to link.
  const [selectedRelations, setSelectedRelations] = useState(() => new Set())

  const [activityType, setActivityType] = useState(defaultType)
  const [direction, setDirection] = useState('Outbound')
  const [contactId, setContactId] = useState('')
  const [subject, setSubject] = useState('')
  const [occurredAtLocal, setOccurredAtLocal] = useState(() => toDatetimeLocal(new Date()))
  const [durationMinutes, setDurationMinutes] = useState('')
  const [comments, setComments] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Load picklists + linked contacts once when opened.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchActivityPicklist('activity_type').catch(() => []),
      fetchActivityPicklist('direction').catch(() => []),
      fetchLinkedContactsForRecord(tableName, recordId).catch(() => []),
      fetchRelatableRecords(tableName, recordId).catch(() => []),
    ]).then(([types, dirs, cts, rel]) => {
      if (cancelled) return
      setTypeOptions(types)
      setDirectionOptions(dirs)
      setContacts(cts)
      setRelatable(rel)
      // Default: link all connected records (user can uncheck any).
      setSelectedRelations(new Set(rel.map(r => `${r.object}:${r.id}`)))
      // Keep defaultType if present, else fall back to the first option.
      if (types.length && !types.some(t => t.value === defaultType)) {
        setActivityType(types[0].value)
      }
      if (dirs.length && !dirs.some(d => d.value === 'Outbound')) {
        setDirection(dirs[0].value)
      }
      const primary = cts.find(c => c.isPrimary)
      if (primary) setContactId(primary.id)
    })
    return () => { cancelled = true }
  }, [tableName, recordId, defaultType])

  const showDirection = DIRECTION_TYPES.has(activityType)
  const showDuration  = DURATION_TYPES.has(activityType)
  const canSave = useMemo(() => !saving && !!activityType, [saving, activityType])

  const toggleRelation = (key) => {
    setSelectedRelations(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const occurredAt = occurredAtLocal ? new Date(occurredAtLocal).toISOString() : null
      const relations = relatable.filter(r => selectedRelations.has(`${r.object}:${r.id}`))
      const newId = await logActivity({
        tableName,
        recordId,
        activityType,
        subject,
        direction: showDirection ? direction : null,
        durationMinutes: showDuration ? durationMinutes : null,
        occurredAt,
        contactId: contactId || null,
        comments,
        relations,
      })
      onLogged?.(newId)
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  const isOpportunity = tableName === 'opportunities'

  return (
    <div style={OVERLAY_STYLE} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div style={MODAL_STYLE} role="dialog" aria-modal="true" aria-label="Log Activity">
        <div style={HEADER_STYLE}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Log Activity</div>
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
          {/* Activity type — always first, drives which fields show */}
          <div>
            <label style={FIELD_LABEL}>Activity Type</label>
            <select
              style={INPUT_STYLE}
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
            >
              {typeOptions.length === 0 && <option value={activityType}>{activityType}</option>}
              {typeOptions.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Direction + duration — only for the types they apply to */}
          {(showDirection || showDuration) && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {showDirection && (
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
              )}
              {showDuration && (
                <div style={{ flex: '1 1 140px' }}>
                  <label style={FIELD_LABEL}>Duration (min)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    style={INPUT_STYLE}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    placeholder="e.g. 15"
                  />
                </div>
              )}
            </div>
          )}

          {/* Contact — populated from the record's Contact Roles */}
          {contacts.length > 0 ? (
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
          ) : isOpportunity ? (
            <div style={{
              fontSize: 12, color: C.textSecondary, background: C.cardSecondary || '#f7f9fc',
              border: `1px solid ${C.border}`, borderRadius: 5, padding: '8px 10px',
            }}>
              No contacts linked to this record yet. You can still log the activity — to attribute
              it to a person, add a Contact Role under the <strong>Related</strong> tab first.
            </div>
          ) : null}

          {/* Also relate to — the record's connected parents. This activity
              will show on each checked record's Activity timeline. */}
          {relatable.length > 0 && (
            <div>
              <label style={FIELD_LABEL}>Also relate to</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {relatable.map(r => {
                  const key = `${r.object}:${r.id}`
                  const checked = selectedRelations.has(key)
                  return (
                    <label key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                      fontSize: 13, color: C.textPrimary,
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleRelation(key)} />
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
                        color: C.textMuted, minWidth: 66,
                      }}>{r.typeLabel}</span>
                      <span>{r.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <label style={FIELD_LABEL}>Subject</label>
            <input
              type="text"
              style={INPUT_STYLE}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={activityType}
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
              placeholder="What happened, the outcome, and any next steps…"
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: '#1e466b', background: '#e8f1fb',
              border: '1px solid #bcd9f2', borderRadius: 5, padding: '8px 10px',
            }}>
              Couldn't log the activity: {error}
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
            {saving ? 'Saving…' : 'Log Activity'}
          </button>
        </div>
      </div>
    </div>
  )
}
