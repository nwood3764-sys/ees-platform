// ---------------------------------------------------------------------------
// ProjectSchedulerWizard — bulk-schedule unscheduled work orders on a project.
//
// 3-step modal:
//   1. Select WOs (with up/down arrows to set placement order)
//   2. Pick Team Lead + date range
//   3. Gantt preview → Confirm. On commit the wizard closes; a toast confirms
//      the result. No separate "Done" screen.
//
// The engine is server-side (public.bulk_schedule_work_orders). This component
// is a UI shell: it loads data, sends RPC calls, displays results. Per-WO
// post-buffer + same-unit-zero-buffer is engine behavior; the wizard simply
// presents the resulting plan as a Gantt chart.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../UI'
import { useToast } from '../Toast'
import {
  fetchUnscheduledWorkOrdersForProject,
  fetchTeamLeads,
  bulkScheduleWorkOrders,
  summarizeWorkOrderDurations,
  describePlacementError,
} from '../../data/projectScheduler'

// ── Date helpers ────────────────────────────────────────────────────────────

function isoDateOnly(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Next Monday relative to today; if today IS Monday, returns next Monday.
function nextMonday() {
  const d = new Date()
  const day = d.getDay()              // Sun=0, Mon=1, ..., Sat=6
  const delta = day === 0 ? 1 : (day === 1 ? 7 : 8 - day)
  d.setDate(d.getDate() + delta)
  d.setHours(0, 0, 0, 0)
  return d
}
function addDays(d, n) {
  const out = new Date(d); out.setDate(out.getDate() + n); return out
}
function dayKey(iso) {                 // 'YYYY-MM-DDTHH:MM:SS' → 'YYYY-MM-DD'
  return iso ? iso.slice(0, 10) : ''
}
function timeKey(iso) {                // 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM'
  return iso ? iso.slice(11, 16) : ''
}
function prettyDay(iso) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Main wizard ─────────────────────────────────────────────────────────────

export default function ProjectSchedulerWizard({ projectId, project, onClose, onCommitted }) {
  const toast = useToast()

  const [step, setStep] = useState(1)            // 1=select, 2=window, 3=preview/confirm
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Step 1 data
  const [workOrders, setWorkOrders] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  // User-controllable placement order. Holds ALL workOrder ids in display
  // order; the RPC receives only the selected subset in this order.
  const [woOrder, setWoOrder] = useState([])

  // Step 2 data
  const [teamLeads, setTeamLeads] = useState([])
  const [teamLeadId, setTeamLeadId] = useState('')
  const defaultStart = useMemo(() => isoDateOnly(nextMonday()), [])
  const defaultEnd   = useMemo(() => isoDateOnly(addDays(nextMonday(), 4)), [])  // Mon–Fri
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)

  // Step 3 data (preview + commit)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null)         // array of rows from RPC
  const [previewError, setPreviewError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState(null)

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [wos, leads] = await Promise.all([
          fetchUnscheduledWorkOrdersForProject(projectId),
          fetchTeamLeads(),
        ])
        if (cancelled) return
        setWorkOrders(wos)
        setWoOrder(wos.map(w => w.id))
        setSelectedIds(new Set(wos.filter(w => w.duration_minutes != null && w.duration_minutes > 0).map(w => w.id)))
        setTeamLeads(leads)
        if (leads.length === 1) setTeamLeadId(leads[0].id)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId])

  // ── Derived ──────────────────────────────────────────────────────────────
  // workOrders in the user-controlled placement order. The RPC is order-
  // sensitive: it walks ids in array order, so this list drives placement.
  const orderedWorkOrders = useMemo(() => {
    const byId = new Map(workOrders.map(w => [w.id, w]))
    return woOrder.map(id => byId.get(id)).filter(Boolean)
  }, [workOrders, woOrder])

  const orderedSelectedIds = useMemo(
    () => woOrder.filter(id => selectedIds.has(id)),
    [woOrder, selectedIds]
  )
  const selectedWorkOrders = useMemo(
    () => orderedWorkOrders.filter(w => selectedIds.has(w.id)),
    [orderedWorkOrders, selectedIds]
  )
  const summary = useMemo(
    () => summarizeWorkOrderDurations(selectedWorkOrders),
    [selectedWorkOrders]
  )
  const previewSummary = useMemo(() => {
    if (!preview) return null
    const placed = preview.filter(r => r.placed).length
    const unplaced = preview.filter(r => !r.placed).length
    const errorsByKind = {}
    for (const r of preview) if (!r.placed) errorsByKind[r.placement_error] = (errorsByKind[r.placement_error] || 0) + 1
    return { total: preview.length, placed, unplaced, errorsByKind }
  }, [preview])

  // Group placement rows by day for the Gantt
  const previewByDay = useMemo(() => {
    if (!preview) return []
    const groups = new Map()
    for (const r of preview) {
      const k = r.placed ? dayKey(r.scheduled_start_iso) : '(unplaced)'
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    const out = []
    for (const [k, rows] of groups) {
      const sorted = k === '(unplaced)'
        ? rows
        : [...rows].sort((a, b) => (a.scheduled_start_iso || '').localeCompare(b.scheduled_start_iso || ''))
      out.push({ day: k, rows: sorted })
    }
    out.sort((a, b) => {
      if (a.day === '(unplaced)') return 1
      if (b.day === '(unplaced)') return -1
      return a.day.localeCompare(b.day)
    })
    return out
  }, [preview])

  // ── Actions ──────────────────────────────────────────────────────────────

  const toggleOne = id => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedIds(next)
    setPreview(null)
  }
  const toggleAll = () => {
    if (selectedIds.size === workOrders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(workOrders.map(w => w.id)))
    setPreview(null)
  }
  const selectOnlyValid = () => {
    setSelectedIds(new Set(workOrders.filter(w => w.duration_minutes != null && w.duration_minutes > 0).map(w => w.id)))
    setPreview(null)
  }
  // Reorder: swap a WO with its neighbor. Operates on all workOrders (not
  // just selected) so the user can position an unchecked WO between two
  // selected ones if they want to.
  const moveUp = id => {
    setWoOrder(prev => {
      const i = prev.indexOf(id)
      if (i <= 0) return prev
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })
    setPreview(null)
  }
  const moveDown = id => {
    setWoOrder(prev => {
      const i = prev.indexOf(id)
      if (i < 0 || i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
    setPreview(null)
  }

  const validateStep1 = () => {
    if (selectedIds.size === 0) return 'Select at least one work order.'
    if (summary.missingCount > 0) return `${summary.missingCount} selected work order(s) have no duration set. Remove them or set a duration first.`
    return null
  }
  const validateStep2 = () => {
    if (!teamLeadId) return 'Pick a Team Lead.'
    if (!startDate || !endDate) return 'Start and end dates are required.'
    if (startDate > endDate) return 'End date must be on or after start date.'
    return null
  }

  const runPreview = async () => {
    setPreviewing(true); setPreviewError(null); setPreview(null)
    try {
      const rows = await bulkScheduleWorkOrders({
        projectId,
        workOrderIds: orderedSelectedIds,
        teamLeadContactId: teamLeadId,
        startDate, endDate,
        commit: false,
      })
      setPreview(rows)
      setStep(3)
    } catch (e) {
      setPreviewError(e.message || 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  const runCommit = async () => {
    setCommitting(true); setCommitError(null)
    try {
      const rows = await bulkScheduleWorkOrders({
        projectId,
        workOrderIds: orderedSelectedIds,
        teamLeadContactId: teamLeadId,
        startDate, endDate,
        commit: true,
      })
      const placed = rows.filter(r => r.placed).length
      const unplaced = rows.filter(r => !r.placed).length
      onCommitted?.()
      if (unplaced > 0) {
        toast.success(`Scheduled ${placed} work order${placed === 1 ? '' : 's'}. ${unplaced} did not fit — extend the window and run again to place the rest.`)
      } else {
        toast.success(`Scheduled ${placed} work order${placed === 1 ? '' : 's'}.`)
      }
      onClose()
    } catch (e) {
      setCommitError(e.message || 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  // ── Styles (match ProjectReportModal idiom) ──────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100, padding: 16,
  }
  const card = {
    width: '100%', maxWidth: 760, maxHeight: 'calc(100vh - 32px)',
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden', display: 'flex', flexDirection: 'column',
  }
  const headerStyle = {
    padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  }
  const bodyStyle = { padding: 20, overflow: 'auto', flex: 1 }
  const footerStyle = {
    padding: '14px 20px', borderTop: `1px solid ${C.border}`,
    display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center',
    background: C.page, flexShrink: 0,
  }
  const labelStyle = { display: 'block', fontSize: 11.5, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }
  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, color: C.textPrimary, boxSizing: 'border-box' }
  const hintStyle  = { fontSize: 11.5, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }

  const primaryBtn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled}
      style={{
        background: opts.disabled ? '#d1d5db' : C.emerald,
        color: 'white', border: 'none', borderRadius: 6, padding: '8px 16px',
        fontSize: 13, fontWeight: 600, cursor: opts.disabled ? 'not-allowed' : 'pointer',
        opacity: opts.busy ? 0.7 : 1,
      }}>{opts.busy ? (opts.busyLabel || 'Working…') : label}</button>
  )
  const secondaryBtn = (label, onClick, opts = {}) => (
    <button onClick={onClick} disabled={opts.disabled}
      style={{
        background: 'transparent', color: C.textSecondary,
        border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px',
        fontSize: 13, fontWeight: 500, cursor: opts.disabled ? 'not-allowed' : 'pointer',
      }}>{label}</button>
  )

  // ── Step renderers ───────────────────────────────────────────────────────

  function StepIndicator() {
    const steps = ['Select & order', 'Crew & window', 'Preview & schedule']
    return (
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {steps.map((label, i) => {
          const n = i + 1
          const isActive = step === n
          const isDone = step > n
          return (
            <div key={n} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', borderRadius: 999,
              fontSize: 11.5, fontWeight: 600,
              background: isActive ? '#ecfdf5' : (isDone ? '#f0fdf4' : C.page),
              color: isActive ? C.emerald : (isDone ? '#15803d' : C.textMuted),
              border: `1px solid ${isActive ? '#a7f3d0' : (isDone ? '#bbf7d0' : C.border)}`,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 999,
                background: isActive ? C.emerald : (isDone ? '#15803d' : C.textMuted),
                color: 'white', fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{isDone ? '✓' : n}</span>
              {label}
            </div>
          )
        })}
      </div>
    )
  }

  function renderStep1() {
    const step1Err = validateStep1()
    // Empty state — every WO on the project is already scheduled (or there
    // are none yet). Don't show the table + yellow warning; show a calm
    // "nothing to do" panel.
    if (workOrders.length === 0) {
      return (
        <>
          <StepIndicator />
          <div style={{
            padding: 36, textAlign: 'center',
            background: C.page, border: `1px solid ${C.border}`, borderRadius: 8,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 999, background: '#15803d',
              margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon path="M5 13l4 4L19 7" size={24} color="white" />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
              Nothing to schedule
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55 }}>
              This project has no work orders in status <strong>To Be Scheduled</strong>.
              All work orders are either already scheduled or in another status.
            </div>
          </div>
        </>
      )
    }
    return (
      <>
        <StepIndicator />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            Unscheduled work orders ({workOrders.length})
          </div>
          <div style={hintStyle}>
            Pick which work orders to schedule and the sequence the crew will work them in.
            Use the ▲▼ arrows to reorder. The engine walks the list in order, packing same-unit
            work orders back-to-back. Default order matches what the property loader returns
            (typically grouped by building/unit).
          </div>
        </div>

        {/* Bulk toggles */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button onClick={toggleAll}
            style={{ fontSize: 12, padding: '5px 10px', border: `1px solid ${C.border}`,
                     borderRadius: 5, background: C.card, cursor: 'pointer', color: C.textSecondary }}>
            {selectedIds.size === workOrders.length ? 'Deselect all' : 'Select all'}
          </button>
          {workOrders.some(w => w.duration_minutes == null || w.duration_minutes <= 0) && (
            <button onClick={selectOnlyValid}
              style={{ fontSize: 12, padding: '5px 10px', border: `1px solid ${C.border}`,
                       borderRadius: 5, background: C.card, cursor: 'pointer', color: C.textSecondary }}>
              Select only with duration
            </button>
          )}
        </div>

        {/* WO table */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: C.page, color: C.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', width: 30 }}></th>
                <th style={{ padding: '8px 6px', textAlign: 'center', width: 60 }} title="Reorder placement sequence">Order</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>WO</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Work type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Location</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {orderedWorkOrders.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '14px 10px', color: C.textMuted, textAlign: 'center' }}>
                  No work orders in 'To Be Scheduled' on this project.
                </td></tr>
              )}
              {orderedWorkOrders.map((w, idx) => {
                const missing = w.duration_minutes == null || w.duration_minutes <= 0
                const checked = selectedIds.has(w.id)
                const isFirst = idx === 0
                const isLast  = idx === orderedWorkOrders.length - 1
                const arrowBtn = (label, onClick, disabled, title) => (
                  <button onClick={onClick} disabled={disabled} title={title}
                    style={{
                      background: 'transparent', border: 'none', padding: '0 2px',
                      cursor: disabled ? 'default' : 'pointer',
                      color: disabled ? '#cbd5e1' : C.textSecondary,
                      fontSize: 11, lineHeight: 1,
                    }}>{label}</button>
                )
                return (
                  <tr key={w.id} style={{ borderTop: `1px solid ${C.border}`,
                                          background: missing ? '#fffbeb' : 'transparent' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleOne(w.id)} disabled={missing} />
                    </td>
                    <td style={{ padding: '6px 4px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {arrowBtn('▲', () => moveUp(w.id), isFirst, 'Move up')}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textMuted,
                                     fontSize: 11, margin: '0 4px', minWidth: 16, display: 'inline-block' }}>
                        {idx + 1}
                      </span>
                      {arrowBtn('▼', () => moveDown(w.id), isLast, 'Move down')}
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'JetBrains Mono, monospace', color: C.textMuted }}>
                      {w.record_number}
                    </td>
                    <td style={{ padding: '8px 10px', color: C.textPrimary }}>{w.work_type_name}</td>
                    <td style={{ padding: '8px 10px', color: C.textSecondary }}>
                      {w.building_name}{w.unit_name ? ` / ${w.unit_name}` : ''}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right',
                                 color: missing ? '#b45309' : C.textPrimary, fontWeight: missing ? 600 : 400 }}>
                      {missing ? 'not set' : `${w.duration_minutes} min`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div style={{ marginTop: 12, padding: '10px 12px', background: C.page, borderRadius: 6,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
          <div style={{ color: C.textSecondary }}>
            <strong style={{ color: C.textPrimary }}>{selectedIds.size}</strong> selected
            {summary.missingCount > 0 && (
              <span style={{ color: '#b45309', marginLeft: 10 }}>
                ({summary.missingCount} missing duration)
              </span>
            )}
          </div>
          <div style={{ color: C.textSecondary }}>
            Total workload: <strong style={{ color: C.textPrimary }}>
              {summary.totalMinutes} min ({summary.totalHours.toFixed(1)} h)
            </strong>
          </div>
        </div>

        {step1Err && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef3c7', border: '1px solid #fcd34d',
                        borderRadius: 6, fontSize: 12.5, color: '#92400e' }}>
            {step1Err}
          </div>
        )}
      </>
    )
  }

  function renderStep2() {
    const step2Err = validateStep2()
    return (
      <>
        <StepIndicator />
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Team Lead</label>
          <select value={teamLeadId} onChange={e => setTeamLeadId(e.target.value)} style={inputStyle}>
            <option value="">— Pick a Team Lead —</option>
            {teamLeads.map(l => (
              <option key={l.id} value={l.id}>
                {l.full_name}{l.crew_label ? ` — ${l.crew_label}` : ''}
              </option>
            ))}
          </select>
          <div style={hintStyle}>
            All selected work orders will be assigned to this Team Lead. Add additional crew members
            on each Service Appointment after scheduling.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ background: C.page, borderRadius: 6, padding: '10px 12px', fontSize: 12, color: C.textSecondary, lineHeight: 1.55 }}>
          <strong style={{ color: C.textPrimary }}>Working hours:</strong> 7:00 AM – 3:30 PM,
          lunch 11:30 – 12:00. Buffer between work orders is set per work type (default 5 min).
          Work orders in the same unit pack back-to-back with no buffer. Weekends are skipped.
          Existing appointments and absences for the selected Team Lead are honored.
        </div>

        {step2Err && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef3c7', border: '1px solid #fcd34d',
                        borderRadius: 6, fontSize: 12.5, color: '#92400e' }}>
            {step2Err}
          </div>
        )}
        {previewError && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5',
                        borderRadius: 6, fontSize: 12.5, color: '#991b1b' }}>
            {previewError}
          </div>
        )}
      </>
    )
  }

  function renderStep3() {
    if (!preview) {
      return (
        <>
          <StepIndicator />
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            Computing placement…
          </div>
        </>
      )
    }
    const placedByDay = previewByDay.filter(g => g.day !== '(unplaced)')
    const unplaced = previewByDay.find(g => g.day === '(unplaced)')

    return (
      <>
        <StepIndicator />
        {/* Summary banner */}
        {previewSummary && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14,
          }}>
            <SummaryCard label="Total"    value={previewSummary.total} color={C.textPrimary} />
            <SummaryCard label="Placed"   value={previewSummary.placed} color="#15803d" />
            <SummaryCard label="Unplaced" value={previewSummary.unplaced} color={previewSummary.unplaced > 0 ? '#b45309' : C.textMuted} />
          </div>
        )}

        {/* Gantt */}
        {placedByDay.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', background: C.card, marginBottom: 12 }}>
            <GanttAxis />
            {placedByDay.map(group => (
              <GanttDay key={group.day} day={group.day} rows={group.rows} />
            ))}
            <GanttLegend rows={preview.filter(r => r.placed)} />
          </div>
        )}

        {/* Unplaced rows */}
        {unplaced && unplaced.rows.length > 0 && (
          <div style={{ border: '1px solid #fcd34d', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              background: '#fef3c7', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#92400e',
            }}>
              Won't fit in this window ({unplaced.rows.length})
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, background: C.card }}>
              <tbody>
                {unplaced.rows.map(r => (
                  <tr key={r.work_order_id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace',
                                 fontSize: 11.5, color: C.textMuted, width: 90 }}>{r.work_order_record_number}</td>
                    <td style={{ padding: '7px 12px', color: C.textPrimary }}>
                      {r.work_type_name}
                      <span style={{ color: C.textMuted, marginLeft: 6 }}>
                        ({r.building_name}{r.unit_name ? ` / ${r.unit_name}` : ''})
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', textAlign: 'right', color: '#b45309', fontSize: 11.5 }}>
                      {describePlacementError(r.placement_error)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {previewSummary?.unplaced > 0 && (
          <div style={{ padding: '10px 12px', background: '#fef3c7',
                        border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12.5,
                        color: '#92400e', lineHeight: 1.5 }}>
            Confirm to schedule the {previewSummary.placed} placeable work order{previewSummary.placed === 1 ? '' : 's'} and leave the rest unscheduled, or go back and extend the date range.
          </div>
        )}

        {commitError && (
          <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2',
                        border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12.5, color: '#991b1b' }}>
            {commitError}
          </div>
        )}
      </>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={card} onClick={e => e.stopPropagation()}>
          <div style={bodyStyle}>
            <div style={{ padding: '20px 0', color: C.textMuted, fontSize: 13, textAlign: 'center' }}>
              Loading work orders…
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={overlay} onClick={onClose}>
        <div style={card} onClick={e => e.stopPropagation()}>
          <div style={bodyStyle}>
            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5',
                          borderRadius: 6, fontSize: 13, color: '#991b1b' }}>
              {error}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const step1Err = validateStep1()
  const step2Err = validateStep2()

  return (
    <div style={overlay} onClick={committing ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 6,
              background: '#ecfdf5', border: '1px solid #a7f3d0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" size={17} color={C.emerald} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
                Schedule Work Orders
              </div>
              <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 1 }}>
                {project?.project_record_number} • {project?.project_name || 'Untitled Project'}
              </div>
            </div>
          </div>
          <button onClick={committing ? undefined : onClose} disabled={committing}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: 6, borderRadius: 4,
                     cursor: committing ? 'wait' : 'pointer', color: C.textMuted }}>
            <Icon path="M18 6 6 18M6 6l12 12" size={16} color="currentColor" />
          </button>
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          {step === 1 && (
            <>
              <div></div>
              <div style={{ display: 'flex', gap: 8 }}>
                {secondaryBtn('Cancel', onClose)}
                {primaryBtn('Next →', () => setStep(2), { disabled: !!step1Err })}
              </div>
            </>
          )}
          {step === 2 && (
            <>
              {secondaryBtn('← Back', () => setStep(1), { disabled: previewing })}
              <div style={{ display: 'flex', gap: 8 }}>
                {secondaryBtn('Cancel', onClose, { disabled: previewing })}
                {primaryBtn('Preview placement →', runPreview, {
                  disabled: !!step2Err || previewing,
                  busy: previewing, busyLabel: 'Computing…',
                })}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              {secondaryBtn('← Back', () => setStep(2), { disabled: committing })}
              <div style={{ display: 'flex', gap: 8 }}>
                {secondaryBtn('Cancel', onClose, { disabled: committing })}
                {primaryBtn(
                  previewSummary && previewSummary.placed > 0
                    ? `Confirm — schedule ${previewSummary.placed}`
                    : 'Nothing to schedule',
                  runCommit,
                  {
                    disabled: !previewSummary || previewSummary.placed === 0 || committing,
                    busy: committing, busyLabel: 'Scheduling…',
                  }
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Small stat card for the preview summary
function SummaryCard({ label, value, color }) {
  return (
    <div style={{ background: C.page, borderRadius: 6, padding: '10px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted,
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

// ── Gantt ────────────────────────────────────────────────────────────────────
// Workday: 7:00 AM – 3:30 PM. Lunch 11:30 – 12:00. The track width is
// proportional to the workday minute-range (510 minutes). Each WO is an
// absolute-positioned colored block; color is hashed by unit_name so the
// same apartment's WOs visibly group together. Hover for full details.

const DAY_START_MIN = 7 * 60          // 420
const DAY_END_MIN   = 15 * 60 + 30    // 930
const DAY_RANGE_MIN = DAY_END_MIN - DAY_START_MIN  // 510
const LUNCH_START_MIN = 11 * 60 + 30  // 690
const LUNCH_END_MIN   = 12 * 60       // 720

function minutesFromIso(iso) {
  if (!iso) return 0
  const [h, m] = iso.slice(11, 16).split(':').map(Number)
  return h * 60 + m
}

function unitColor(unitName) {
  if (!unitName) return '#cbd5e1'
  let hash = 0
  for (let i = 0; i < unitName.length; i++) hash = (hash * 31 + unitName.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 55%, 72%)`
}

const GANTT_LABEL_WIDTH = 110

function GanttAxis() {
  const hours = [7, 8, 9, 10, 11, 12, 13, 14, 15]
  const fmt = h => (h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`)
  return (
    <div style={{ display: 'flex', fontSize: 10, color: C.textMuted, borderBottom: `1px solid ${C.border}`, background: C.page }}>
      <div style={{ width: GANTT_LABEL_WIDTH, flexShrink: 0, borderRight: `1px solid ${C.border}`,
                    padding: '6px 10px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Day
      </div>
      <div style={{ flex: 1, position: 'relative', height: 24 }}>
        {hours.map(h => {
          const pct = (h * 60 - DAY_START_MIN) / DAY_RANGE_MIN * 100
          return (
            <div key={h} style={{
              position: 'absolute', top: 4, left: `${pct}%`,
              transform: 'translateX(-50%)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>{fmt(h)}</div>
          )
        })}
      </div>
    </div>
  )
}

function GanttDay({ day, rows }) {
  const d = new Date(day + 'T00:00:00')
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' })
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${C.border}`, fontSize: 11 }}>
      <div style={{ width: GANTT_LABEL_WIDTH, padding: '10px 10px', borderRight: `1px solid ${C.border}`,
                    background: C.page, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, color: C.textPrimary, fontSize: 12 }}>{weekday}</div>
        <div style={{ color: C.textMuted, fontSize: 10.5 }}>{date}</div>
      </div>
      <div style={{ flex: 1, position: 'relative', height: 40, background: '#fafbfd' }}>
        {/* Lunch block */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left:  `${(LUNCH_START_MIN - DAY_START_MIN) / DAY_RANGE_MIN * 100}%`,
          width: `${(LUNCH_END_MIN - LUNCH_START_MIN) / DAY_RANGE_MIN * 100}%`,
          background: 'repeating-linear-gradient(45deg, #e5e7eb 0, #e5e7eb 4px, #f3f4f6 4px, #f3f4f6 8px)',
        }} title="Lunch 11:30 – 12:00" />
        {/* Vertical hour gridlines */}
        {[8, 9, 10, 11, 12, 13, 14, 15].map(h => (
          <div key={h} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(h * 60 - DAY_START_MIN) / DAY_RANGE_MIN * 100}%`,
            width: 1, background: '#e4e9f2',
          }} />
        ))}
        {/* WO blocks */}
        {rows.map(r => {
          const startMin = minutesFromIso(r.scheduled_start_iso) - DAY_START_MIN
          const durMin = Number(r.duration_minutes) || 0
          const leftPct  = startMin / DAY_RANGE_MIN * 100
          const widthPct = durMin / DAY_RANGE_MIN * 100
          const showLabel = durMin >= 20
          return (
            <div key={r.work_order_id}
              title={`${r.work_order_record_number} — ${r.work_type_name}\n${r.building_name}${r.unit_name ? ' / ' + r.unit_name : ''}\n${timeKey(r.scheduled_start_iso)} – ${timeKey(r.scheduled_end_iso)} (${durMin} min)`}
              style={{
                position: 'absolute', top: 5, bottom: 5,
                left:  `${leftPct}%`,
                width: `max(3px, ${widthPct}%)`,
                background: unitColor(r.unit_name),
                border: '1px solid rgba(15, 23, 42, 0.25)',
                borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#1e293b', fontSize: 9.5, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                cursor: 'help', padding: showLabel ? '0 4px' : 0,
              }}>
              {showLabel && r.work_order_record_number}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GanttLegend({ rows }) {
  // One swatch per unique unit_name so Nicholas can quickly map a color
  // back to an apartment. Limit to first 12 to avoid a wall of swatches
  // on enormous projects.
  const seen = new Set()
  const units = []
  for (const r of rows) {
    const k = `${r.building_name}|${r.unit_name || ''}`
    if (seen.has(k)) continue
    seen.add(k)
    units.push({ key: k, building: r.building_name, unit: r.unit_name })
    if (units.length >= 12) break
  }
  if (units.length === 0) return null
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      padding: '8px 12px', borderTop: `1px solid ${C.border}`, background: C.page,
      fontSize: 10.5, color: C.textSecondary,
    }}>
      <span style={{ marginRight: 4, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Units:
      </span>
      {units.map(u => (
        <span key={u.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2,
            background: unitColor(u.unit), border: '1px solid rgba(15, 23, 42, 0.2)',
          }} />
          {u.building}{u.unit ? ` / ${u.unit}` : ''}
        </span>
      ))}
    </div>
  )
}
