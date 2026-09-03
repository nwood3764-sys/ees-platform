// ─── WorkOrdersToSchedule ────────────────────────────────────────────────────
// The dispatcher's worklist: every work order still waiting for a technician, a
// day, or both — and the controls to give it them.
//
// Nicholas, 2026-09-03: "You need to get the dispatch board in a place where
// somebody can use it. They need to see what work orders are to be scheduled so
// that they can schedule."
//
// The Schedule board drew service appointments only, so a work order nobody had
// booked an appointment for was invisible on the one screen whose job is to
// find unscheduled work. 58 of 71 open work orders were in that position.
//
// Scheduling here writes the work order's own Assigned Technician and Scheduled
// Start Date, which since 2026-09-03 is the whole of what puts a job on a
// technician's phone. No service appointment is created: those are for
// assessments, and creating one would put a customer into the notification
// pipeline for work nobody booked with them.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../UI'

// The desktop modules carry these inline rather than importing them — FONT and
// MONO live in fieldMobile/styles and belong to LEAP Pad.
const FONT = 'Inter, system-ui, sans-serif'
const MONO = 'JetBrains Mono, monospace'
import { useToast } from '../Toast'
import {
  fetchWorkOrdersToSchedule,
  fetchSchedulableTechnicians,
  scheduleWorkOrder,
} from '../../data/dispatchService'

const NEEDS_LABEL = {
  both:       'No technician, no date',
  technician: 'Needs a technician',
  date:       'Needs a date',
}

