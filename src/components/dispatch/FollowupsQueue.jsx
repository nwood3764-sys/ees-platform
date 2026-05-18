// FollowupsQueue.jsx — Open dispatcher_followup_requests surface inside the
// Dispatch Console (activated via the Console | Resources | Follow-ups
// toggle).
//
// Lists every Open + In Progress DFR oldest-first (oldest unresolved =
// highest triage priority). Each row shows the captured customer info, the
// failure reason, the age of the request, and inline action buttons.
//
// Inline actions:
//   • "Claim"   — Open → In Progress (flags the dispatcher is on it)
//   • "Close"   — Open/In Progress → Closed (stamps resolved_at/_by)
//   • record-detail click-through on the DFR number for full notes/resolution
//
// Filter: search box (matches customer name / record number / city) +
// reason multi-select.
//
// Mobile (< 768px): switches to per-DFR cards with the action buttons
// stacked beneath the customer info.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { C } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../UI'
import { useIsMobile } from '../../lib/useMediaQuery'
import { getCurrentUserId } from '../../data/layoutService'
import {
  fetchDfrPicklists,
  fetchOpenDispatcherFollowups,
  updateDfrStatus,
  formatDfrAddressOneLine,
  formatDfrAge,
} from '../../data/dispatcherFollowups'

