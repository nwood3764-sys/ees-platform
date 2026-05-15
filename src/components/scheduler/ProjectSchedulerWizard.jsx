// ---------------------------------------------------------------------------
// ProjectSchedulerWizard — bulk-schedule unscheduled work orders on a project.
//
// 4-step modal:
//   1. Select WOs (default = all 'To Be Scheduled' WOs on the project)
//   2. Pick Team Lead + date range + working-hours overrides (optional)
//   3. Preview the placement plan (calls RPC with commit:false)
//   4. Confirm — calls RPC with commit:true, displays the result
//
// The engine is server-side (public.bulk_schedule_work_orders). This component
// is a UI shell: it loads data, sends RPC calls, displays results. The
// algorithm itself — greedy first-fit, working-hours model, conflict-carve —
// lives in plpgsql so the same logic governs preview AND commit.
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

  const [step, setStep] = useState(1)            // 1=select, 2=window, 3=preview, 4=result
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Step 1 data
  const [workOrders, setWorkOrders] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())

  // Step 2 data
  const [teamLeads, setTeamLeads] = useState([])
  const [teamLeadId, setTeamLeadId] = useState('')
  const defaultStart = useMemo(() => isoDateOnly(nextMonday()), [])
  const defaultEnd   = useMemo(() => isoDateOnly(addDays(nextMonday(), 4)), [])  // Mon–Fri
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate,   setEndDate]   = useState(defaultEnd)

  // Step 3 data (preview)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null)         // array of rows from RPC
  const [previewError, setPreviewError] = useState(null)

  // Step 4 data (commit result)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState(null)
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
  const selectedWorkOrders = useMemo(
    () => workOrders.filter(w => selectedIds.has(w.id)),
    [workOrders, selectedIds]
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

  // Group placement rows by day for the preview render
  const previewByDay = useMemo(() => {
    if (!preview) return []
    const groups = new Map()
    for (const r of preview) {
      const k = r.placed ? dayKey(r.scheduled_start_iso) : '(unplaced)'
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(r)
    }
    // sort placed rows in each day by start time
    const out = []
    for (const [k, rows] of groups) {
      const sorted = k === '(unplaced)'
        ? rows
        : [...rows].sort((a, b) => (a.scheduled_start_iso || '').localeCompare(b.scheduled_start_iso || ''))
      out.push({ day: k, rows: sorted })
    }
    // sort days chronologically, then put '(unplaced)' last
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
  }
  const toggleAll = () => {
    if (selectedIds.size === workOrders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(workOrders.map(w => w.id)))
  }
  const selectOnlyValid = () => {
    setSelectedIds(new Set(workOrders.filter(w => w.duration_minutes != null && w.duration_minutes > 0).map(w => w.id)))
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
        workOrderIds: [...selectedIds],
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
        workOrderIds: [...selectedIds],
        teamLeadContactId: teamLeadId,
        startDate, endDate,
        commit: true,
      })
      setCommitResult(rows)
      setStep(3)
      const placed = rows.filter(r => r.placed).length
      toast.success(`Scheduled ${placed} work order${placed === 1 ? '' : 's'}.`)
      onCommitted?.()
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
    const steps = ['Select WOs', 'Crew & window', 'Done']
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
            Pick which work orders to schedule. Default is all. Work orders without a duration
            cannot be placed automatically — set a duration on the work type or the work order
            itself before scheduling.
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
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>WO</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Work type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Location</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Duration</th>
              </tr>
            </thead>
            <tbody>
              {workOrders.length === 0 && (
                <tr><td colSpan={5} style={{ padding: '14px 10px', color: C.textMuted, textAlign: 'center' }}>
                  No work orders in 'To Be Scheduled' on this project.
                </td></tr>
              )}
              {workOrders.map(w => {
                const missing = w.duration_minutes == null || w.duration_minutes <= 0
                const checked = selectedIds.has(w.id)
                return (
                  <tr key={w.id} style={{ borderTop: `1px solid ${C.border}`,
                                          background: missing ? '#fffbeb' : 'transparent' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleOne(w.id)} disabled={missing} />
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
    return (
      <>
        <StepIndicator />
        {/* Summary banner */}
        {previewSummary && (
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16,
          }}>
            <SummaryCard label="Total"    value={previewSummary.total} color={C.textPrimary} />
            <SummaryCard label="Placed"   value={previewSummary.placed} color="#15803d" />
            <SummaryCard label="Unplaced" value={previewSummary.unplaced} color={previewSummary.unplaced > 0 ? '#b45309' : C.textMuted} />
          </div>
        )}

        {/* Placement table grouped by day */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
          {previewByDay.map(group => (
            <div key={group.day}>
              <div style={{
                background: group.day === '(unplaced)' ? '#fef3c7' : C.page,
                padding: '8px 12px', fontSize: 12, fontWeight: 600,
                color: group.day === '(unplaced)' ? '#92400e' : C.textSecondary,
                borderTop: `1px solid ${C.border}`,
              }}>
                {group.day === '(unplaced)' ? `Unplaced (${group.rows.length})` : prettyDay(group.day)}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {group.rows.map((r, i) => (
                    <tr key={r.work_order_id || i} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '7px 12px', fontFamily: 'JetBrains Mono, monospace',
                                   fontSize: 11.5, color: C.textMuted, width: 90 }}>
                        {r.work_order_record_number}
                      </td>
                      <td style={{ padding: '7px 12px', color: C.textPrimary }}>
                        {r.work_type_name}
                        <span style={{ color: C.textMuted, marginLeft: 6 }}>
                          ({r.building_name}{r.unit_name ? ` / ${r.unit_name}` : ''})
                        </span>
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: C.textSecondary, width: 130 }}>
                        {r.placed ? (
                          <>
                            <strong style={{ color: C.textPrimary }}>
                              {timeKey(r.scheduled_start_iso)}
                            </strong>
                            <span style={{ color: C.textMuted }}> – {timeKey(r.scheduled_end_iso)}</span>
                          </>
                        ) : (
                          <span style={{ color: '#b45309', fontSize: 12 }}>
                            {describePlacementError(r.placement_error)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {previewSummary?.unplaced > 0 && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#fef3c7',
                        border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12.5,
                        color: '#92400e', lineHeight: 1.5 }}>
            {previewSummary.unplaced} work order(s) won't fit. You can either confirm to schedule the
            placeable ones and leave the rest unscheduled, or go back and extend the date range.
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

  function renderStep4() {
    const placed = commitResult?.filter(r => r.placed).length || 0
    const unplaced = (commitResult?.length || 0) - placed
    return (
      <>
        <StepIndicator />
        <div style={{
          padding: 24, textAlign: 'center', background: '#ecfdf5', border: '1px solid #a7f3d0',
          borderRadius: 8, marginBottom: 16,
        }}>
          <div style={{ width: 48, height: 48, borderRadius: 999, background: '#15803d',
                        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon path="M5 13l4 4L19 7" size={24} color="white" />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#14532d', marginBottom: 4 }}>
            Scheduled {placed} work order{placed === 1 ? '' : 's'}
          </div>
          {unplaced > 0 && (
            <div style={{ fontSize: 12.5, color: '#92400e' }}>
              {unplaced} work order(s) remain unscheduled — extend the window and run the scheduler again.
            </div>
          )}
        </div>

        <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6 }}>
          Service Appointments and assignments have been created for the placed work orders. Their
          status is now <strong>Scheduled</strong>. Open the Service Appointments inbox in the Field
          module to review or dispatch them.
        </div>
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
          {step === 3 && renderStep4()}
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
              {secondaryBtn('← Back', () => setStep(1), { disabled: committing })}
              <div style={{ display: 'flex', gap: 8 }}>
                {secondaryBtn('Cancel', onClose, { disabled: committing })}
                {primaryBtn(
                  `Schedule ${selectedIds.size} work order${selectedIds.size === 1 ? '' : 's'}`,
                  runCommit,
                  { disabled: !!step2Err || committing, busy: committing, busyLabel: 'Scheduling…' }
                )}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <div></div>
              {primaryBtn('Close', onClose)}
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
