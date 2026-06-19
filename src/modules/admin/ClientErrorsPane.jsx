import { useState, useEffect, useMemo } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { supabase } from '../../lib/supabase'

// =============================================================================
// ClientErrorsPane — admin triage for runtime errors captured by ErrorBoundary
//
// Background:
//   src/components/ErrorBoundary.jsx wraps the app's module tree and catches
//   any uncaught React render error. src/lib/clientErrorLogger.js also
//   installs window.onerror / window.onunhandledrejection handlers so
//   non-React exceptions get captured too. Every captured error becomes
//   one row in public.client_errors.
//
//   That data was silently accumulating with no UI to view it. This pane
//   closes the loop: list view of recent errors, click row → detail with
//   full stack + component stack + browser context, mark-resolved with
//   optional notes.
//
// Design:
//   • Two-pane layout: list on the left, detail panel on the right.
//     Familiar pattern from email clients and other triage tools.
//   • Default filter: unresolved + last 7 days. Most-recent first.
//     The thing the admin needs first is "what just broke for someone."
//   • Resolve actions in the detail panel, not inline in the list,
//     so the admin sees the full context before signing off on a fix.
//   • No "permanently delete" action. ce_is_deleted is the soft-delete
//     flag the schema gives us, but resolved+old is preferable to
//     deleted — historical trend data is valuable.
//
// What's NOT in this pane (intentionally):
//   • Grouping / dedup. Two identical errors in the same session would
//     get two rows. Could group by (ce_message, ce_route) but it adds
//     complexity for marginal benefit until volume grows.
//   • Charting / dashboards. Visual trend lines come later if traffic
//     justifies it. For now: a table that gets out of the way.
//   • Notification / alerting. No "page admin on fatal." Email/Slack
//     hooks added later if needed; the table polling is enough today.
// =============================================================================

const TIME_RANGES = [
  { value:    24, label: 'Last 24 hours' },
  { value:  7*24, label: 'Last 7 days'   },
  { value: 30*24, label: 'Last 30 days'  },
  { value:     0, label: 'All time'      },
]

const SEVERITY_OPTIONS = [
  { value: '',         label: '(any)'  },
  { value: 'fatal',    label: 'Fatal'  },
  { value: 'error',    label: 'Error'  },
  { value: 'warning',  label: 'Warning' },
]

const RESOLUTION_OPTIONS = [
  { value: 'unresolved', label: 'Unresolved only' },
  { value: 'resolved',   label: 'Resolved only'   },
  { value: 'all',        label: 'All'             },
]

const PAGE_SIZE = 100

// Format an ISO timestamp as "Yesterday 3:14 PM" / "2:14 PM today" /
// "Apr 18, 2:14 PM" depending on recency. Matches the AuditLog format
// used elsewhere in admin.
function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${t}`
  if (isYesterday) return `Yesterday ${t}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + t
}

// First line of the stack trace (excluding the message-echo line). For
// the row preview only — full stack lives in the detail panel.
function topFrame(stack) {
  if (!stack) return ''
  const lines = stack.split('\n').map(s => s.trim()).filter(Boolean)
  // Drop the first line if it's a "ErrorName: message" header
  const first = lines[0] || ''
  const start = first.includes(': ') && !first.startsWith('at ') ? 1 : 0
  return lines[start] || ''
}

