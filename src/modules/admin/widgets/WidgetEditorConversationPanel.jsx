import { useState, useEffect, useMemo } from 'react'
import { C } from '../../../data/constants'
import { useToast } from '../../../components/Toast'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { describeIncomingFKs } from '../../../data/adminService'
import { updateWidget } from '../../../data/pageLayoutBuilderService'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle,
  dangerBoxStyle, hintBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// WidgetEditorConversationPanel — modal for editing a conversation_panel
// widget on a page layout.
//
// User flow:
//   1. Widget title (free text — what appears as the section header in the
//      record detail view).
//   2. Foreign-key column on `conversations` that joins to this object.
//      Discovered via describeIncomingFKs(objectName) filtered to the
//      `conversations` table — the four supported FKs are contact_id,
//      account_id, project_id, service_appointment_id. If the host object
//      has exactly one matching FK (the common case), it's auto-selected.
//   3. Channel filter (optional) — All / SMS only / Email only. Persisted as
//      widget_config.channel_filter; the panel narrows its thread list when
//      set, and ignores anything other than 'sms' / 'email' so a typo can't
//      silently hide every thread.
//
// Writes widget_config = { table: 'conversations', fk, channel_filter? }
// via updateWidget. Other config keys are preserved on save.
// ---------------------------------------------------------------------------

const CHANNEL_OPTIONS = [
  { value: '',      label: 'All channels' },
  { value: 'sms',   label: 'SMS only' },
  { value: 'email', label: 'Email only' },
]

// Human-friendly labels for the four supported FK columns. Anything outside
// this set is filtered out — the panel and its data layer don't know how to
// query other FKs.
const FK_LABELS = {
  contact_id:             'contact_id  ·  Contacts',
  account_id:             'account_id  ·  Accounts',
  project_id:             'project_id  ·  Projects',
  service_appointment_id: 'service_appointment_id  ·  Service Appointments',
}
const SUPPORTED_FK_COLUMNS = Object.keys(FK_LABELS)

export default function WidgetEditorConversationPanel({
  widget, objectName, onClose, onSaved,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()

  const cfg = widget.widget_config || {}

  // Form state
  const [title, setTitle]               = useState(widget.widget_title || '')
  const [fkColumn, setFkColumn]         = useState(cfg.fk || '')
  const [channelFilter, setChannelFilter] = useState(cfg.channel_filter || '')

  // Lookup data — the FKs from `conversations` that point at this object.
  const [incomingFKs, setIncomingFKs] = useState([])
  const [loadingFKs, setLoadingFKs]   = useState(true)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Load FKs pointing at this object, keep only the ones on the
  // `conversations` table whose column is in the supported set.
  useEffect(() => {
    let cancelled = false
    setLoadingFKs(true)
    describeIncomingFKs(objectName)
      .then(fks => {
        if (cancelled) return
        const filtered = (fks || []).filter(fk =>
          fk.referencing_table === 'conversations'
          && SUPPORTED_FK_COLUMNS.includes(fk.referencing_column)
        )
        setIncomingFKs(filtered)
      })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingFKs(false) })
    return () => { cancelled = true }
  }, [objectName])

  // Auto-pick the FK if there's exactly one candidate and we don't already
  // have one configured. Also clear the picked FK if it isn't among the
  // discovered options (e.g. someone repointed the widget at a new object).
  useEffect(() => {
    if (loadingFKs) return
    if (incomingFKs.length === 1 && !fkColumn) {
      setFkColumn(incomingFKs[0].referencing_column)
    }
    if (fkColumn && !incomingFKs.some(f => f.referencing_column === fkColumn)) {
      setFkColumn('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingFKs, incomingFKs])

  const fkOptions = useMemo(() =>
    incomingFKs
      .map(f => ({
        value: f.referencing_column,
        label: FK_LABELS[f.referencing_column] || f.referencing_column,
      }))
      .sort((a, b) => a.value.localeCompare(b.value)),
    [incomingFKs],
  )

  function validate() {
    if (!title.trim()) return 'Widget title is required'
    if (!fkColumn) return 'Pick the FK column that joins conversations to this object'
    return null
  }

  async function save() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      // Preserve any unknown keys an admin may have added by hand. Only the
      // two we manage in the UI get overwritten.
      const config = {
        ...cfg,
        table: 'conversations',
        fk: fkColumn,
      }
      if (channelFilter === 'sms' || channelFilter === 'email') {
        config.channel_filter = channelFilter
      } else {
        // Explicitly null out so a previously-set filter doesn't linger when
        // the admin chooses "All channels".
        delete config.channel_filter
      }
      await updateWidget(widget.id, {
        title: title.trim(),
        config,
      })
      toast.success('Conversation panel saved')
      onSaved()
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Edit conversation panel"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          width: isMobile ? '100%' : 560,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Edit Conversation Panel</div>
            <span style={{
              background: '#e8f3fb', color: '#1a5a8a',
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>conversation_panel</span>
            <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
              {widget.page_layout_widget_record_number}
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, lineHeight: 1.4 }}>
            Split-pane thread list + active thread + composer. Pulls from <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>conversations</code> joined on the FK that links it to <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{objectName}</code>.
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <FormField label="Widget Title" required>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
              placeholder="Conversations"
              style={inputStyle}
            />
          </FormField>

          <FormField label="Foreign-Key Column" required>
            {loadingFKs ? (
              <div style={{ fontSize: 12.5, color: C.textMuted, padding: '6px 0' }}>
                Loading available FKs…
              </div>
            ) : fkOptions.length === 0 ? (
              <div style={{ ...dangerBoxStyle, fontSize: 12.5 }}>
                No conversations-table FKs point at <code>{objectName}</code>. The conversation panel only works on objects that conversations can be anchored to (contacts, accounts, projects, service appointments). Use a different widget for this layout.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {fkOptions.map(opt => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px',
                      border: `1px solid ${fkColumn === opt.value ? C.emerald : C.border}`,
                      background: fkColumn === opt.value ? '#f0fbf6' : C.card,
                      borderRadius: 6,
                      cursor: busy ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      color: C.textPrimary,
                    }}
                  >
                    <input
                      type="radio"
                      name="conversation-panel-fk"
                      value={opt.value}
                      checked={fkColumn === opt.value}
                      onChange={() => setFkColumn(opt.value)}
                      disabled={busy}
                    />
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}>
                      {opt.label}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </FormField>

          <FormField label="Channel Filter">
            <select
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
              disabled={busy}
              style={inputStyle}
            >
              {CHANNEL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
              Optional. When set, only threads on the chosen channel show up in the left pane. Leave on "All channels" unless this layout is dedicated to one channel (e.g. an SMS-only customer-service view).
            </div>
          </FormField>

          {error && (
            <div style={{ ...dangerBoxStyle, marginTop: 10, fontSize: 12.5 }}>{error}</div>
          )}

          <div style={{ ...hintBoxStyle, marginTop: 14, fontSize: 12 }}>
            The widget honors the messages-table visibility model: threads only surface to users who are admin, recipients, on the anchor-opportunity contact roles, the record owner anywhere in the chain, or hold the <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>Communications: View All</code> grant. The editor here doesn't override visibility — it just configures which join column the panel queries on.
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${C.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 10,
        }}>
          <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button onClick={save} disabled={busy || loadingFKs} style={buttonPrimaryStyle}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
