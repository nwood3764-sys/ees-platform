// ─── HomeScreen.jsx ──────────────────────────────────────────────────────────
// Landing tab of the technician PWA. Not a stub — it surfaces the technician's
// real day at a glance:
//   • Greeting + today's date.
//   • Count of today's assigned stops.
//   • Next stop card (earliest remaining appointment), tappable to its work
//     order. Falls back to a clear empty state when the day has no stops.
//   • Quick links into Schedule and Map.
//
// Data: my_service_appointments(today) via fetchTodaySchedule — the same RPC
// the Schedule screen uses, so Home and Schedule never disagree.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import AppChrome, { PullIndicator } from './AppChrome'
import { usePullToRefresh } from './usePullToRefresh'
import { fetchTodaySchedule, chicagoToday } from './fieldMobileService'
import { C, FONT, MONO, card, statusChip } from './styles'

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  }).format(new Date()))
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function fmtTodayLabel() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'long', month: 'long', day: 'numeric',
    }).format(new Date())
  } catch { return '' }
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '—' }
}

// A stop is "remaining" if its work order isn't yet in a terminal state.
function isRemaining(r) {
  const s = (r.work_order_status || '').toLowerCase()
  return !(s.includes('verified') || s.includes('complete') || s.includes('unable'))
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

export default function HomeScreen({ navigate }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [name, setName]       = useState('')

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchTodaySchedule(chicagoToday())
      setRows(data)
      const n = data?.[0]?.technician_first_name || data?.[0]?.technician_name || ''
      setName(typeof n === 'string' ? n.split(' ')[0] : '')
    } catch (e) {
      setError(e.message || 'Could not load today’s schedule.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await load()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [load])

  const pr = usePullToRefresh(load)

  const total = rows.length
  const remaining = rows.filter(isRemaining)
  const nextStop = remaining[0] || null

  return (
    <AppChrome title="Home" activeKey="home" navigate={navigate}>
      <PullIndicator {...pr} />
      {/* Greeting block */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 22, fontWeight: 800, color: C.textPrimary }}>
          {greeting()}{name ? `, ${name}` : ''}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
          {fmtTodayLabel()}
        </div>
      </div>

      {/* Today summary */}
      <div style={{ ...card, padding: 16, marginBottom: 14 }}>
        {loading ? (
          <div style={{ color: C.textMuted, fontSize: 14 }}>Loading today’s work…</div>
        ) : error ? (
          <div style={{ color: C.danger, fontSize: 14 }}>{error}</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 34, fontWeight: 700, color: C.emeraldMid, lineHeight: 1 }}>
              {total}
            </span>
            <span style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary }}>
              {total === 1 ? 'stop scheduled today' : 'stops scheduled today'}
              {total > 0 && remaining.length !== total
                ? ` · ${remaining.length} remaining`
                : ''}
            </span>
          </div>
        )}
      </div>

      {/* Next stop */}
      {!loading && !error && (
        nextStop ? (
          <>
            <div style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              textTransform: 'uppercase', color: C.textMuted, margin: '4px 2px 8px',
            }}>
              Next stop
            </div>
            <button
              onClick={() => nextStop.work_order_id && navigate(`/field/wo/${nextStop.work_order_id}`)}
              style={{
                ...card, width: '100%', textAlign: 'left',
                cursor: nextStop.work_order_id ? 'pointer' : 'default',
                padding: 16, marginBottom: 16, appearance: 'none',
                display: 'block',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: C.emeraldMid, fontWeight: 700 }}>
                  {fmtTime(nextStop.sa_scheduled_start_time)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>
                  {nextStop.work_order_record_number || ''}
                </span>
              </div>
              <div style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
                {nextStop.property_name || nextStop.work_order_name || 'Work Order'}
              </div>
              {nextStop.property_address && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
                  {nextStop.property_address}
                </div>
              )}
              {(nextStop.building || nextStop.unit) && (
                <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, marginTop: 4, display: 'flex', gap: 14 }}>
                  {nextStop.building && <span><strong style={{ color: C.textPrimary }}>Bldg</strong> {nextStop.building}</span>}
                  {nextStop.unit && <span><strong style={{ color: C.textPrimary }}>Unit</strong> {nextStop.unit}</span>}
                </div>
              )}
              {nextStop.work_order_status && (
                <div style={{ marginTop: 10 }}>
                  {(() => {
                    const chip = statusChip(nextStop.work_order_status)
                    return (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: chip.bg, color: chip.color,
                        fontFamily: FONT, fontSize: 12, fontWeight: 600,
                        padding: '3px 10px', borderRadius: 12,
                      }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: chip.dot }} />
                        {nextStop.work_order_status}
                      </span>
                    )
                  })()}
                </div>
              )}
            </button>
          </>
        ) : total > 0 ? (
          <div style={{ ...card, padding: 16, marginBottom: 16, color: C.textSecondary, fontSize: 14 }}>
            All of today’s stops are complete. Nice work.
          </div>
        ) : (
          <div style={{ ...card, padding: 16, marginBottom: 16, color: C.textSecondary, fontSize: 14 }}>
            No stops scheduled today. Your schedule is pushed by the office — check back, or pull to refresh.
          </div>
        )
      )}

      {/* Quick links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <QuickLink label="View full schedule" sub="All of today’s stops in order" onClick={() => navigate('/field/schedule')} />
        <QuickLink label="Open map" sub="Navigate and route your stops" onClick={() => navigate('/field/map')} />
      </div>
    </AppChrome>
  )
}

function QuickLink({ label, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...card, width: '100%', appearance: 'none', cursor: 'pointer',
        padding: '14px 16px', textAlign: 'left',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}
    >
      <span>
        <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{label}</span>
        <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>{sub}</span>
      </span>
      <span style={{ color: C.emeraldMid, flexShrink: 0, display: 'flex' }}><ArrowIcon /></span>
    </button>
  )
}
