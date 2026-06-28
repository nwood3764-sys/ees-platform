import { useEffect, useState, useMemo } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState, Icon } from '../../components/UI'
import { ListView } from '../../components/ListView'
import HelpIcon from '../../components/help/HelpIcon'
import { fetchAutomationRunLog } from '../../data/adminService'

// ---------------------------------------------------------------------------
// AutomationRunLogPane — Setup → Process Automation → Automation Run Log.
//
// Read-only audit feed of every automation_rules firing. One row per rule
// fire (or per dispatcher crash if the executor itself failed). Outcome
// renders as a color-coded chip. Clicking a row opens the trigger record.
// ---------------------------------------------------------------------------

const COLS = [
  { field: 'firedAtDisplay',  label: 'Fired',          type: 'text', sortable: true,  filterable: false },
  { field: 'id',              label: 'Record #',       type: 'text', sortable: true,  filterable: false },
  { field: 'ruleName',        label: 'Rule',           type: 'text', sortable: true,  filterable: true  },
  { field: 'triggerObject',   label: 'Trigger Object', type: 'text', sortable: true,  filterable: true  },
  { field: 'triggerStatus',   label: 'Trigger Status', type: 'text', sortable: true,  filterable: true  },
  { field: 'actionType',      label: 'Action',         type: 'text', sortable: true,  filterable: true  },
  { field: 'outcomeChip',     label: 'Outcome',        type: 'text', sortable: false, filterable: false },
  { field: 'outcomeMessage',  label: 'Message',        type: 'text', sortable: false, filterable: false },
]

// One system view for now. Sorted by firedAtDisplay descending so the
// most recent firings are at the top, matching the user expectation
// for an audit log. Add more here if/when we want filter presets
// (e.g. "errors only", "today only").
const SYSTEM_VIEWS = [
  { id: 'AV', name: 'All', filters: [], sortField: 'firedAtDisplay', sortDir: 'desc' },
]

function fmtTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function OutcomeChip({ outcome }) {
  const colors = {
    success: { bg: '#dcfce7', fg: '#166534', border: '#bbf7d0' },
    error:   { bg: '#e8f1fb', fg: '#1a5a8a', border: '#bcd9f2' },
    skipped: { bg: '#e8f1fb', fg: '#1e466b', border: '#bcd9f2' },
  }
  const c = colors[outcome] || { bg: '#e5e7eb', fg: '#374151', border: '#d1d5db' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
      background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
    }}>{outcome}</span>
  )
}

export default function AutomationRunLogPane() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAutomationRunLog()
      .then(data => {
        if (cancelled) return
        setRows(data)
        setError(null)
      })
      .catch(e => {
        if (cancelled) return
        setError(e.message || String(e))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const shaped = useMemo(() => rows.map(r => ({
    ...r,
    firedAtDisplay: fmtTimestamp(r.firedAt),
    outcomeChip: <OutcomeChip outcome={r.outcome} />,
  })), [rows])

  // Summary chips: success / skipped / error counts
  const summary = useMemo(() => {
    const counts = { success: 0, skipped: 0, error: 0 }
    for (const r of rows) {
      if (counts[r.outcome] != null) counts[r.outcome]++
    }
    return counts
  }, [rows])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState message={error} />

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" size={18} color={C.textPrimary} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
            Automation Run Log
          </div>
          <HelpIcon anchors={[
            { type: 'concept', concept: 'automation-rules-overview' },
            { type: 'concept', concept: 'automation-run-log' },
          ]} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <SummaryChip label="Success" count={summary.success} color="#16a34a" />
          <SummaryChip label="Skipped" count={summary.skipped} color="#1e466b" />
          <SummaryChip label="Error"   count={summary.error}   color="#2c5f8a" />
        </div>
      </div>
      <div style={{ padding: 18 }}>
        {rows.length === 0 ? (
          <div style={{
            padding: '60px 20px', textAlign: 'center',
            background: C.card, border: `1px dashed ${C.border}`,
            borderRadius: 8, color: C.textMuted, fontSize: 13,
          }}>
            No automations have fired yet. Once an active rule triggers, the
            firing will appear here with its outcome and any error details.
          </div>
        ) : (
          // ListView API: data + systemViews. Was passing the
          // pre-Dec-2025 rows/rowKey shape which would show an empty
          // table after the defensive defaults landed in 42dc6c0
          // (instead of crashing like /m/tasks did before the fix).
          <ListView
            columns={COLS}
            data={shaped}
            systemViews={SYSTEM_VIEWS}
            defaultViewId="AV"
          />
        )}
        <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
          Showing the 500 most recent firings. Older entries remain in the
          underlying log table and can be queried directly.
        </div>
      </div>
    </div>
  )
}

function SummaryChip({ label, count, color }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 12,
      background: C.card, border: `1px solid ${C.border}`,
      fontSize: 12, color: C.textSecondary,
    }}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: color,
      }} />
      <span style={{ fontWeight: 600, color: C.textPrimary }}>{count}</span>
      <span>{label}</span>
    </div>
  )
}