export default function FollowupsQueue({ onNavigateToRecord }) {
  const isMobile = useIsMobile()

  // ── Data state ─────────────────────────────────────────────────────
  const [loading, setLoading]    = useState(true)
  const [error, setError]        = useState(null)
  const [rows, setRows]          = useState([])
  const [reasonOptions, setReasonOptions] = useState([])

  // ── Filter state ───────────────────────────────────────────────────
  const [search, setSearch]      = useState('')
  const [reasonFilter, setReasonFilter] = useState([])  // value[] — empty = all
  const [busyDfrId, setBusyDfrId] = useState(null)      // disables row buttons while a flip is in flight

  // ── Initial load ───────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pl, queue] = await Promise.all([
        fetchDfrPicklists(),
        fetchOpenDispatcherFollowups(),
      ])
      setReasonOptions(
        Object.entries(pl.reasonByValueLabel)
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label))
      )
      setRows(queue)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Filtered + sorted rows ─────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (reasonFilter.length > 0 && !reasonFilter.includes(r._reason_value)) return false
      if (q) {
        const hay = [
          r.dfr_record_number,
          r.dfr_customer_first_name, r.dfr_customer_last_name,
          r.dfr_address_city, r.dfr_address_state,
          r._work_type_name,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, reasonFilter])

  // ── Inline status flip ─────────────────────────────────────────────
  const handleFlip = useCallback(async (dfrId, nextStatus) => {
    setBusyDfrId(dfrId)
    try {
      const me = await getCurrentUserId()
      await updateDfrStatus({
        dfr_id: dfrId,
        new_status_value: nextStatus,
        current_user_id: me,
      })
      // For Closed: drop the row out of the queue locally (oldest-first
      // ordering preserved). For In Progress: update the label in place
      // so the dispatcher can see the claim took.
      if (nextStatus === 'Closed' || nextStatus === 'Resolved') {
        setRows(prev => prev.filter(r => r.id !== dfrId))
      } else {
        setRows(prev => prev.map(r =>
          r.id === dfrId ? { ...r, _status_value: nextStatus, _status_label: nextStatus } : r
        ))
      }
    } catch (e) {
      // Surface the error in the row error banner area
      setError(`Could not update DFR: ${e.message || e}`)
    } finally {
      setBusyDfrId(null)
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 24 }}><LoadingState message="Loading dispatcher follow-ups…" /></div>
  if (error)   return <div style={{ padding: 24 }}><ErrorState message={error} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Sub-toolbar: search + reason filter + count badge */}
      <div style={subToolbar}>
        <input
          type="text" placeholder="Search name, DFR #, or city…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={searchInput}
        />
        {reasonOptions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {reasonOptions.map(r => {
              const active = reasonFilter.includes(r.value)
              return (
                <button
                  key={r.value}
                  onClick={() => setReasonFilter(prev =>
                    prev.includes(r.value) ? prev.filter(v => v !== r.value) : [...prev, r.value]
                  )}
                  style={pillButton(active)}
                  type="button"
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={countBadge}>
          {filteredRows.length} open
        </div>
      </div>

      {/* Queue body */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 12 : 16 }}>
        {filteredRows.length === 0 ? (
          <div style={emptyState}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
              Nothing in the queue.
            </div>
            <div style={{ color: C.textSecondary, fontSize: 13 }}>
              No Open or In Progress dispatcher follow-up requests match the current filter.
            </div>
          </div>
        ) : isMobile ? (
          <MobileCards
            rows={filteredRows}
            busyDfrId={busyDfrId}
            onFlip={handleFlip}
            onNavigateToRecord={onNavigateToRecord}
          />
        ) : (
          <DesktopTable
            rows={filteredRows}
            busyDfrId={busyDfrId}
            onFlip={handleFlip}
            onNavigateToRecord={onNavigateToRecord}
          />
        )}
      </div>
    </div>
  )
}

// ─── Desktop table ───────────────────────────────────────────────────────
function DesktopTable({ rows, busyDfrId, onFlip, onNavigateToRecord }) {
  return (
    <div style={tableShell}>
      <div style={tableHeader}>
        <div style={{ ...headerCell, flex: '0 0 110px' }}>Record</div>
        <div style={{ ...headerCell, flex: '0 0 180px' }}>Customer</div>
        <div style={{ ...headerCell, flex: '0 0 140px' }}>Phone</div>
        <div style={{ ...headerCell, flex: 1 }}>Address</div>
        <div style={{ ...headerCell, flex: '0 0 140px' }}>Reason</div>
        <div style={{ ...headerCell, flex: '0 0 110px' }}>Status</div>
        <div style={{ ...headerCell, flex: '0 0 100px' }}>Age</div>
        <div style={{ ...headerCell, flex: '0 0 180px' }}>Actions</div>
      </div>
      {rows.map(row => (
        <div key={row.id} style={tableRow}>
          <div style={{ ...rowCell, flex: '0 0 110px' }}>
            <button
              type="button"
              onClick={() => onNavigateToRecord?.({ table: 'dispatcher_followup_requests', id: row.id })}
              style={linkButton}
            >
              {row.dfr_record_number}
            </button>
          </div>
          <div style={{ ...rowCell, flex: '0 0 180px' }}>
            <div style={{ fontWeight: 600, color: C.textPrimary }}>
              {row.dfr_customer_first_name} {row.dfr_customer_last_name}
            </div>
            {row._work_type_name && (
              <div style={{ fontSize: 12, color: C.textSecondary }}>{row._work_type_name}</div>
            )}
          </div>
          <div style={{ ...rowCell, flex: '0 0 140px', fontVariantNumeric: 'tabular-nums' }}>
            {row.dfr_phone ? (
              <a href={`tel:${row.dfr_phone}`} style={phoneLink}>{row.dfr_phone}</a>
            ) : (
              <span style={{ color: C.textSecondary }}>—</span>
            )}
          </div>
          <div style={{ ...rowCell, flex: 1, color: C.textSecondary, fontSize: 13 }}>
            {formatDfrAddressOneLine(row) || '—'}
          </div>
          <div style={{ ...rowCell, flex: '0 0 140px' }}>
            <ReasonChip reason={row._reason_value} label={row._reason_label} />
          </div>
          <div style={{ ...rowCell, flex: '0 0 110px' }}>
            <StatusChip status={row._status_value} />
          </div>
          <div style={{ ...rowCell, flex: '0 0 100px', color: C.textSecondary, fontSize: 13 }}>
            {formatDfrAge(row.dfr_created_at)}
          </div>
          <div style={{ ...rowCell, flex: '0 0 180px' }}>
            <RowActions
              row={row}
              busy={busyDfrId === row.id}
              onFlip={onFlip}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Mobile cards ────────────────────────────────────────────────────────
function MobileCards({ rows, busyDfrId, onFlip, onNavigateToRecord }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map(row => (
        <div key={row.id} style={mobileCard}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <button
              type="button"
              onClick={() => onNavigateToRecord?.({ table: 'dispatcher_followup_requests', id: row.id })}
              style={{ ...linkButton, fontSize: 14 }}
            >
              {row.dfr_record_number}
            </button>
            <span style={{ flex: 1 }} />
            <StatusChip status={row._status_value} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>
            {row.dfr_customer_first_name} {row.dfr_customer_last_name}
          </div>
          {row._work_type_name && (
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 6 }}>
              {row._work_type_name}
            </div>
          )}
          {row.dfr_phone && (
            <div style={{ marginBottom: 4 }}>
              <a href={`tel:${row.dfr_phone}`} style={phoneLink}>{row.dfr_phone}</a>
            </div>
          )}
          {row.dfr_email && (
            <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
              {row.dfr_email}
            </div>
          )}
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 8 }}>
            {formatDfrAddressOneLine(row) || '—'}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
            <ReasonChip reason={row._reason_value} label={row._reason_label} />
            <span style={{ color: C.textSecondary, fontSize: 12 }}>
              {formatDfrAge(row.dfr_created_at)}
            </span>
          </div>
          <RowActions row={row} busy={busyDfrId === row.id} onFlip={onFlip} stretched />
        </div>
      ))}
    </div>
  )
}

// ─── Bits & pieces ───────────────────────────────────────────────────────
function RowActions({ row, busy, onFlip, stretched = false }) {
  const status = row._status_value
  const btnStyle = stretched
    ? { ...actionButton, flex: 1 }
    : actionButton
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {status === 'Open' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onFlip(row.id, 'In Progress')}
          style={{ ...btnStyle, ...primaryActionTone }}
        >
          {busy ? '…' : 'Claim'}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onFlip(row.id, 'Closed')}
        style={btnStyle}
      >
        {busy ? '…' : 'Close'}
      </button>
    </div>
  )
}

