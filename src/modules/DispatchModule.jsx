// DispatchModule.jsx — Salesforce Field Service-style Dispatch Console.
//
// Left rail (collapsible)  : Resource filter rail — search by name, multi-
//   select by crew / service territory / certifications held; "Available
//   only" toggle hides leads who are out the entire visible window.
//
// Center                   : Multi-tech swimlane week view. Header row = day
//   columns (configurable range, default Mon-Fri of the current week). One
//   row per active Team Lead matching the rail filters. Each (lane × day)
//   cell is a relative-positioned timeline (working hours 7am→6pm) where
//   SAs render as absolutely-positioned colored blocks sized to their
//   duration. Resource absences render as grey OOO bars.
//
// Right rail (collapsible) : Unscheduled WO palette — every Work Order in
//   'To Be Scheduled' status, filterable by service territory + work type.
//   Each row is HTML5-draggable onto a (lane × day) cell to commit a
//   schedule via bulk_schedule_work_orders with a one-element WO array +
//   pinned placement (same engine the wizard uses).
//
// SAs in the grid are also draggable — drop on a different lane to
// reassign, drop on a different position to reschedule. Both paths call
// dispatch_reschedule_service_appointment with the new start + lead. The
// vertical drop position is mapped to a 15-minute-snapped local time.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from '../components/UI'
import { useToast } from '../components/Toast'
import {
  fetchScheduledServiceAppointmentsInRange,
  fetchResourceAbsencesInRange,
  fetchActiveTeamLeads,
  fetchServiceTerritories,
  fetchActiveCertifications,
  fetchUnscheduledWorkOrdersForDispatch,
  dispatchAssignWorkOrder,
} from '../data/dispatchBoard'
import { dispatchRescheduleServiceAppointment } from '../data/projectScheduler'
import DispatchFilterRail, { laneInScope } from '../components/dispatch/DispatchFilterRail'
import DispatchUnscheduledPalette from '../components/dispatch/DispatchUnscheduledPalette'
import ResourceMatrix from '../components/dispatch/ResourceMatrix'
import FollowupsQueue from '../components/dispatch/FollowupsQueue'

// Working-hours window the board renders. Matches the scheduler default;
// any SA whose times bleed outside this gets clipped at the edge with a
// visible hatched cap.
const DAY_START_HOUR = 7    // 07:00
const DAY_END_HOUR   = 18   // 18:00
const PIXELS_PER_HOUR = 44  // ~11 hours × 44 = 484px tall per cell

// Color palette for SA blocks, keyed by work_type_id. Picks a stable
// hash-based color from this set. All blues / teals / greens / purples
// per the platform convention — no reds or yellows.
const SA_COLORS = [
  { bg: '#dbeafe', border: '#2563eb', text: '#1e40af' },   // blue
  { bg: '#d1fae5', border: '#059669', text: '#065f46' },   // emerald
  { bg: '#ccfbf1', border: '#0d9488', text: '#115e59' },   // teal
  { bg: '#e0e7ff', border: '#4338ca', text: '#3730a3' },   // indigo
  { bg: '#ede9fe', border: '#7c3aed', text: '#5b21b6' },   // violet
  { bg: '#cffafe', border: '#0891b2', text: '#155e75' },   // cyan
  { bg: '#fae8ff', border: '#a21caf', text: '#86198f' },   // fuchsia (purple-pink)
  { bg: '#e0f2fe', border: '#0284c7', text: '#075985' },   // sky
]

function hashString(s) {
  let h = 0
  if (!s) return 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return Math.abs(h)
}
function colorForWorkType(id) {
  return SA_COLORS[hashString(String(id || '')) % SA_COLORS.length]
}

