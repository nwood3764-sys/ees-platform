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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../UI'
import { useToast } from '../Toast'
import {
  fetchUnscheduledWorkOrdersForProject,
  fetchScheduledWorkOrdersForProject,
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

export default function ProjectSchedulerWizard({ projectId, project, onClose, onCommitted, mode = 'schedule' }) {
  const toast = useToast()
  const isReschedule = mode === 'reschedule'

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
  // Working-hours window for this scheduling run. Defaults match the
  // typical EES-WI multifamily field day: 7am start, 6pm hard stop.
  // Dispatcher can shorten or extend per run. The engine still carves
  // 11:30–12:00 for lunch and skips weekends regardless.
  const [dailyStartTime, setDailyStartTime] = useState('07:00')
  const [dailyEndTime,   setDailyEndTime]   = useState('18:00')
  // Travel buffer used between WOs that span two different properties.
  // The engine first checks the property_distances matrix for a stored
  // drive time; falls back to this value if the matrix has no row for
  // (origin → destination). Same-property cross-unit transitions still
  // use the work_type's post buffer.
  const [interPropertyBufferMinutes, setInterPropertyBufferMinutes] = useState(15)

  // Step 3 data (preview + commit)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState(null)         // array of rows from RPC
  const [previewError, setPreviewError] = useState(null)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState(null)
  // Gantt zoom multiplier. 1x = fits modal, 2x/4x/8x = horizontal scroll
  // for dense direct-install days where 2-min blocks pile up.
  const [ganttZoom, setGanttZoom] = useState(1)
  // Optional: blow the Gantt out to a fullscreen overlay for dispatcher review
  const [ganttFullscreen, setGanttFullscreen] = useState(false)
  // Drag-to-reorder state. dragWoId is the WO being dragged; dragOverWoId
  // is the target block under the pointer; dragOverPos is 'before' or
  // 'after' based on which half of the target block the pointer is in.
  // On pointer up we splice the dragged id into woOrder relative to the
  // target and re-run the preview RPC. This lets dispatchers say "do unit
  // B first" by dragging a unit-B block to the front of the Gantt.
  const [dragWoId, setDragWoId] = useState(null)
  const [dragOverWoId, setDragOverWoId] = useState(null)
  const [dragOverPos, setDragOverPos] = useState('before')
  // Pinned placements. Map of work_order_id -> ISO start_ts. The engine
  // accepts these as p_pinned_placements jsonb and locks each WO to its
  // exact time; non-pinned WOs flow around them. Used when the dispatcher
  // drops a drag on empty Gantt space (vs. dropping on another block,
  // which reorders). Click the anchor badge on a pinned block to unpin.
  const [pins, setPins] = useState({})
  // dragDropOnEmpty captures the target day + ISO time when the user
  // releases over empty space. Stays null otherwise.
  const dragDropEmptyRef = useRef(null)
  // When a drop would benefit from dispatcher confirmation (out-of-window
  // or displacing existing blocks), we stash the pending pin here and
  // surface a small modal. The dispatcher confirms or cancels.
  // Shape: { woId, iso, displayTime, reason, force, displacing: [rows] }
  const [pendingPin, setPendingPin] = useState(null)

  // ── Load initial data ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        let wos
        let leadHint = null
        let startDateHint = null
        if (isReschedule) {
          const res = await fetchScheduledWorkOrdersForProject(projectId)
          wos = res.workOrders
          leadHint = res.leadHint
          startDateHint = res.startDateHint
        } else {
          wos = await fetchUnscheduledWorkOrdersForProject(projectId)
        }
        if (cancelled) return
        setWorkOrders(wos)
        setWoOrder(wos.map(w => w.id))
        const defaultSelected = wos.filter(w => w.duration_minutes != null && w.duration_minutes > 0).map(w => w.id)
        setSelectedIds(new Set(defaultSelected))
        // In reschedule mode, seed the picker from the existing schedule
        let effectiveStart = startDate
        if (isReschedule && startDateHint) {
          setStartDate(startDateHint)
          // Default end = start + 4 days (Mon-Fri shape) if not previously edited
          const start = new Date(startDateHint + 'T00:00:00')
          setEndDate(isoDateOnly(addDays(start, 4)))
          effectiveStart = startDateHint
        }
        // Fetch leads with qualification for the default selection so the
        // dropdown can disable unqualified leads from the start. Falls back
        // to "all qualified" when the selection is empty.
        const leads = await fetchTeamLeads({ workOrderIds: defaultSelected, startDate: effectiveStart })
        if (cancelled) return
        setTeamLeads(leads)
        if (isReschedule && leadHint && leads.find(l => l.id === leadHint && l.qualified)) {
          setTeamLeadId(leadHint)
        } else {
          const onlyQualified = leads.filter(l => l.qualified)
          if (onlyQualified.length === 1) setTeamLeadId(onlyQualified[0].id)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId, isReschedule])

  // Re-query qualified leads when the WO selection or start date changes.
  // Debounced via a short timer so rapid clicks don't thrash the RPC.
  // Skips the first run (initial load already handled it).
  const skipNextLeadFetchRef = useRef(true)
  useEffect(() => {
    if (skipNextLeadFetchRef.current) {
      skipNextLeadFetchRef.current = false
      return
    }
    const handle = setTimeout(async () => {
      try {
        const ids = Array.from(selectedIds)
        const leads = await fetchTeamLeads({ workOrderIds: ids, startDate })
        setTeamLeads(leads)
        // If the currently-chosen lead lost qualification (e.g. user added
        // a WO requiring a cert they lack), clear the selection.
        if (teamLeadId) {
          const stillOk = leads.find(l => l.id === teamLeadId)
          if (stillOk && !stillOk.qualified) setTeamLeadId('')
        }
      } catch {
        // Non-fatal — keep the old list; commit will surface any error.
      }
    }, 200)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, startDate])

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

  const pinnedIdsSet = useMemo(() => new Set(Object.keys(pins)), [pins])

  // Map of WO id → metadata for hover-tooltip enrichment. The preview RPC
  // returns building/unit/work_type but not address; we keep the loader's
  // full record set indexed by id so the Gantt can surface property name
  // and full street address on hover.
  const woMetaById = useMemo(() => {
    const m = new Map()
    for (const w of workOrders) m.set(w.id, w)
    return m
  }, [workOrders])

  // Convert the dispatcher's HH:MM inputs to minute offsets for the Gantt
  // axis & block math. Falls back to module-level defaults on bad input.
  const dayStartMin = useMemo(
    () => timeStrToMin(dailyStartTime) ?? DAY_START_MIN,
    [dailyStartTime]
  )
  const dayEndMin = useMemo(
    () => timeStrToMin(dailyEndTime) ?? DAY_END_MIN,
    [dailyEndTime]
  )

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
    if (!dailyStartTime || !dailyEndTime) return 'Daily start and end times are required.'
    const sMin = timeStrToMin(dailyStartTime)
    const eMin = timeStrToMin(dailyEndTime)
    if (sMin == null || eMin == null) return 'Daily start and end times must be valid times.'
    if (sMin >= LUNCH_START_MIN) return 'Daily start must be before 11:30 AM lunch.'
    if (eMin <= LUNCH_END_MIN) return 'Daily end must be after 12:00 PM lunch.'
    if (sMin >= eMin) return 'Daily end must be after daily start.'
    return null
  }

  // Build the pin-array shape the engine expects from the pins map.
  // Drops invalid (no-such-WO) entries silently — engine would ignore them
  // anyway but we keep the payload clean.
  const pinsToArray = useCallback((pinsMap) => {
    const out = []
    for (const [woId, entry] of Object.entries(pinsMap || {})) {
      if (!entry) continue
      // Backward compat: older code stored entry as a raw ISO string;
      // newer code stores { iso, force }.
      if (typeof entry === 'string') {
        out.push({ work_order_id: woId, start_ts: entry })
      } else if (entry.iso) {
        const row = { work_order_id: woId, start_ts: entry.iso }
        if (entry.force) row.force = true
        out.push(row)
      }
    }
    return out
  }, [])

  // Resolve the selected Team Lead (by id) to the right scheduling params.
  // A lead row may be a Contact (subcontractor) or a User (internal crew);
  // bulkScheduleWorkOrders routes on source.
  const leadParams = useCallback(() => {
    const lead = teamLeads.find(l => l.id === teamLeadId)
    if (!lead) return { teamLeadContactId: teamLeadId, teamLeadSource: 'contact' }
    return {
      teamLeadSource:   lead.source || 'contact',
      teamLeadContactId: lead.source === 'user' ? null : (lead.contact_id ?? lead.id),
      teamLeadUserId:    lead.source === 'user' ? (lead.user_id ?? lead.id) : null,
    }
  }, [teamLeads, teamLeadId])

  const runPreview = async (overrideIds = null, overridePins = null) => {
    setPreviewing(true); setPreviewError(null)
    // Guard against accidental callers that pass a non-array (e.g. wiring
    // runPreview directly to onClick lets React pass the MouseEvent). Only
    // honor overrideIds when it's an actual array.
    const safeOverride = Array.isArray(overrideIds) ? overrideIds : null
    if (safeOverride === null) setPreview(null)
    const pinsForCall = overridePins != null ? overridePins : pins
    try {
      const rows = await bulkScheduleWorkOrders({
        projectId,
        workOrderIds: safeOverride || orderedSelectedIds,
        ...leadParams(),
        startDate, endDate,
        dailyStartTime, dailyEndTime,
        interPropertyBufferMinutes,
        pinnedPlacements: pinsToArray(pinsForCall),
        commit: false,
        mode,
      })
      setPreview(rows)
      if (step !== 3) setStep(3)
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
        ...leadParams(),
        startDate, endDate,
        dailyStartTime, dailyEndTime,
        interPropertyBufferMinutes,
        pinnedPlacements: pinsToArray(pins),
        commit: true,
        mode,
      })
      const placed = rows.filter(r => r.placed).length
      const unplaced = rows.filter(r => !r.placed).length
      onCommitted?.()
      const verb = isReschedule ? 'Rescheduled' : 'Scheduled'
      if (unplaced > 0) {
        toast.success(`${verb} ${placed} work order${placed === 1 ? '' : 's'}. ${unplaced} did not fit — extend the window and run again to place the rest.`)
      } else {
        toast.success(`${verb} ${placed} work order${placed === 1 ? '' : 's'}.`)
      }
      onClose()
    } catch (e) {
      setCommitError(e.message || 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }

  // ── Gantt drag-to-reorder ─────────────────────────────────────────────────
  // Ref captures so the document-level pointer handlers see latest values
  // without resubscribing on every state change.
  const dragWoRef = useRef(null)
  const dragOverRef = useRef({ id: null, pos: 'before' })
  useEffect(() => { dragWoRef.current = dragWoId }, [dragWoId])
  useEffect(() => { dragOverRef.current = { id: dragOverWoId, pos: dragOverPos } }, [dragOverWoId, dragOverPos])

  // Build an ISO string for a (day, minuteOfDay) pin coordinate, in
  // Chicago time. Snaps to 5-minute boundary. Used by both empty-space
  // and drop-on-block paths.
  const buildPinIso = useCallback((day, minuteOfDay) => {
    const dt = new Date(`${day}T00:00:00`)
    dt.setMinutes(dt.getMinutes() + minuteOfDay)
    const rounded = Math.round(dt.getMinutes() / 5) * 5
    dt.setMinutes(rounded, 0, 0)
    const pad = n => String(n).padStart(2, '0')
    const tzDate = new Date(`${day}T12:00:00Z`)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', timeZoneName: 'short',
    }).formatToParts(tzDate)
    const tzAbbr = parts.find(p => p.type === 'timeZoneName')?.value || 'CDT'
    const offset = tzAbbr === 'CST' ? '-06:00' : '-05:00'
    const iso = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
                `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00${offset}`
    const displayTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
    return { iso, displayTime, minute: dt.getHours() * 60 + dt.getMinutes() }
  }, [])

  // Apply a pin (with optional force flag) and re-run the preview. The
  // pendingPin modal calls this on confirm; direct paths call this when
  // no confirmation is needed.
  const applyPin = useCallback((woId, iso, force = false) => {
    const entry = force ? { iso, force: true } : { iso, force: false }
    const nextPins = { ...pins, [woId]: entry }
    setPins(nextPins)
    runPreview(orderedSelectedIds, nextPins)
  }, [pins, orderedSelectedIds])

  const commitDragDrop = useCallback(() => {
    const draggedId = dragWoRef.current
    const { id: overId } = dragOverRef.current
    const dropOnEmpty = dragDropEmptyRef.current
    if (!draggedId) return

    // Drop on another block → pin to THAT block's start time. The engine
    // reflows non-pinned siblings around the new pin. Surface a confirm
    // dialog showing the displaced WOs so the dispatcher knows what'll
    // happen.
    if (overId && overId !== draggedId) {
      const targetRow = preview && preview.find(r => r.work_order_id === overId)
      if (!targetRow || !targetRow.placed) return
      const day = dayKey(targetRow.scheduled_start_iso)
      const minuteOfDay = minutesFromIso(targetRow.scheduled_start_iso)
      const { iso, displayTime } = buildPinIso(day, minuteOfDay)
      // Which WOs will be displaced? Anything in the same day that
      // currently overlaps the new pin's [iso, iso+dur] window and is
      // not the dragged WO itself.
      const draggedMeta = woMetaById && woMetaById.get(draggedId)
      const newDur = draggedMeta?.duration_minutes || 0
      const newStartMin = minuteOfDay
      const newEndMin = minuteOfDay + newDur
      const displacing = (preview || []).filter(r =>
        r.placed && r.work_order_id !== draggedId
        && dayKey(r.scheduled_start_iso) === day
        && minutesFromIso(r.scheduled_end_iso) > newStartMin
        && minutesFromIso(r.scheduled_start_iso) < newEndMin
      ).map(r => ({
        record_number: r.work_order_record_number,
        work_type: r.work_type_name,
        location: `${r.building_name}${r.unit_name ? ' / ' + r.unit_name : ''}`,
        time: `${timeKey(r.scheduled_start_iso)}–${timeKey(r.scheduled_end_iso)}`,
      }))
      setPendingPin({
        woId: draggedId, iso, displayTime,
        reason: 'displaces',
        force: false,
        displacing,
      })
      return
    }

    // Drop on empty track space → pin to that time.
    if (dropOnEmpty) {
      const { day, minuteOfDay } = dropOnEmpty
      const { iso, displayTime, minute } = buildPinIso(day, minuteOfDay)
      // Out-of-window check: outside daily start/end OR inside lunch.
      const isOutsideWindow =
        minute < dayStartMin
        || minute >= dayEndMin
        || (minute >= LUNCH_START_MIN && minute < LUNCH_END_MIN)
      if (isOutsideWindow) {
        // Ask the dispatcher whether to force the pin.
        setPendingPin({
          woId: draggedId, iso, displayTime,
          reason: 'out_of_window',
          force: true,
          displacing: [],
        })
        return
      }
      // In-window drop → apply directly.
      applyPin(draggedId, iso, false)
    }
  }, [preview, woMetaById, dayStartMin, dayEndMin, buildPinIso, applyPin])

  // Confirm a pending pin from the modal.
  const confirmPendingPin = useCallback(() => {
    if (!pendingPin) return
    applyPin(pendingPin.woId, pendingPin.iso, pendingPin.force)
    setPendingPin(null)
  }, [pendingPin, applyPin])
  const cancelPendingPin = useCallback(() => setPendingPin(null), [])

  const unpin = useCallback((woId) => {
    setPins(prev => {
      if (!(woId in prev)) return prev
      const next = { ...prev }
      delete next[woId]
      runPreview(orderedSelectedIds, next)
      return next
    })
  }, [orderedSelectedIds])

  // Document-level pointer listeners are mounted only while a drag is in
  // progress. Pointer events handle both mouse and touch automatically.
  useEffect(() => {
    if (!dragWoId) return
    const onMove = (e) => {
      // First check if we're over another WO block — that means reorder.
      const target = document.elementFromPoint(e.clientX, e.clientY)
      const block = target && target.closest ? target.closest('[data-wo-id]') : null
      if (block) {
        const overId = block.dataset.woId
        if (overId === dragWoId) { setDragOverWoId(null); dragDropEmptyRef.current = null; return }
        const rect = block.getBoundingClientRect()
        const mid = rect.left + rect.width / 2
        setDragOverWoId(overId)
        setDragOverPos(e.clientX < mid ? 'before' : 'after')
        dragDropEmptyRef.current = null
        return
      }
      // No block under pointer — see if we're over a day track.
      const track = target && target.closest ? target.closest('[data-gantt-day]') : null
      if (track) {
        const rect = track.getBoundingClientRect()
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const minuteOfDay = dayStartMin + Math.round(pct * (dayEndMin - dayStartMin))
        // Capture the drop coordinate. commitDragDrop classifies the drop
        // (in-window vs out-of-window vs lunch) and either applies the
        // pin directly or opens a confirmation modal.
        dragDropEmptyRef.current = { day: track.dataset.ganttDay, minuteOfDay }
        setDragOverWoId(null)
        return
      }
      // Pointer is outside the Gantt entirely.
      setDragOverWoId(null)
      dragDropEmptyRef.current = null
    }
    const onUp = () => {
      commitDragDrop()
      setDragWoId(null)
      setDragOverWoId(null)
      dragDropEmptyRef.current = null
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
  }, [dragWoId, commitDragDrop, dayStartMin, dayEndMin])

  const onWoDragStart = useCallback((woId, e) => {
    e.preventDefault()
    e.stopPropagation()
    // Capture the pointer to the block itself (currentTarget) — NOT the
    // pointer's hit-test target which may be a child text/span node.
    // Capturing on the block keeps the pointermove/up stream tied to it
    // through React re-renders that follow setDragWoId.
    if (e.currentTarget && e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* noop */ }
    }
    setDragWoId(woId)
  }, [])

  // ── Styles (match ProjectReportModal idiom) ──────────────────────────────
  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1100, padding: 16,
  }
  // On the preview step the Gantt benefits from a wider card. Other steps
  // (selection table, form fields) read fine at 760.
  const card = {
    width: '100%',
    maxWidth: step === 3 ? 1200 : 760,
    maxHeight: 'calc(100vh - 32px)',
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
              {isReschedule ? 'Nothing to reschedule' : 'Nothing to schedule'}
            </div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55 }}>
              {isReschedule
                ? <>This project has no work orders in an active <strong>Scheduled</strong> appointment.
                  Use the <strong>Schedule Work Orders</strong> button to plan unscheduled work first.</>
                : <>This project has no work orders in status <strong>To Be Scheduled</strong>.
                  All work orders are either already scheduled or in another status.</>}
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
            {isReschedule
              ? `Currently scheduled work orders (${workOrders.length})`
              : `Unscheduled work orders (${workOrders.length})`}
          </div>
          <div style={hintStyle}>
            {isReschedule
              ? <>These work orders already have a scheduled appointment. Pick which to reschedule
                — committing will cancel the existing appointments and re-place them with the new
                Team Lead, dates, and order you choose below. Crew assignments are reset.</>
              : <>Pick which work orders to schedule and the sequence the crew will work them in.
                Use the ▲▼ arrows to reorder. The engine walks the list in order, packing same-unit
                work orders back-to-back. Default order matches what the property loader returns
                (typically grouped by building/unit).</>}
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
    const qualifiedLeads = teamLeads.filter(l => l.qualified)
    const unqualifiedLeads = teamLeads.filter(l => !l.qualified)
    return (
      <>
        <StepIndicator />
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Team Lead</label>
          <select value={teamLeadId} onChange={e => setTeamLeadId(e.target.value)} style={inputStyle}>
            <option value="">— Pick a Team Lead —</option>
            {qualifiedLeads.length > 0 && (
              <optgroup label="Qualified for selected work">
                {qualifiedLeads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.full_name}{l.crew_label ? ` — ${l.crew_label}` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {unqualifiedLeads.length > 0 && (
              <optgroup label="Missing required certifications">
                {unqualifiedLeads.map(l => (
                  <option key={l.id} value={l.id} disabled
                    title={`Missing: ${l.missing_certs}`}>
                    {l.full_name}{l.crew_label ? ` — ${l.crew_label}` : ''} — missing {l.missing_certs}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <div style={hintStyle}>
            Leads are filtered by certification coverage for the work types in your selection.
            Hover an unavailable lead to see what's missing — manage certs from the contact's record.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>End date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 18 }}>
          <div>
            <label style={labelStyle}>Daily start</label>
            <input type="time" value={dailyStartTime} onChange={e => setDailyStartTime(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Daily end</label>
            <input type="time" value={dailyEndTime} onChange={e => setDailyEndTime(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Travel buffer (min)</label>
            <input type="number" min={0} max={120} step={5}
                   value={interPropertyBufferMinutes}
                   onChange={e => setInterPropertyBufferMinutes(Math.max(0, Number(e.target.value) || 0))}
                   style={inputStyle} />
          </div>
        </div>

        <div style={{ background: C.page, borderRadius: 6, padding: '10px 12px', fontSize: 12, color: C.textSecondary, lineHeight: 1.55 }}>
          <strong style={{ color: C.textPrimary }}>Working hours:</strong> {dailyStartTime} – {dailyEndTime},
          lunch 11:30 – 12:00. Buffer between work orders is set per work type (default 5 min).
          Cross-property transitions add {interPropertyBufferMinutes} min unless a property-to-property
          drive time is set in the distance matrix.
          Work orders in the same unit pack back-to-back with no buffer.
          Weekends are skipped. Existing appointments and absences for the selected Team Lead are honored.
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
        {placedByDay.length > 0 && (() => {
          // Width math: at 1x the Gantt fills the modal body. The track
          // (right of the day label column) is whatever fits. Zooming
          // multiplies the track's CSS width and enables horizontal scroll;
          // % positions inside each row continue to resolve against the
          // wider track, so 2-min blocks become visibly fat at 4x/8x.
          const trackWidth = `${100 * ganttZoom}%`
          return (
            <div style={{ marginBottom: 12 }}>
              {/* Zoom toolbar */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 8, fontSize: 11.5, color: C.textMuted,
              }}>
                <span>
                  Drag any block to pin it. Drop onto another block to pin at that block's time (existing work orders move). Drop on empty time to pin to that time. Click the 📌 to unpin.
                  {pinnedIdsSet.size > 0 && (
                    <span style={{ color: '#2563eb', fontWeight: 600, marginLeft: 8 }}>
                      {pinnedIdsSet.size} pinned
                    </span>
                  )}
                  {previewing && (
                    <span style={{ color: C.emerald, fontWeight: 600, marginLeft: 8 }}>Refreshing…</span>
                  )}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted,
                                 textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 2 }}>
                    Zoom
                  </span>
                  {[1, 2, 4, 8].map(z => (
                    <button key={z} onClick={() => setGanttZoom(z)}
                      style={{
                        padding: '3px 8px', fontSize: 11.5, fontWeight: 600,
                        border: `1px solid ${ganttZoom === z ? C.emerald : C.border}`,
                        background: ganttZoom === z ? '#ecfdf5' : C.card,
                        color: ganttZoom === z ? C.emerald : C.textSecondary,
                        borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>{z}×</button>
                  ))}
                  <button onClick={() => setGanttFullscreen(true)}
                    title="Expand to full screen"
                    style={{
                      marginLeft: 4, padding: '3px 8px', fontSize: 11.5, fontWeight: 600,
                      border: `1px solid ${C.border}`, background: C.card,
                      color: C.textSecondary, borderRadius: 4, cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                    <Icon path="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6" size={11} color="currentColor" />
                    Expand
                  </button>
                </div>
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', background: C.card }}>
                {/* Horizontal scroll container — only the inner track scrolls,
                    not the day-label column. */}
                <GanttScroll trackWidth={trackWidth}>
                  <GanttAxis dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
                  {placedByDay.map(group => (
                    <GanttDay key={group.day} day={group.day} rows={group.rows} zoom={ganttZoom}
                      dayStartMin={dayStartMin} dayEndMin={dayEndMin}
                      dragWoId={dragWoId} dragOverWoId={dragOverWoId} dragOverPos={dragOverPos}
                      onWoDragStart={onWoDragStart}
                      pinnedIds={pinnedIdsSet} onUnpin={unpin}
                      woMetaById={woMetaById} />
                  ))}
                </GanttScroll>
                <GanttLegend rows={preview.filter(r => r.placed)} />
              </div>
            </div>
          )
        })()}

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
                {isReschedule ? 'Reschedule Work Orders' : 'Schedule Work Orders'}
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
                {primaryBtn('Preview placement →', () => runPreview(), {
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
                    ? (isReschedule
                        ? `Confirm — reschedule ${previewSummary.placed}`
                        : `Confirm — schedule ${previewSummary.placed}`)
                    : (isReschedule ? 'Nothing to reschedule' : 'Nothing to schedule'),
                  runCommit,
                  {
                    disabled: !previewSummary || previewSummary.placed === 0 || committing,
                    busy: committing, busyLabel: isReschedule ? 'Rescheduling…' : 'Scheduling…',
                  }
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fullscreen Gantt overlay — same data, more screen real estate.
          Renders on top of the wizard at a higher z-index. */}
      {ganttFullscreen && preview && (
        <GanttFullscreenView
          previewSummary={previewSummary}
          previewByDay={previewByDay}
          allPlaced={preview.filter(r => r.placed)}
          dragWoId={dragWoId}
          dragOverWoId={dragOverWoId}
          dragOverPos={dragOverPos}
          onWoDragStart={onWoDragStart}
          pinnedIds={pinnedIdsSet}
          onUnpin={unpin}
          dayStartMin={dayStartMin}
          dayEndMin={dayEndMin}
          woMetaById={woMetaById}
          onClose={() => setGanttFullscreen(false)}
        />
      )}

      {/* Pin confirmation modal — appears when a drop lands outside the
          working window or displaces other scheduled blocks. Higher
          z-index than the fullscreen overlay so it sits on top. */}
      {pendingPin && (
        <PinConfirmModal
          pendingPin={pendingPin}
          woMetaById={woMetaById}
          onConfirm={confirmPendingPin}
          onCancel={cancelPendingPin}
        />
      )}
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

// ── Pin confirmation modal ──────────────────────────────────────────────────
// Surfaces when a drag-drop pin needs dispatcher confirmation. Two reasons:
//   1. 'out_of_window' — drop time is before daily start, after daily end,
//      or during lunch. The dispatcher can override (force=true on engine).
//   2. 'displaces' — drop time on the Gantt overlaps one or more existing
//      placed WOs. The engine will reflow them around the new pin; this
//      modal shows which ones will move.
function PinConfirmModal({ pendingPin, woMetaById, onConfirm, onCancel }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  const meta = woMetaById && woMetaById.get(pendingPin.woId)
  const woLabel = meta
    ? `${meta.record_number} — ${meta.work_type_name} (${meta.building_name}${meta.unit_name ? ' / ' + meta.unit_name : ''})`
    : pendingPin.woId
  const headerTone = pendingPin.reason === 'out_of_window' ? '#1d4ed8' : C.textPrimary
  const headerText = pendingPin.reason === 'out_of_window'
    ? 'Pin outside working hours?'
    : (pendingPin.displacing.length > 0
        ? `Pin will displace ${pendingPin.displacing.length} work order${pendingPin.displacing.length === 1 ? '' : 's'}`
        : 'Confirm pin')
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1300, padding: 16,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: headerTone, marginBottom: 4 }}>
            {headerText}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Pinning to <strong style={{ color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>{pendingPin.displayTime}</strong>
          </div>
        </div>
        <div style={{ padding: '14px 20px', fontSize: 12.5, color: C.textSecondary, lineHeight: 1.55 }}>
          <div style={{ marginBottom: 12 }}>
            <strong style={{ color: C.textPrimary }}>Work order:</strong> {woLabel}
          </div>
          {pendingPin.reason === 'out_of_window' && (
            <div style={{
              background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6,
              padding: '10px 12px', color: '#1e3a8a',
            }}>
              This time falls outside the configured working hours or during the
              lunch period. The dispatcher is overriding the schedule — pinning
              will succeed but the engine will not auto-place other work orders
              in this off-hours window.
            </div>
          )}
          {pendingPin.reason === 'displaces' && pendingPin.displacing.length > 0 && (
            <div>
              <div style={{ marginBottom: 6, color: C.textPrimary, fontWeight: 600 }}>
                Existing work orders that overlap this time:
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                {pendingPin.displacing.map((d, i) => (
                  <div key={d.record_number} style={{
                    padding: '8px 10px', fontSize: 12,
                    borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                    display: 'flex', justifyContent: 'space-between', gap: 10,
                  }}>
                    <div>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textMuted }}>
                        {d.record_number}
                      </span>
                      <span style={{ color: C.textPrimary, marginLeft: 6 }}>{d.work_type}</span>
                      <span style={{ color: C.textMuted, marginLeft: 6 }}>({d.location})</span>
                    </div>
                    <div style={{ color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace' }}>
                      {d.time}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, color: C.textSecondary }}>
                These will be moved to the next available time slots. If any do not
                fit in the remaining window they will be returned as unplaced —
                pin them manually or extend the date range.
              </div>
            </div>
          )}
        </div>
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${C.border}`, background: C.page,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <button onClick={onCancel}
            style={{ background: C.card, color: C.textSecondary, border: `1px solid ${C.border}`,
                     borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ background: C.emerald, color: 'white', border: `1px solid ${C.emerald}`,
                     borderRadius: 6, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            {pendingPin.reason === 'out_of_window' ? 'Pin anyway' : 'Pin and displace'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Fullscreen Gantt — viewport-filling overlay, separate zoom state, Esc to
// close. Used when the dispatcher needs to read packed direct-install days
// in detail. Same blocks, way more screen.
function GanttFullscreenView({
  previewSummary, previewByDay, allPlaced, onClose,
  dragWoId, dragOverWoId, dragOverPos, onWoDragStart,
  pinnedIds, onUnpin,
  dayStartMin, dayEndMin,
  woMetaById,
}) {
  const [zoom, setZoom] = useState(2)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const placedByDay = previewByDay.filter(g => g.day !== '(unplaced)')
  const trackWidth = `${100 * zoom}%`
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)',
      zIndex: 1200, display: 'flex', flexDirection: 'column', padding: 24,
    }} onClick={onClose}>
      <div style={{
        flex: 1, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, background: C.page,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>
              Scheduled placement — fullscreen preview
            </div>
            <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
              {previewSummary?.placed || 0} placed
              {previewSummary?.unplaced > 0 ? `, ${previewSummary.unplaced} unplaced` : ''}
              {' · '}Esc to close
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: C.textMuted,
                           textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
              Zoom
            </span>
            {[1, 2, 4, 8, 16].map(z => (
              <button key={z} onClick={() => setZoom(z)}
                style={{
                  padding: '4px 10px', fontSize: 12, fontWeight: 600,
                  border: `1px solid ${zoom === z ? C.emerald : C.border}`,
                  background: zoom === z ? '#ecfdf5' : C.card,
                  color: zoom === z ? C.emerald : C.textSecondary,
                  borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>{z}×</button>
            ))}
            <button onClick={onClose} aria-label="Close"
              style={{ marginLeft: 8, background: 'transparent', border: 'none', padding: 6, borderRadius: 4,
                       cursor: 'pointer', color: C.textMuted }}>
              <Icon path="M18 6 6 18M6 6l12 12" size={18} color="currentColor" />
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', background: C.card }}>
            <GanttScroll trackWidth={trackWidth}>
              <GanttAxis dayStartMin={dayStartMin} dayEndMin={dayEndMin} />
              {placedByDay.map(group => (
                <GanttDay key={group.day} day={group.day} rows={group.rows} zoom={zoom}
                  dayStartMin={dayStartMin} dayEndMin={dayEndMin}
                  dragWoId={dragWoId} dragOverWoId={dragOverWoId} dragOverPos={dragOverPos}
                  onWoDragStart={onWoDragStart}
                  pinnedIds={pinnedIds} onUnpin={onUnpin}
                  woMetaById={woMetaById} />
              ))}
            </GanttScroll>
            <GanttLegend rows={allPlaced} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Gantt ────────────────────────────────────────────────────────────────────
// Workday: 7:00 AM – 3:30 PM. Lunch 11:30 – 12:00. The track width is
// proportional to the workday minute-range (510 minutes). Each WO is an
// absolute-positioned colored block; color is hashed by unit_name so the
// same apartment's WOs visibly group together. Hover for full details.

// Module-level fallback constants; the actual visible window is driven by
// the wizard's dailyStartTime/dailyEndTime state and passed in as props.
const DAY_START_MIN = 7 * 60          // 420
const DAY_END_MIN   = 15 * 60 + 30    // 930
const DAY_RANGE_MIN = DAY_END_MIN - DAY_START_MIN  // 510
const LUNCH_START_MIN = 11 * 60 + 30  // 690
const LUNCH_END_MIN   = 12 * 60       // 720

function timeStrToMin(s) {
  if (!s || typeof s !== 'string') return null
  const [h, m] = s.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

// Build hour-tick array for the axis between two minute offsets (inclusive).
function hourTicks(startMin, endMin) {
  const ticks = []
  const startH = Math.ceil(startMin / 60)
  const endH   = Math.floor(endMin / 60)
  for (let h = startH; h <= endH; h++) ticks.push(h)
  return ticks
}

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

// Horizontal scroll wrapper that lets the inner Gantt track grow wider
// than the modal while keeping the day-label column fixed-width. The
// trackWidth prop is a CSS value like '200%' to drive the zoom.
function GanttScroll({ trackWidth, children }) {
  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', position: 'relative' }}>
      <div style={{
        width: `calc(${GANTT_LABEL_WIDTH}px + (100% - ${GANTT_LABEL_WIDTH}px) * ${parseFloat(trackWidth) / 100})`,
        minWidth: '100%',
      }}>
        {children}
      </div>
    </div>
  )
}

function GanttAxis({ dayStartMin = DAY_START_MIN, dayEndMin = DAY_END_MIN }) {
  const range = dayEndMin - dayStartMin
  const hours = hourTicks(dayStartMin, dayEndMin)
  const fmt = h => (h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`)
  return (
    <div style={{ display: 'flex', fontSize: 10, color: C.textMuted, borderBottom: `1px solid ${C.border}`, background: C.page }}>
      <div style={{ width: GANTT_LABEL_WIDTH, flexShrink: 0, borderRight: `1px solid ${C.border}`,
                    padding: '6px 10px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                    position: 'sticky', left: 0, zIndex: 2, background: C.page }}>
        Day
      </div>
      <div style={{ flex: 1, position: 'relative', height: 24 }}>
        {hours.map(h => {
          const pct = (h * 60 - dayStartMin) / range * 100
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

function GanttDay({
  day, rows, zoom = 1,
  dragWoId = null, dragOverWoId = null, dragOverPos = 'before', onWoDragStart,
  pinnedIds = null, onUnpin,
  dayStartMin = DAY_START_MIN, dayEndMin = DAY_END_MIN,
  woMetaById = null,
}) {
  const dayRange = dayEndMin - dayStartMin
  const d = new Date(day + 'T00:00:00')
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' })
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  // Higher zoom → labels appear on shorter blocks. At 1x a 2-min block is
  // ~0.4% of the track and labels are pointless; at 4x same block is ~1.6%
  // and at 8x ~3.2%, plenty of room for the record number.
  const labelThresholdMin = zoom >= 4 ? 2 : zoom >= 2 ? 8 : 20
  // Min absolute block width so 2-min direct-installs are at least clickable
  // at low zoom levels.
  const minBlockPx = zoom >= 4 ? 18 : zoom >= 2 ? 10 : 6
  const hourLines = hourTicks(dayStartMin, dayEndMin).filter(h => h * 60 > dayStartMin && h * 60 < dayEndMin)
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${C.border}`, fontSize: 11 }}>
      <div style={{ width: GANTT_LABEL_WIDTH, padding: '10px 10px', borderRight: `1px solid ${C.border}`,
                    background: C.page, flexShrink: 0, position: 'sticky', left: 0, zIndex: 2 }}>
        <div style={{ fontWeight: 600, color: C.textPrimary, fontSize: 12 }}>{weekday}</div>
        <div style={{ color: C.textMuted, fontSize: 10.5 }}>{date}</div>
      </div>
      <div data-gantt-day={day}
           style={{ flex: 1, position: 'relative', height: 40, background: '#fafbfd' }}>
        {/* Lunch block */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left:  `${(LUNCH_START_MIN - dayStartMin) / dayRange * 100}%`,
          width: `${(LUNCH_END_MIN - LUNCH_START_MIN) / dayRange * 100}%`,
          background: 'repeating-linear-gradient(45deg, #e5e7eb 0, #e5e7eb 4px, #f3f4f6 4px, #f3f4f6 8px)',
          pointerEvents: 'none',
        }} title="Lunch 11:30 – 12:00" />
        {/* Vertical hour gridlines */}
        {hourLines.map(h => (
          <div key={h} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(h * 60 - dayStartMin) / dayRange * 100}%`,
            width: 1, background: '#e4e9f2', pointerEvents: 'none',
          }} />
        ))}
        {/* WO blocks */}
        {rows.map(r => {
          const startMin = minutesFromIso(r.scheduled_start_iso) - dayStartMin
          const durMin = Number(r.duration_minutes) || 0
          const leftPct  = startMin / dayRange * 100
          const widthPct = durMin / dayRange * 100
          const showLabel = durMin >= labelThresholdMin
          const isBeingDragged = dragWoId === r.work_order_id
          const isDropTarget = dragOverWoId === r.work_order_id
          const isPinned = pinnedIds && pinnedIds.has(r.work_order_id)
          // Build a multi-line tooltip with everything the dispatcher
          // needs to identify a block at a glance: WO#, work type, full
          // property name, street address, building/unit, time window.
          const meta = woMetaById && woMetaById.get(r.work_order_id)
          const tooltipLines = [
            `${r.work_order_record_number} — ${r.work_type_name}`,
            meta?.property_name || '',
            meta?.address || '',
            `${r.building_name}${r.unit_name ? ' / Unit ' + r.unit_name : ''}`,
            `${timeKey(r.scheduled_start_iso)} – ${timeKey(r.scheduled_end_iso)}  (${durMin} min)`,
            isPinned ? '📌 Pinned to this time — click pin badge to unpin' : '',
            '',
            'Drag to an empty time slot to pin. Drag onto another block to pin at its time.',
          ].filter(Boolean)
          return (
            <div key={r.work_order_id}
              data-wo-id={r.work_order_id}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={onWoDragStart ? (e) => onWoDragStart(r.work_order_id, e) : undefined}
              title={tooltipLines.join('\n')}
              style={{
                position: 'absolute', top: 5, bottom: 5,
                left:  `${leftPct}%`,
                width: `max(${minBlockPx}px, ${widthPct}%)`,
                background: unitColor(r.unit_name),
                border: isDropTarget
                  ? '2px solid #15803d'
                  : isPinned
                    ? '2px solid #2563eb'
                    : '1px solid rgba(15, 23, 42, 0.25)',
                borderRadius: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#1e293b', fontSize: 9.5, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                cursor: onWoDragStart ? (isBeingDragged ? 'grabbing' : 'grab') : 'help',
                padding: showLabel ? '0 4px' : 0,
                opacity: isBeingDragged ? 0.35 : 1,
                touchAction: 'none', userSelect: 'none',
                // Chrome / Safari respect -webkit-user-drag separately from the
                // HTML draggable attribute. Without 'none' here, the browser
                // can still initiate a native drag operation on mousedown,
                // which fires the 'no-drop' red X cursor and prevents our
                // pointer event stream from firing. Setting it explicitly
                // disables native drag-image generation at the CSS layer.
                WebkitUserDrag: 'none',
                KhtmlUserDrag: 'none',
                MozUserSelect: 'none',
                boxShadow: isDropTarget
                  ? '0 0 0 2px rgba(21, 128, 61, 0.25)'
                  : isPinned ? '0 0 0 1px rgba(37, 99, 235, 0.25)' : 'none',
                zIndex: isBeingDragged ? 3 : 1,
              }}>
              {/* Insertion bar — left edge for 'before', right edge for 'after' */}
              {isDropTarget && (
                <div style={{
                  position: 'absolute', top: -3, bottom: -3,
                  width: 3, background: '#15803d',
                  left: dragOverPos === 'before' ? -2 : undefined,
                  right: dragOverPos === 'after' ? -2 : undefined,
                  borderRadius: 2,
                  pointerEvents: 'none',
                }} />
              )}
              {/* Pin indicator + unpin click target. Sits inside the
                  block (positive top/right) so it doesn't intercept
                  drags that start near the top-right corner. */}
              {isPinned && (
                <span
                  onPointerDown={(e) => { e.stopPropagation() }}
                  onClick={(e) => { e.stopPropagation(); onUnpin && onUnpin(r.work_order_id) }}
                  title="Pinned — click to unpin"
                  style={{
                    position: 'absolute', top: 1, right: 1,
                    width: 12, height: 12, borderRadius: 6,
                    background: '#2563eb', color: 'white',
                    fontSize: 8, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', border: '1px solid white',
                    zIndex: 4,
                  }}>📌</span>
              )}
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