function ReasonChip({ reason, label }) {
  const tone = REASON_TONE[reason] || REASON_TONE.default
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600,
      background: tone.bg, color: tone.fg,
    }}>{label || reason}</span>
  )
}

function StatusChip({ status }) {
  const tone = status === 'In Progress' ? STATUS_TONE.inprogress : STATUS_TONE.open
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600,
      background: tone.bg, color: tone.fg,
    }}>{status}</span>
  )
}

const REASON_TONE = {
  out_of_territory:        { bg: '#fef3c7', fg: '#8a5a04' },
  no_qualifying_resources: { bg: '#fde7e7', fg: '#a01616' },
  no_availability:         { bg: '#e0e8f5', fg: '#274780' },
  general_inquiry:         { bg: '#e7f8f0', fg: '#1e7d4f' },
  default:                 { bg: '#eef0f3', fg: '#4a5568' },
}

const STATUS_TONE = {
  open:       { bg: '#fef3c7', fg: '#8a5a04' },
  inprogress: { bg: '#e0e8f5', fg: '#274780' },
}

// ─── styles ──────────────────────────────────────────────────────────────
const subToolbar = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 16px',
  borderBottom: `1px solid ${C.border}`,
  background: C.surface,
  flexWrap: 'wrap',
}

const searchInput = {
  fontSize: 14, padding: '6px 10px',
  border: `1px solid ${C.border}`, borderRadius: 6,
  width: 280, maxWidth: '100%',
  background: '#fff', color: C.textPrimary,
}

const pillButton = (active) => ({
  fontSize: 12, fontWeight: 500,
  padding: '4px 10px',
  border: `1px solid ${active ? C.emeraldMid : C.border}`,
  borderRadius: 12,
  background: active ? C.emeraldMid : '#fff',
  color: active ? '#fff' : C.textSecondary,
  cursor: 'pointer',
})

const countBadge = {
  fontSize: 12, fontWeight: 600,
  padding: '4px 10px',
  background: '#eef0f3', color: C.textSecondary,
  borderRadius: 12,
}

const tableShell = {
  border: `1px solid ${C.border}`, borderRadius: 8,
  background: '#fff', overflow: 'hidden',
}

const tableHeader = {
  display: 'flex',
  padding: '10px 14px',
  borderBottom: `1px solid ${C.border}`,
  background: '#f8f9fb',
  fontSize: 11, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.4,
  color: C.textSecondary,
}

const headerCell = {
  paddingRight: 8,
}

const tableRow = {
  display: 'flex', alignItems: 'center',
  padding: '12px 14px',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 14,
  color: C.textPrimary,
}

const rowCell = {
  paddingRight: 8, minWidth: 0,
}

const linkButton = {
  background: 'transparent', border: 'none', padding: 0,
  color: C.emeraldMid, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', textAlign: 'left',
}

const phoneLink = {
  color: C.textPrimary, fontSize: 13, fontWeight: 500,
  textDecoration: 'none',
}

const actionButton = {
  fontSize: 12, fontWeight: 500,
  padding: '5px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  background: '#fff', color: C.textPrimary,
  cursor: 'pointer',
}

const primaryActionTone = {
  background: C.emeraldMid, color: '#fff', border: 'none',
}

const emptyState = {
  padding: 32,
  textAlign: 'center',
}

const mobileCard = {
  padding: 14,
  background: '#fff',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
}