// ─── Date utilities ─────────────────────────────────────────────────────
function startOfWeekMonday(d) {
  const x = new Date(d); x.setHours(0,0,0,0)
  // JS Sunday=0..Saturday=6. We want Monday=1 as the week anchor.
  const dow = x.getDay()
  const delta = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + delta)
  return x
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function toYMD(d) {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
function fromYMD(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function fmtDayHeader(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtClock(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Maps a Date (or ISO) to pixel offset within the day's timeline.
function pxFromTime(date) {
  const t = new Date(date)
  const hours = t.getHours() + t.getMinutes() / 60 + t.getSeconds() / 3600
  const offset = (hours - DAY_START_HOUR) * PIXELS_PER_HOUR
  return offset
}

export default function DispatchModule({ onNavigateToRecord }) {
  const toast = useToast()

  // View toggle — 'console' is the swimlane scheduler (default); 'resources'
  // is the field-staff skills/certifications matrix. Shares the same module
  // shell + toolbar to keep navigation tight.
  const [activeView, setActiveView] = useState('console')

  // Date range. Default: this week Mon-Fri (5 days).
  const [startDate, setStartDate] = useState(() => toYMD(startOfWeekMonday(new Date())))
  const [endDate,   setEndDate]   = useState(() => toYMD(addDays(startOfWeekMonday(new Date()), 4)))

  const [leads, setLeads] = useState([])
  const [appointments, setAppointments] = useState([])
  const [absences, setAbsences] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Reference data for filter rail + palette. Loaded once on mount; the
  // palette WO list re-loads on every refresh because new WOs can be
  // created at any time.
  const [territories,    setTerritories]    = useState([])
  const [certifications, setCertifications] = useState([])
  const [unscheduledWOs, setUnscheduledWOs] = useState([])
  const [paletteLoading, setPaletteLoading] = useState(true)

  // Filter rail state
  const [filterSearch,        setFilterSearch]        = useState('')
  const [filterCrews,         setFilterCrews]         = useState([])
  const [filterTerritoryIds,  setFilterTerritoryIds]  = useState([])
  const [filterCertIds,       setFilterCertIds]       = useState([])
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false)

  // Collapse toggles for the two rails
  const [filterRailCollapsed, setFilterRailCollapsed] = useState(false)
  const [paletteCollapsed,    setPaletteCollapsed]    = useState(false)

  // Drag tracking — the current dragged item, drives the hovered drop zone
  // highlight. dragPayload is the parsed JSON; dragHoverKey is `${laneId}::${ymd}`.
  const [dragPayload,   setDragPayload]   = useState(null)
  const [dragHoverKey,  setDragHoverKey]  = useState(null)
  // Set true while a drop's RPC is in flight, to prevent double-commits.
  const [dropBusy, setDropBusy] = useState(false)

  // Load whenever range or refresh changes
  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true); setError(null)
      try {
        const [leadsRows, saRows, absRows] = await Promise.all([
          fetchActiveTeamLeads(),
          fetchScheduledServiceAppointmentsInRange({ startDate, endDate }),
          fetchResourceAbsencesInRange({ startDate, endDate }),
        ])
        if (cancelled) return
        setLeads(leadsRows)
        setAppointments(saRows)
        setAbsences(absRows)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load dispatch board')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [startDate, endDate, refreshNonce])

  // Reference data + palette WO list — refreshes alongside the board
  useEffect(() => {
    let cancelled = false
    async function run() {
      setPaletteLoading(true)
      try {
        const [terr, certs, wos] = await Promise.all([
          fetchServiceTerritories(),
          fetchActiveCertifications(),
          fetchUnscheduledWorkOrdersForDispatch(),
        ])
        if (cancelled) return
        setTerritories(terr)
        setCertifications(certs)
        setUnscheduledWOs(wos)
      } catch (e) {
        // Reference data failure shouldn't kill the whole board — log + toast
        if (!cancelled) toast.warning('Some dispatcher data failed to load: ' + (e.message || 'unknown'))
      } finally {
        if (!cancelled) setPaletteLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshNonce])

  // territoryNamesById — quick lookup the palette needs to render territory
  // names without re-joining
  const territoryNamesById = useMemo(() => {
    const m = new Map()
    for (const t of territories) m.set(t.id, t.name)
    return m
  }, [territories])

  // Distinct crew labels parsed from Team Lead titles
  const crewOptions = useMemo(() => {
    const labels = new Set()
    for (const l of leads) if (l.crew_label) labels.add(l.crew_label)
    return Array.from(labels).sort().map(label => ({ id: label, name: label }))
  }, [leads])

  // Compute the day columns from the range
  const days = useMemo(() => {
    const start = fromYMD(startDate)
    const end   = fromYMD(endDate)
    const out = []
    let d = new Date(start)
    while (d <= end) {
      out.push(new Date(d))
      d = addDays(d, 1)
    }
    return out
  }, [startDate, endDate])

  // Bucket SAs by (lead_id, day_ymd) for O(1) lookup inside the grid loop
  const appointmentsByLaneDay = useMemo(() => {
    const map = new Map()
    appointments.forEach(sa => {
      const leadId = sa.team_lead?.id || '__unassigned__'
      const d = new Date(sa.start_at)
      const key = `${leadId}::${toYMD(d)}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(sa)
    })
    return map
  }, [appointments])

  const absencesByLaneDay = useMemo(() => {
    const map = new Map()
    absences.forEach(a => {
      const start = new Date(a.start_at)
      const end = new Date(a.end_at)
      // Absences can span multiple days — emit a per-day slice for each
      // calendar day in [start, end].
      let d = new Date(start); d.setHours(0,0,0,0)
      while (d <= end) {
        const key = `${a.lane_id ?? a.contact_id}::${toYMD(d)}`
        if (!map.has(key)) map.set(key, [])
        const dayStart = new Date(d); dayStart.setHours(DAY_START_HOUR, 0, 0, 0)
        const dayEnd   = new Date(d); dayEnd.setHours(DAY_END_HOUR, 0, 0, 0)
        const slice = {
          id: `${a.id}::${toYMD(d)}`,
          start_at: start > dayStart ? start : dayStart,
          end_at:   end   < dayEnd   ? end   : dayEnd,
          reason: a.reason,
        }
        if (slice.end_at > slice.start_at) map.get(key).push(slice)
        d = addDays(d, 1)
      }
    })
    return map
  }, [absences])

  // Unassigned SAs (no Team Lead in saa) — shown in a special row at the bottom
  const hasUnassigned = appointments.some(sa => !sa.team_lead?.id)
  const allLanes = useMemo(() => {
    const out = leads.map(l => ({ ...l, isUnassigned: false }))
    if (hasUnassigned) out.push({
      id: '__unassigned__', full_name: 'Unassigned', crew_label: null,
      service_territory_id: null, certification_ids: [], isUnassigned: true,
    })
    return out
  }, [leads, hasUnassigned])

  // Apply rail filters. Unassigned lane always passes (filters apply only
  // to real Team Leads) so the dispatcher never loses sight of unassigned
  // work. Predicate is centralized in DispatchFilterRail for testability.
  const filteredLanes = useMemo(() => {
    return allLanes.filter(lane => {
      if (lane.isUnassigned) return true
      return laneInScope({
        lane,
        search: filterSearch,
        selectedCrews: filterCrews,
        selectedTerritoryIds: filterTerritoryIds,
        selectedCertIds: filterCertIds,
        availableOnly: filterAvailableOnly,
        leadAbsences: absences,
        viewStart: fromYMD(startDate),
        viewEnd: fromYMD(endDate),
      })
    })
  }, [allLanes, filterSearch, filterCrews, filterTerritoryIds, filterCertIds, filterAvailableOnly, absences, startDate, endDate])

  // ─── Render helpers ───
  const goPrevWeek = () => {
    setStartDate(toYMD(addDays(fromYMD(startDate), -7)))
    setEndDate(toYMD(addDays(fromYMD(endDate), -7)))
  }
  const goNextWeek = () => {
    setStartDate(toYMD(addDays(fromYMD(startDate), 7)))
    setEndDate(toYMD(addDays(fromYMD(endDate), 7)))
  }
  const goThisWeek = () => {
    const mon = startOfWeekMonday(new Date())
    setStartDate(toYMD(mon))
    setEndDate(toYMD(addDays(mon, 4)))
  }
  const openSA = useCallback((sa) => {
    if (onNavigateToRecord) onNavigateToRecord('service_appointments', sa.id)
  }, [onNavigateToRecord])

  // ─── Drop handlers ────────────────────────────────────────────────────
  //
  // Vertical Y within a day-cell maps linearly to local time in [DAY_START_HOUR,
  // DAY_END_HOUR]. Snap to 15-min increments before commit.
  const SNAP_MINUTES = 15
  const yToLocalStart = useCallback((day, y, cellHeight) => {
    const clampedY = Math.max(0, Math.min(cellHeight, y))
    const hoursAfterStart = clampedY / PIXELS_PER_HOUR
    let totalMinutes = Math.round((DAY_START_HOUR * 60 + hoursAfterStart * 60) / SNAP_MINUTES) * SNAP_MINUTES
    // Avoid placing inside the lunch band (11:30–12:00) — snap to one side
    const lunchStart = 11 * 60 + 30
    const lunchEnd   = 12 * 60
    if (totalMinutes > lunchStart && totalMinutes < lunchEnd) totalMinutes = lunchEnd
    // Clamp so the start is at or after DAY_START_HOUR and at or before DAY_END_HOUR
    if (totalMinutes < DAY_START_HOUR * 60) totalMinutes = DAY_START_HOUR * 60
    if (totalMinutes > DAY_END_HOUR   * 60) totalMinutes = DAY_END_HOUR   * 60
    const d = new Date(day)
    d.setHours(0, 0, 0, 0)
    d.setMinutes(totalMinutes)
    return d
  }, [])

  // Drop handler invoked by the DayCell on drop.
  //  payload         — parsed {type, ...} from dataTransfer
  //  lane            — { id, isUnassigned, ... }
  //  day             — Date for the day cell
  //  yWithinCell     — pixel offset from the cell's top
  //  cellHeight      — cell pixel height
  const handleDrop = useCallback(async (payload, lane, day, yWithinCell, cellHeight) => {
    if (!payload) return
    if (lane.isUnassigned) {
      toast.warning('The Unassigned row cannot accept drops. Pick a Team Lead lane.')
      return
    }
    if (dropBusy) return
    setDropBusy(true)
    setDragHoverKey(null)

    const startDate = yToLocalStart(day, yWithinCell, cellHeight)
    try {
      if (payload.type === 'unscheduled_wo') {
        if (!payload.duration_minutes || payload.duration_minutes <= 0) {
          toast.error('Cannot schedule — duration is not set on this work type.')
          return
        }
        const endDate = new Date(startDate.getTime() + payload.duration_minutes * 60 * 1000)
        const ymd = toYMD(startDate)
        const row = await dispatchAssignWorkOrder({
          workOrderId: payload.wo_id,
          projectId:   payload.project_id,
          teamLeadSource: lane.source || 'contact',
          teamLeadContactId: lane.source === 'user' ? null : (lane.person_id ?? lane.id),
          teamLeadUserId:    lane.source === 'user' ? (lane.person_id ?? lane.id) : null,
          startISO: startDate.toISOString(),
          dateYMD:  ymd,
        })
        if (row?.placed && row?.service_appointment_id) {
          toast.success(`Scheduled ${row.work_order_record_number || ''} → ${row.service_appointment_record_number || 'appointment'}.`)
          setRefreshNonce(n => n + 1)
        } else {
          toast.error(`Could not schedule: ${row?.placement_error || 'unknown error'} — try a different time or Team Lead.`)
        }
      } else if (payload.type === 'sa') {
        const endDate = new Date(startDate.getTime() + payload.duration_minutes * 60 * 1000)
        const res = await dispatchRescheduleServiceAppointment({
          serviceAppointmentId: payload.sa_id,
          newStartIso: startDate.toISOString(),
          newEndIso:   endDate.toISOString(),
          newTeamLeadSource: lane.source || 'contact',
          newTeamLeadContactId: lane.source === 'user' ? null : (lane.person_id ?? lane.id),
          newTeamLeadUserId:    lane.source === 'user' ? (lane.person_id ?? lane.id) : null,
        })
        if (res?.status === 'ok') {
          toast.success(`Rescheduled ${res.sa_record_number || 'appointment'}.`)
          setRefreshNonce(n => n + 1)
        } else if (res?.status === 'slot_taken') {
          toast.error('That time conflicts with another appointment for the selected Team Lead.')
        } else if (res?.status === 'not_reschedulable') {
          toast.error('Only Scheduled appointments can be moved.')
        } else if (res?.status === 'invalid_resource') {
          toast.error('Selected Team Lead is not a valid resource.')
        } else {
          toast.error(`Reschedule failed (${res?.status || 'unknown'}).`)
        }
      }
    } catch (e) {
      // Server-side gates: cert missing, WO not in TBS status, etc.
      toast.error(e.message || 'Operation failed')
    } finally {
      setDropBusy(false)
    }
  }, [dropBusy, toast, yToLocalStart])

  // ─── UI ───
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.page }}>
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                    background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary }}>Dispatch Console</div>
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            {activeView === 'console' ? (
              <>
                {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
                {' • '}{filteredLanes.filter(l => !l.isUnassigned).length} of {leads.length} Team Lead{leads.length === 1 ? '' : 's'}
                {' • '}{unscheduledWOs.length} unscheduled WO{unscheduledWOs.length === 1 ? '' : 's'}
              </>
            ) : (
              <>Skills &amp; certifications matrix for field staff</>
            )}
          </div>
        </div>

        {/* View toggle — sits left of the flex spacer so it's anchored near
            the title. Switches between the swimlane Console and the
            Resources matrix surface. */}
        <div role="tablist" aria-label="Dispatch view"
             style={{
               display: 'inline-flex', background: '#f0f3f8',
               borderRadius: 6, padding: 2, border: `1px solid ${C.border}`,
               marginLeft: 16,
             }}>
          {[
            { value: 'console',   label: 'Console' },
            { value: 'resources', label: 'Resources' },
            { value: 'followups', label: 'Follow-ups' },
          ].map(opt => {
            const active = activeView === opt.value
            return (
              <button
                key={opt.value}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveView(opt.value)}
                style={{
                  padding: '5px 14px',
                  fontSize: 13, fontWeight: active ? 600 : 500,
                  color: active ? C.textPrimary : C.textSecondary,
                  background: active ? C.surface : 'transparent',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                  boxShadow: active ? '0 1px 2px rgba(13,26,46,0.08)' : 'none',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        {/* Week navigation + date range — only meaningful in Console view */}
        {activeView === 'console' && (
          <>
            <button onClick={goPrevWeek} style={btnSecondary} title="Previous week">
              <Icon path="M15 19l-7-7 7-7" size={14} /> Prev
            </button>
            <button onClick={goThisWeek} style={btnSecondary} title="Jump to current week">
              This week
            </button>
            <button onClick={goNextWeek} style={btnSecondary} title="Next week">
              Next <Icon path="M9 5l7 7-7 7" size={14} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                     style={dateInput} />
              <span style={{ color: C.textSecondary }}>→</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                     style={dateInput} />
            </div>

            <button onClick={() => setRefreshNonce(n => n + 1)} style={btnSecondary} title="Refresh">
              <Icon path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />
            </button>
          </>
        )}
      </div>

      {/* ── Body: Console (rail + board + palette) OR Resources matrix ── */}
      {activeView === 'console' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
          <DispatchFilterRail
            search={filterSearch}              onSearchChange={setFilterSearch}
            selectedCrews={filterCrews}        onCrewsChange={setFilterCrews}
            selectedTerritoryIds={filterTerritoryIds} onTerritoryIdsChange={setFilterTerritoryIds}
            selectedCertIds={filterCertIds}    onCertIdsChange={setFilterCertIds}
            availableOnly={filterAvailableOnly} onAvailableOnlyChange={setFilterAvailableOnly}
            crewOptions={crewOptions}
            territoryOptions={territories}
            certificationOptions={certifications}
            visibleLaneCount={filteredLanes.filter(l => !l.isUnassigned).length}
            totalLaneCount={leads.length}
            collapsed={filterRailCollapsed}
            onToggleCollapsed={() => setFilterRailCollapsed(c => !c)}
          />

          <div style={{ flex: 1, overflow: 'auto' }}>
            {error && <div style={{ padding: 18 }}><ErrorState message={error} /></div>}
            {loading && <div style={{ padding: 18 }}><LoadingState message="Loading dispatch console…" /></div>}
            {!loading && !error && (
              <BoardGrid
                days={days}
                lanes={filteredLanes}
                appointmentsByLaneDay={appointmentsByLaneDay}
                absencesByLaneDay={absencesByLaneDay}
                onSAClick={openSA}
                dragPayload={dragPayload}
                dragHoverKey={dragHoverKey}
                onDragOverCell={(key) => setDragHoverKey(key)}
                onDragLeaveCell={() => setDragHoverKey(null)}
                onDrop={handleDrop}
                onDragStartSA={(sa) => setDragPayload({
                  type: 'sa', sa_id: sa.id, duration_minutes: durationMinutesOf(sa),
                })}
                onDragEndSA={() => { setDragPayload(null); setDragHoverKey(null) }}
              />
            )}
          </div>

          <DispatchUnscheduledPalette
            workOrders={unscheduledWOs}
            territoryNamesById={territoryNamesById}
            loading={paletteLoading}
            onDragStartWO={(wo) => setDragPayload({
            type: 'unscheduled_wo', wo_id: wo.id,
            project_id: wo.project_id, duration_minutes: wo.duration_minutes,
          })}
          onDragEndWO={() => { setDragPayload(null); setDragHoverKey(null) }}
          onClickWO={(wo) => onNavigateToRecord?.('work_orders', wo.id)}
          collapsed={paletteCollapsed}
          onToggleCollapsed={() => setPaletteCollapsed(c => !c)}
        />
      </div>
      ) : activeView === 'resources' ? (
        /* Resources view — field-staff skills & certifications matrix.
           Shares the toolbar but has its own sub-toolbar (tab toggle +
           search + title pills). RecordDetail navigation reuses the
           parent's onNavigateToRecord callback for click-throughs. */
        <ResourceMatrix onNavigateToRecord={(target) => {
          // ResourceMatrix passes { table, id }; the parent's nav helper
          // expects positional args. Adapt here so the component stays
          // self-contained.
          if (target?.table && target?.id) {
            onNavigateToRecord?.(target.table, target.id)
          }
        }} />
      ) : (
        /* Follow-ups view — dispatcher_followup_requests queue. Open +
           In Progress DFRs oldest-first; inline Claim / Close actions
           and click-through to the record-detail page for the full
           notes/resolution flow. */
        <FollowupsQueue onNavigateToRecord={(target) => {
          if (target?.table && target?.id) {
            onNavigateToRecord?.(target.table, target.id)
          }
        }} />
      )}
    </div>
  )
}

// Compute the duration of an SA from its start/end ISOs.
function durationMinutesOf(sa) {
  if (!sa?.start_at || !sa?.end_at) return 0
  return Math.max(0, Math.round((new Date(sa.end_at) - new Date(sa.start_at)) / 60000))
}

// ─── BoardGrid ──────────────────────────────────────────────────────────
// Renders header + tech rows. Each (lane × day) cell is a 484px-tall
// timeline canvas (7am at top, 6pm at bottom). SAs and absences are
// positioned absolutely inside, sized by duration.
//
// Drag-and-drop: DayCell is a drop target for both 'unscheduled_wo' and
// 'sa' payloads. SABlock is a drag source for 'sa' payloads. Drag-over
// highlight is keyed by `${laneId}::${ymd}` so only one cell at a time
// shows the green target overlay.
function BoardGrid({
  days, lanes, appointmentsByLaneDay, absencesByLaneDay, onSAClick,
  dragPayload, dragHoverKey,
  onDragOverCell, onDragLeaveCell, onDrop,
  onDragStartSA, onDragEndSA,
}) {
  const dayColumnTemplate = `200px repeat(${days.length}, minmax(220px, 1fr))`
  const cellHeight = (DAY_END_HOUR - DAY_START_HOUR) * PIXELS_PER_HOUR

  return (
    <div style={{ minWidth: 200 + days.length * 220 }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: dayColumnTemplate, position: 'sticky', top: 0, zIndex: 2,
                    background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, borderRight: `1px solid ${C.border}` }}>
          Team Lead
        </div>
        {days.map(d => {
          const isToday = toYMD(d) === toYMD(new Date())
          return (
            <div key={toYMD(d)} style={{
              padding: '10px 12px', borderRight: `1px solid ${C.border}`,
              background: isToday ? '#eff6ff' : C.surface,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: isToday ? '#1e40af' : C.textPrimary }}>
                {fmtDayHeader(d)}
              </div>
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
                {DAY_START_HOUR}:00 – {DAY_END_HOUR}:00
              </div>
            </div>
          )
        })}
      </div>

      {/* Lane rows */}
      {lanes.length === 0 && (
        <div style={{ padding: 28, textAlign: 'center', color: C.textSecondary, fontSize: 13 }}>
          No active Team Leads. Add a contact with a title containing "Team Lead" to populate lanes.
        </div>
      )}
      {lanes.map(lane => (
        <div key={lane.id} style={{ display: 'grid', gridTemplateColumns: dayColumnTemplate, borderBottom: `1px solid ${C.border}` }}>
          {/* Lane label */}
          <div style={{
            padding: '12px 14px', borderRight: `1px solid ${C.border}`,
            background: lane.isUnassigned ? '#f9fafb' : C.surface,
            position: 'sticky', left: 0, zIndex: 1,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: lane.isUnassigned ? C.textSecondary : C.textPrimary }}>
              {lane.full_name}
            </div>
            {lane.crew_label && (
              <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{lane.crew_label}</div>
            )}
            {lane.isUnassigned && (
              <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
                Has unassigned appointments
              </div>
            )}
          </div>

          {/* Day cells */}
          {days.map(d => {
            const ymd = toYMD(d)
            const key = `${lane.id}::${ymd}`
            const sas = appointmentsByLaneDay.get(key) || []
            const abs = absencesByLaneDay.get(key) || []
            return (
              <DayCell
                key={key}
                day={d}
                lane={lane}
                cellKey={key}
                appointments={sas}
                absences={abs}
                cellHeight={cellHeight}
                onSAClick={onSAClick}
                dragPayload={dragPayload}
                isHovered={dragHoverKey === key}
                onDragOverCell={onDragOverCell}
                onDragLeaveCell={onDragLeaveCell}
                onDrop={onDrop}
                onDragStartSA={onDragStartSA}
                onDragEndSA={onDragEndSA}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── DayCell ────────────────────────────────────────────────────────────
function DayCell({
  day, lane, cellKey, appointments, absences, cellHeight, onSAClick,
  dragPayload, isHovered,
  onDragOverCell, onDragLeaveCell, onDrop,
  onDragStartSA, onDragEndSA,
}) {
  // Hour gridlines drawn with a CSS gradient — every 44px is one hour
  const hourLines = `repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent ${PIXELS_PER_HOUR - 1}px,
    ${C.border} ${PIXELS_PER_HOUR - 1}px,
    ${C.border} ${PIXELS_PER_HOUR}px
  )`
  // Lunch shading: 11:30-12:00 = pixels 4.5*44=198 → 5*44=220
  const lunchTop = (11.5 - DAY_START_HOUR) * PIXELS_PER_HOUR
  const lunchH = 0.5 * PIXELS_PER_HOUR

  // Drop target wiring. Disable drops on the synthetic Unassigned lane.
  const acceptsDrops = !!dragPayload && !lane.isUnassigned
  const handleDragOver = (e) => {
    if (!acceptsDrops) return
    e.preventDefault()              // required to allow drop
    e.dataTransfer.dropEffect = 'move'
    onDragOverCell?.(cellKey)
  }
  const handleDragLeave = (e) => {
    if (!acceptsDrops) return
    // Only fire leave when actually leaving the cell, not when moving
    // between child elements
    const rt = e.relatedTarget
    if (rt && e.currentTarget.contains(rt)) return
    onDragLeaveCell?.()
  }
  const handleDropEvent = (e) => {
    if (!acceptsDrops) return
    e.preventDefault()
    try {
      const raw = e.dataTransfer.getData('application/x-ees-dispatch-payload')
      if (!raw) return
      const payload = JSON.parse(raw)
      const rect = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - rect.top
      onDrop?.(payload, lane, day, y, cellHeight)
    } catch {
      /* swallow parse errors — drop just won't commit */
    }
  }

  // Visual highlight when this cell is the hover target
  const highlightBg = isHovered && acceptsDrops
    ? 'rgba(62,207,142,0.10)'   // emerald wash
    : 'transparent'
  const highlightBorder = isHovered && acceptsDrops
    ? `2px dashed ${C.emerald}`
    : `1px solid ${C.border}`

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropEvent}
      style={{
        position: 'relative',
        height: cellHeight,
        borderRight: `1px solid ${C.border}`,
        background: hourLines,
        outline: highlightBorder === `1px solid ${C.border}` ? 'none' : highlightBorder,
        outlineOffset: -2,
      }}>
      {/* Drag-over wash (background layer behind absences and blocks) */}
      {isHovered && acceptsDrops && (
        <div style={{
          position: 'absolute', inset: 0,
          background: highlightBg, pointerEvents: 'none', zIndex: 0,
        }} />
      )}
      {/* Lunch band */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: lunchTop, height: lunchH,
        background: 'repeating-linear-gradient(45deg, transparent 0 6px, rgba(100,116,139,0.06) 6px 12px)',
        pointerEvents: 'none',
      }} />

      {/* Absences first (lower z) */}
      {absences.map(a => {
        const top = pxFromTime(a.start_at)
        const height = Math.max(8, pxFromTime(a.end_at) - top)
        return (
          <div key={a.id} title={`${a.reason} — ${fmtClock(new Date(a.start_at))}–${fmtClock(new Date(a.end_at))}`}
               style={{
                 position: 'absolute', left: 4, right: 4, top: Math.max(0, top), height,
                 background: '#e5e7eb', border: '1px solid #9ca3af', borderRadius: 4,
                 color: '#374151', fontSize: 10, padding: '2px 6px', fontStyle: 'italic',
                 pointerEvents: 'none',  // absences don't intercept drops
               }}>
            {a.reason}
          </div>
        )
      })}

      {/* SA blocks */}
      {appointments.map(sa => (
        <SABlock
          key={sa.id} sa={sa} cellHeight={cellHeight}
          onClick={() => onSAClick(sa)}
          onDragStart={onDragStartSA}
          onDragEnd={onDragEndSA}
        />
      ))}
    </div>
  )
}

// ─── SABlock ────────────────────────────────────────────────────────────
// Draggable: emits payload {type:'sa', sa_id, duration_minutes} so the
// dispatch board can drop-to-reassign onto another lane/day/time.
function SABlock({ sa, cellHeight, onClick, onDragStart, onDragEnd }) {
  const top = pxFromTime(sa.start_at)
  const bottom = pxFromTime(sa.end_at)
  const clippedTop = Math.max(0, top)
  const clippedBottom = Math.min(cellHeight, bottom)
  const height = Math.max(18, clippedBottom - clippedTop)
  const color = colorForWorkType(sa.work_type?.id)
  const isShort = height < 36

  const label = sa.work_type?.name || sa.sa_name || 'Appointment'
  const sub = sa.building?.name
    ? `${sa.building.name}${sa.unit?.name ? ' / ' + sa.unit.name : ''}`
    : (sa.unit?.name || '')

  const tooltip = [
    `${sa.sa_record_number} — ${label}`,
    sub && `Location: ${sub}`,
    sa.building?.property_name && `Property: ${sa.building.property_name}`,
    `Time: ${fmtClock(new Date(sa.start_at))} – ${fmtClock(new Date(sa.end_at))}`,
    sa.work_order?.record_number && `WO: ${sa.work_order.record_number}`,
    sa.project?.record_number && `Project: ${sa.project.record_number}`,
    'Drag to reassign',
  ].filter(Boolean).join('\n')

  // dispatch_reschedule_service_appointment is only valid on appointments
  // whose canonical status allows it. Statuses 'Completed'/'Cancelled'/etc.
  // are blocked server-side; we still allow drag here and surface the RPC
  // error as a toast — keeps the UI simple and the source of truth in DB.
  const handleDragStart = (e) => {
    const payload = { type: 'sa', sa_id: sa.id, duration_minutes: durationMinutesOf(sa) }
    try {
      e.dataTransfer.setData('application/x-ees-dispatch-payload', JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'move'
    } catch { /* IE/edge cases — ignore */ }
    if (typeof onDragStart === 'function') onDragStart(sa)
  }
  const handleDragEnd = () => {
    if (typeof onDragEnd === 'function') onDragEnd(sa)
  }

  return (
    <div onClick={onClick} title={tooltip}
         draggable
         onDragStart={handleDragStart}
         onDragEnd={handleDragEnd}
         style={{
           position: 'absolute', left: 4, right: 4, top: clippedTop, height,
           background: color.bg, border: `1px solid ${color.border}`,
           borderLeft: `4px solid ${color.border}`,
           borderRadius: 4, padding: isShort ? '2px 6px' : '4px 8px',
           color: color.text, fontSize: 11, lineHeight: 1.25,
           overflow: 'hidden', cursor: 'grab', boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
         }}>
      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fmtClock(new Date(sa.start_at))} {label}
      </div>
      {!isShort && sub && (
        <div style={{ marginTop: 2, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── Local styles ───────────────────────────────────────────────────────
const btnSecondary = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', fontSize: 12.5, fontWeight: 500,
  background: C.surface, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
}
const dateInput = {
  padding: '5px 8px', fontSize: 12.5, color: C.textPrimary,
  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5,
}