export default function ClientErrorsPane() {
  const [rows,        setRows]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [reloadKey,   setReloadKey]   = useState(0)
  const [selectedId,  setSelectedId]  = useState(null)

  // Filter state
  const [timeRange,  setTimeRange]  = useState(7 * 24) // hours
  const [severity,   setSeverity]   = useState('')
  const [resolution, setResolution] = useState('unresolved')
  const [moduleFilter, setModuleFilter] = useState('')

  // ── Fetch ─────────────────────────────────────────────────────────────
  // Reads directly from the table. RLS via app_select_client_errors
  // gates this to users with the client_errors:select permission;
  // admins always pass.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    let q = supabase
      .from('client_errors')
      .select(`
        id, ce_record_number, ce_error_name, ce_message, ce_module,
        ce_route, ce_user_email, ce_severity, ce_resolved,
        ce_resolved_at, ce_resolution_notes, ce_created_at, ce_stack,
        ce_component_stack, ce_url, ce_user_agent, ce_viewport_width,
        ce_viewport_height, ce_session_id, ce_record_table, ce_record_id,
        ce_app_version
      `)
      .eq('ce_is_deleted', false)
      .order('ce_created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (timeRange > 0) {
      const cutoff = new Date(Date.now() - timeRange * 60 * 60 * 1000)
      q = q.gte('ce_created_at', cutoff.toISOString())
    }
    if (severity) {
      q = q.eq('ce_severity', severity)
    }
    if (resolution === 'unresolved') {
      // is.false matches the explicit false; or-clause handles legacy null
      q = q.or('ce_resolved.is.false,ce_resolved.is.null')
    } else if (resolution === 'resolved') {
      q = q.eq('ce_resolved', true)
    }
    if (moduleFilter.trim()) {
      q = q.ilike('ce_module', `%${moduleFilter.trim()}%`)
    }

    q.then(({ data, error: qErr }) => {
      if (cancelled) return
      if (qErr) { setError(qErr); setLoading(false); return }
      setRows(data || [])
      // If the selected row dropped out of the filtered set, clear it
      if (selectedId && !(data || []).some(r => r.id === selectedId)) {
        setSelectedId(null)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  // Filters trigger refetch via reloadKey OR by being added below; keeping
  // them out of the dep array would let the Apply button do all the work.
  // We treat filter state as live (instant refresh on change) — cheaper
  // than wiring a debounce because the table is small per page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, timeRange, severity, resolution])

  const refresh = () => setReloadKey(k => k + 1)
  const selected = useMemo(() => rows.find(r => r.id === selectedId) || null, [rows, selectedId])

  // ── Mark resolved / unresolved ────────────────────────────────────────
  const markResolved = async (id, notes) => {
    const { error: updErr } = await supabase
      .from('client_errors')
      .update({
        ce_resolved:          true,
        ce_resolved_at:       new Date().toISOString(),
        ce_resolution_notes:  notes || null,
      })
      .eq('id', id)
    if (updErr) return updErr
    refresh()
    return null
  }

  const markUnresolved = async (id) => {
    const { error: updErr } = await supabase
      .from('client_errors')
      .update({
        ce_resolved:          false,
        ce_resolved_at:       null,
        ce_resolution_notes:  null,
      })
      .eq('id', id)
    if (updErr) return updErr
    refresh()
    return null
  }

  // ── Styles ────────────────────────────────────────────────────────────
  const inputStyle = {
    fontSize: 12.5, padding: '5px 8px',
    border: `1px solid ${C.border}`, borderRadius: 4,
    background: '#fff', color: C.textPrimary,
    fontFamily: 'inherit',
  }
  const labelStyle = { fontSize: 11, color: C.textMuted, fontWeight: 600 }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header + filters */}
      <div style={{ padding: '14px 24px 12px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Client Errors</div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
              {loading
                ? 'Loading…'
                : `${rows.length} error${rows.length === 1 ? '' : 's'}${rows.length === PAGE_SIZE ? ' (showing most recent ' + PAGE_SIZE + ')' : ''}`}
            </div>
          </div>
          <button onClick={refresh}
            style={{
              fontSize: 12.5, padding: '6px 14px',
              background: 'transparent', color: C.textSecondary,
              border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer',
            }}>
            Refresh
          </button>
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Time range</label>
            <select value={timeRange} onChange={e => setTimeRange(parseInt(e.target.value, 10))}
              style={{ ...inputStyle, width: 160 }}>
              {TIME_RANGES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Status</label>
            <select value={resolution} onChange={e => setResolution(e.target.value)}
              style={{ ...inputStyle, width: 160 }}>
              {RESOLUTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Severity</label>
            <select value={severity} onChange={e => setSeverity(e.target.value)}
              style={{ ...inputStyle, width: 120 }}>
              {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={labelStyle}>Module contains</label>
            <input type="text" value={moduleFilter}
              placeholder="e.g. outreach"
              onChange={e => setModuleFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') refresh() }}
              onBlur={refresh}
              style={{ ...inputStyle, width: 180 }} />
          </div>
        </div>
      </div>

      {/* Body: list + detail */}
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && rows.length === 0 && (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.textMuted, fontSize: 13, padding: 40, textAlign: 'center',
        }}>
          No errors match the current filters. This is what success looks like.
        </div>
      )}
      {!loading && !error && rows.length > 0 && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <ErrorList rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
          {selected ? (
            <ErrorDetail
              row={selected}
              onMarkResolved={markResolved}
              onMarkUnresolved={markUnresolved}
            />
          ) : (
            <div style={{
              flex: 1, padding: 24, color: C.textMuted, fontSize: 13,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              Select an error to view details.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// ErrorList — left pane with one row per error
// =============================================================================
function ErrorList({ rows, selectedId, onSelect }) {
  return (
    <div style={{
      width: 460, borderRight: `1px solid ${C.border}`,
      overflowY: 'auto', background: C.page,
    }}>
      {rows.map(r => (
        <ErrorRow key={r.id} row={r} selected={r.id === selectedId} onClick={() => onSelect(r.id)} />
      ))}
    </div>
  )
}

function ErrorRow({ row, selected, onClick }) {
  // The severity color hint at the left edge of the row. Helps the
  // admin scan a list of mixed-severity errors at a glance.
  const sevColor = row.ce_severity === 'fatal'   ? '#2c5f8a'
                : row.ce_severity === 'warning' ? '#f39c12'
                :                                  '#7f8c8d'

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 16px',
        borderBottom: `1px solid ${C.border}`,
        cursor: 'pointer',
        background: selected ? '#e8f4fd' : (row.ce_resolved ? '#fafafa' : '#fff'),
        borderLeft: `3px solid ${row.ce_resolved ? '#27ae60' : sevColor}`,
        opacity: row.ce_resolved ? 0.72 : 1,
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
          {row.ce_record_number}
        </span>
        <span style={{ fontSize: 11, color: C.textMuted }}>·</span>
        <span style={{ fontSize: 11, color: C.textMuted }}>{formatWhen(row.ce_created_at)}</span>
        {row.ce_resolved && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: '#27ae60',
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3,
          }}>
            Resolved
          </span>
        )}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600, color: C.textPrimary,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginBottom: 3,
      }}>
        {row.ce_error_name ? `${row.ce_error_name}: ` : ''}{row.ce_message}
      </div>
      <div style={{ fontSize: 11.5, color: C.textSecondary, display: 'flex', gap: 8 }}>
        {row.ce_module && (
          <span style={{
            padding: '1px 6px', borderRadius: 3, background: '#ecf0f1',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5,
          }}>
            {row.ce_module}
          </span>
        )}
        {row.ce_user_email && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.ce_user_email}
          </span>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// ErrorDetail — right pane with full stack + resolve controls
// =============================================================================
function ErrorDetail({ row, onMarkResolved, onMarkUnresolved }) {
  const [notes,    setNotes]    = useState('')
  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState(null)

  // Reset notes input when switching rows. Notes apply to a specific
  // resolution; leftover text from a previous selection would be wrong.
  useEffect(() => { setNotes(''); setSaveErr(null) }, [row.id])

  const handleResolve = async () => {
    setSaving(true); setSaveErr(null)
    const err = await onMarkResolved(row.id, notes.trim())
    setSaving(false)
    if (err) setSaveErr(err)
  }

  const handleUnresolve = async () => {
    setSaving(true); setSaveErr(null)
    const err = await onMarkUnresolved(row.id)
    setSaving(false)
    if (err) setSaveErr(err)
  }

  const Section = ({ label, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10.5, fontWeight: 700, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  )

  const codeBlock = {
    background: '#1e2a36', color: '#e8eef4',
    padding: '10px 12px', borderRadius: 4,
    fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    lineHeight: 1.5, maxHeight: 320, overflowY: 'auto',
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: C.card }}>
      <div style={{ padding: '18px 24px' }}>
        {/* Heading: record number + severity + resolved badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
            color: C.textMuted,
          }}>
            {row.ce_record_number}
          </span>
          {row.ce_severity && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
              background:
                row.ce_severity === 'fatal' ? '#fae0dc' :
                row.ce_severity === 'warning' ? '#fdebd0' : '#e8eef4',
              color:
                row.ce_severity === 'fatal' ? '#2c5f8a' :
                row.ce_severity === 'warning' ? '#9c640c' : '#34495e',
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {row.ce_severity}
            </span>
          )}
          {row.ce_resolved && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3,
              background: '#d5f5e3', color: '#196f3d',
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              Resolved
            </span>
          )}
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
          {row.ce_error_name || 'Error'}
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 18 }}>
          {row.ce_message}
        </div>

        {row.ce_stack && (
          <Section label="Stack trace">
            <pre style={codeBlock}>{row.ce_stack}</pre>
          </Section>
        )}

        {row.ce_component_stack && (
          <Section label="React component stack">
            <pre style={codeBlock}>{row.ce_component_stack}</pre>
          </Section>
        )}

        <Section label="Context">
          <table style={{ fontSize: 12, color: C.textPrimary, borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <Kv k="Occurred"   v={new Date(row.ce_created_at).toLocaleString()} />
              <Kv k="User"       v={row.ce_user_email || '(unauthenticated)'} />
              <Kv k="Module"     v={row.ce_module || '(unknown)'} />
              <Kv k="Route"      v={row.ce_route || '—'} mono />
              <Kv k="URL"        v={row.ce_url || '—'} mono />
              {row.ce_record_table && (
                <Kv k="Record" v={`${row.ce_record_table} / ${row.ce_record_id || '—'}`} mono />
              )}
              <Kv k="Viewport"   v={row.ce_viewport_width && row.ce_viewport_height
                ? `${row.ce_viewport_width} × ${row.ce_viewport_height}`
                : '—'} />
              <Kv k="User agent" v={row.ce_user_agent || '—'} mono small />
              <Kv k="Session"    v={row.ce_session_id || '—'} mono small />
              <Kv k="App version" v={row.ce_app_version || '—'} mono />
            </tbody>
          </table>
        </Section>

        {/* Resolve controls */}
        <Section label={row.ce_resolved ? 'Resolution' : 'Mark as resolved'}>
          {row.ce_resolved ? (
            <div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginBottom: 6 }}>
                Resolved {new Date(row.ce_resolved_at).toLocaleString()}.
                {row.ce_resolution_notes && (
                  <span> Notes: <span style={{ color: C.textPrimary }}>{row.ce_resolution_notes}</span></span>
                )}
              </div>
              <button onClick={handleUnresolve} disabled={saving}
                style={{
                  fontSize: 12.5, padding: '6px 14px',
                  background: 'transparent', color: C.textSecondary,
                  border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer',
                }}>
                {saving ? 'Reopening…' : 'Reopen'}
              </button>
            </div>
          ) : (
            <div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional: what was the fix? Link to commit, ticket, etc."
                rows={3}
                style={{
                  width: '100%', fontSize: 12.5, padding: '8px 10px',
                  border: `1px solid ${C.border}`, borderRadius: 4,
                  fontFamily: 'inherit', color: C.textPrimary, marginBottom: 8,
                  resize: 'vertical',
                }}
              />
              <button onClick={handleResolve} disabled={saving}
                style={{
                  fontSize: 12.5, padding: '6px 18px',
                  background: C.emerald, color: '#fff',
                  border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontWeight: 500,
                }}>
                {saving ? 'Saving…' : 'Mark resolved'}
              </button>
              {saveErr && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#e85a4f' }}>
                  Save failed: {saveErr.message}
                </div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

// Tiny key/value row for the Context table.
function Kv({ k, v, mono, small }) {
  return (
    <tr>
      <td style={{
        padding: '4px 14px 4px 0', color: C.textMuted, fontWeight: 500,
        whiteSpace: 'nowrap', verticalAlign: 'top', fontSize: 11.5,
      }}>{k}</td>
      <td style={{
        padding: '4px 0', color: C.textPrimary,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        fontSize: small ? 10.5 : 12,
        wordBreak: 'break-word',
      }}>{v}</td>
    </tr>
  )
}
