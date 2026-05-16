// DispatchModule.jsx — multi-tech swimlane view of every Scheduled
// Service Appointment across a date range. The dispatcher's daily-driver
// view: "show me what every crew is doing this week."
//
// Layout: header row = day columns (configurable range, default Mon-Fri
// of the current week). One row per active Team Lead. Each (lane × day)
// cell is a relative-positioned timeline (working hours 7am→6pm); SAs
// render as absolutely-positioned colored blocks inside, sized to their
// duration. Resource absences render as grey OOO bars.
//
// V1 is READ-ONLY: clicking an SA navigates to its record. V2 (next
// iteration) will add drag-to-reassign between lanes and drag-to-
// reschedule within a lane.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from '../components/UI'
import {
  fetchScheduledServiceAppointmentsInRange,
  fetchResourceAbsencesInRange,
  fetchActiveTeamLeads,
} from '../data/dispatchBoard'

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
  // Date range. Default: this week Mon-Fri (5 days).
  const [startDate, setStartDate] = useState(() => toYMD(startOfWeekMonday(new Date())))
  const [endDate,   setEndDate]   = useState(() => toYMD(addDays(startOfWeekMonday(new Date()), 4)))

  const [leads, setLeads] = useState([])
  const [appointments, setAppointments] = useState([])
  const [absences, setAbsences] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

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
        const key = `${a.contact_id}::${toYMD(d)}`
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
    if (hasUnassigned) out.push({ id: '__unassigned__', full_name: 'Unassigned', crew_label: null, isUnassigned: true })
    return out
  }, [leads, hasUnassigned])

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

  // ─── UI ───
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.page }}>
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                    background: C.surface, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary }}>Dispatch Board</div>
          <div style={{ fontSize: 12, color: C.textSecondary }}>
            {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
            {' • '}{leads.length} active Team Lead{leads.length === 1 ? '' : 's'}
          </div>
        </div>

        <div style={{ flex: 1 }} />

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
      </div>

      {/* ── Board body ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {error && <div style={{ padding: 18 }}><ErrorState message={error} /></div>}
        {loading && <div style={{ padding: 18 }}><LoadingState message="Loading dispatch board…" /></div>}
        {!loading && !error && (
          <BoardGrid
            days={days}
            lanes={allLanes}
            appointmentsByLaneDay={appointmentsByLaneDay}
            absencesByLaneDay={absencesByLaneDay}
            onSAClick={openSA}
          />
        )}
      </div>
    </div>
  )
}

// ─── BoardGrid ──────────────────────────────────────────────────────────
// Renders header + tech rows. Each (lane × day) cell is a 484px-tall
// timeline canvas (7am at top, 6pm at bottom). SAs and absences are
// positioned absolutely inside, sized by duration.
function BoardGrid({ days, lanes, appointmentsByLaneDay, absencesByLaneDay, onSAClick }) {
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
                appointments={sas}
                absences={abs}
                cellHeight={cellHeight}
                onSAClick={onSAClick}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── DayCell ────────────────────────────────────────────────────────────
function DayCell({ day, appointments, absences, cellHeight, onSAClick }) {
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

  return (
    <div style={{
      position: 'relative',
      height: cellHeight,
      borderRight: `1px solid ${C.border}`,
      background: hourLines,
    }}>
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
               }}>
            {a.reason}
          </div>
        )
      })}

      {/* SA blocks */}
      {appointments.map(sa => <SABlock key={sa.id} sa={sa} cellHeight={cellHeight} onClick={() => onSAClick(sa)} />)}
    </div>
  )
}

// ─── SABlock ────────────────────────────────────────────────────────────
function SABlock({ sa, cellHeight, onClick }) {
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
  ].filter(Boolean).join('\n')

  return (
    <div onClick={onClick} title={tooltip}
         style={{
           position: 'absolute', left: 4, right: 4, top: clippedTop, height,
           background: color.bg, border: `1px solid ${color.border}`,
           borderLeft: `4px solid ${color.border}`,
           borderRadius: 4, padding: isShort ? '2px 6px' : '4px 8px',
           color: color.text, fontSize: 11, lineHeight: 1.25,
           overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
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