// Today in the browser's zone, as the YYYY-MM-DD a date input expects. Built
// from local parts, never toISOString(), which would hand back UTC and offer
// tomorrow to anyone west of Greenwich after 6pm.
function todayLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function WorkOrdersToSchedule({ onOpenWorkOrder = null, onScheduled = null }) {
  const [rows, setRows] = useState(null)
  const [techs, setTechs] = useState([])
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [draft, setDraft] = useState({ technicianId: '', date: '', time: '' })
  const [search, setSearch] = useState('')
  const toast = useToast()

  const load = useCallback(async () => {
    setError(null)
    try {
      const [wos, people] = await Promise.all([
        fetchWorkOrdersToSchedule(),
        fetchSchedulableTechnicians(),
      ])
      setRows(wos)
      setTechs(people)
    } catch (err) {
      setError(err.message || String(err))
      setRows([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows || []
    return (rows || []).filter(r =>
      [r.recordNumber, r.name, r.workType, r.property, r.place, r.building, r.unit]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q))
    )
  }, [rows, search])

  const openFor = (r) => {
    setOpenId(r.id)
    setDraft({
      technicianId: r.technicianId || '',
      date: r.date || todayLocal(),
      time: r.time ? String(r.time).slice(0, 5) : '',
    })
  }

  const save = async (r) => {
    setBusyId(r.id)
    try {
      await scheduleWorkOrder({
        workOrderId: r.id,
        technicianId: draft.technicianId,
        date: draft.date,
        time: draft.time || null,
        currentStatus: r.status,
      })
      // Say who and when, because the row is about to disappear off this list
      // and that is the only confirmation the dispatcher gets.
      const who = techs.find(t => t.id === draft.technicianId)?.name || 'the technician'
      toast.success(`${r.recordNumber} scheduled for ${who} on ${draft.date}`)
      setOpenId(null)
      await load()
      if (onScheduled) onScheduled()
    } catch (err) {
      toast.error(err.message || 'Could not schedule that work order.')
    } finally {
      setBusyId(null)
    }
  }

  const cardStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
    marginBottom: 16, overflow: 'hidden',
  }

  return (
    <div style={cardStyle}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        background: C.cardSecondary,
      }}>
        <Icon path="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          size={14} color={C.textSecondary} />
        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 13, color: C.textPrimary }}>
          To Be Scheduled
        </span>
        {rows !== null && (
          <span style={{
            fontFamily: MONO, fontSize: 11, fontWeight: 700, color: C.emeraldMid,
            background: '#e8f8f0', borderRadius: 20, padding: '2px 8px',
          }}>
            {rows.length}
          </span>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search work orders…"
          style={{
            marginLeft: 'auto', width: 220, maxWidth: '45%',
            fontFamily: FONT, fontSize: 12, padding: '5px 9px',
            border: `1px solid ${C.border}`, borderRadius: 6, background: C.card,
            color: C.textPrimary,
          }}
        />
      </div>

      {error && (
        <div style={{ padding: '10px 14px', fontSize: 12, color: '#1e466b', background: '#e8f1fb' }}>
          Could not load the work orders: {error}
        </div>
      )}

      {rows === null && (
        <div style={{ padding: '28px 14px', textAlign: 'center', fontSize: 12, color: C.textMuted }}>
          Loading work orders…
        </div>
      )}

      {rows !== null && shown.length === 0 && (
        <div style={{ padding: '28px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>
            {rows.length === 0 ? 'Everything is scheduled' : 'Nothing matches that search'}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {rows.length === 0
              ? 'Every open work order has a technician and a date.'
              : 'Clear the search to see the full list.'}
          </div>
        </div>
      )}

      {shown.map((r) => {
        const open = openId === r.id
        return (
          <div key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <button
                    onClick={() => onOpenWorkOrder && onOpenWorkOrder(r.id, r.name)}
                    style={{
                      appearance: 'none', background: 'none', border: 'none', padding: 0,
                      fontFamily: MONO, fontSize: 11.5, fontWeight: 700,
                      color: onOpenWorkOrder ? '#1a5a8a' : C.textMuted,
                      cursor: onOpenWorkOrder ? 'pointer' : 'default',
                    }}
                  >
                    {r.recordNumber}
                  </button>
                  <span style={{
                    fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 8px',
                    color: r.needs === 'both' ? '#8a5a00' : '#1e466b',
                    background: r.needs === 'both' ? '#fdf3e0' : '#e8f1fb',
                  }}>
                    {NEEDS_LABEL[r.needs]}
                  </span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{r.status}</span>
                </div>
                <div style={{
                  fontFamily: FONT, fontSize: 13, fontWeight: 600, color: C.textPrimary,
                  marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.workType}
                </div>
                <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 1 }}>
                  {[r.property, r.building && `Bldg ${r.building}`, r.unit && `Unit ${r.unit}`, r.place]
                    .filter(Boolean).join(' · ')}
                </div>
                {(r.technician || r.date) && (
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    {r.technician ? `Assigned to ${r.technician}` : 'No technician'}
                    {' · '}
                    {r.date ? `Scheduled ${r.date}` : 'No date'}
                  </div>
                )}
              </div>
              <button
                onClick={() => (open ? setOpenId(null) : openFor(r))}
                style={{
                  background: open ? C.card : C.emerald, color: open ? C.textSecondary : '#fff',
                  border: open ? `1px solid ${C.border}` : 'none',
                  borderRadius: 6, padding: '6px 14px', fontFamily: FONT,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                }}
              >
                {open ? 'Cancel' : 'Schedule'}
              </button>
            </div>

            {open && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10,
                padding: '0 14px 12px', background: C.cardSecondary,
                borderTop: `1px solid ${C.border}`, paddingTop: 12,
              }}>
                <Field label="Technician">
                  <select
                    value={draft.technicianId}
                    onChange={(e) => setDraft(d => ({ ...d, technicianId: e.target.value }))}
                    style={inputStyle}
                  >
                    <option value="">Choose…</option>
                    {techs.map(t => (
                      <option key={t.id} value={t.id}>{t.name}{t.title ? ` — ${t.title}` : ''}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" value={draft.date} style={inputStyle}
                    onChange={(e) => setDraft(d => ({ ...d, date: e.target.value }))} />
                </Field>
                <Field label="Start time (optional)">
                  <input type="time" value={draft.time} style={inputStyle}
                    onChange={(e) => setDraft(d => ({ ...d, time: e.target.value }))} />
                </Field>
                <button
                  onClick={() => save(r)}
                  disabled={busyId === r.id || !draft.technicianId || !draft.date}
                  style={{
                    background: (!draft.technicianId || !draft.date) ? C.borderDark : C.emerald,
                    color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px',
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                    cursor: (!draft.technicianId || !draft.date) ? 'not-allowed' : 'pointer',
                    minHeight: 32,
                  }}
                >
                  {busyId === r.id ? 'Scheduling…' : 'Save'}
                </button>
                <div style={{ fontSize: 11, color: C.textMuted, flexBasis: '100%' }}>
                  This puts the job on that technician's LEAP Pad for the day. No customer is contacted.
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const inputStyle = {
  fontFamily: FONT, fontSize: 12.5, padding: '6px 9px',
  border: `1px solid ${C.border}`, borderRadius: 6, background: C.card,
  color: C.textPrimary, minHeight: 32,
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 700,
        letterSpacing: '0.04em', textTransform: 'uppercase', color: C.textMuted,
      }}>
        {label}
      </span>
      {children}
    </label>
  )
}
