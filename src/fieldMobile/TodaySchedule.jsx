// ─── TodaySchedule.jsx ───────────────────────────────────────────────────────
// Home screen of the technician PWA. Lists the signed-in technician's
// assigned service appointments for the selected day, in scheduled order,
// via my_service_appointments(p_date). One tap opens the work order detail.
//
// Schedule is pushed (Director of Field Services / Project Coordinator); the
// technician does not self-assign — this screen is read-only over the day.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import MobileShell from './MobileShell'
import { fetchTodaySchedule, chicagoToday, signOut } from './fieldMobileService'
import { C, FONT, MONO, card, statusChip } from './styles'
import UpdateControls from './UpdateControls'

// Injected at build time by vite.config define. Fallback for safety if a
// build path didn't define it.
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

function MapIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  )
}

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
    }).format(new Date(iso))
  } catch { return '—' }
}

function fmtDateLabel(dateStr) {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    }).format(new Date(y, m - 1, d))
  } catch { return dateStr }
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + delta)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${mm}-${dd}`
}

export default function TodaySchedule({ navigate }) {
  const [dateStr, setDateStr] = useState(chicagoToday())
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async (d) => {
    setLoading(true); setError(null)
    try {
      setRows(await fetchTodaySchedule(d))
    } catch (e) {
      setError(e.message || 'Could not load schedule.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(dateStr) }, [dateStr, load])

  const signOutBtn = (
    <button
      onClick={async () => { await signOut() }}
      style={{
        appearance: 'none', border: '1px solid rgba(255,255,255,0.22)',
        background: 'transparent', color: C.navActive, cursor: 'pointer',
        fontFamily: FONT, fontWeight: 600, fontSize: 12,
        borderRadius: 6, padding: '6px 10px',
      }}
    >
      Sign out
    </button>
  )

  return (
    <MobileShell title="Schedule" right={signOutBtn}>
      {/* Date selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setDateStr(addDays(dateStr, -1))}
          style={dateNavBtn} aria-label="Previous day">‹</button>
        <div style={{
          flex: 1, textAlign: 'center', fontFamily: FONT, fontWeight: 700,
          fontSize: 14, color: C.textPrimary,
        }}>
          {fmtDateLabel(dateStr)}
          {dateStr !== chicagoToday() && (
            <button onClick={() => setDateStr(chicagoToday())}
              style={{
                marginLeft: 8, appearance: 'none', border: 'none', cursor: 'pointer',
                background: C.page, color: C.emeraldMid, fontFamily: FONT,
                fontWeight: 700, fontSize: 11, borderRadius: 5, padding: '3px 7px',
              }}>
              Today
            </button>
          )}
        </div>
        <button onClick={() => setDateStr(addDays(dateStr, 1))}
          style={dateNavBtn} aria-label="Next day">›</button>
      </div>

      {/* Map View entry */}
      {rows.length > 0 && (
        <button
          onClick={() => navigate('/field/map')}
          style={{
            ...card, width: '100%', display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px', marginBottom: 12, cursor: 'pointer',
            color: C.textPrimary, fontFamily: FONT, fontWeight: 600, fontSize: 14,
            background: C.card,
          }}
        >
          <span style={{ color: C.emeraldMid, display: 'flex' }}><MapIcon /></span>
          View stops on map
        </button>
      )}

      {loading && <Empty>Loading your stops…</Empty>}
      {error && <Empty tone="error">{error}</Empty>}
      {!loading && !error && rows.length === 0 && (
        <Empty>No assigned stops for this day.</Empty>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r, i) => {
          const chip = statusChip(r.work_order_status)
          return (
            <button
              key={r.sa_id}
              onClick={() => r.work_order_id && navigate(`/field/wo/${r.work_order_id}`)}
              style={{
                ...card, textAlign: 'left', cursor: r.work_order_id ? 'pointer' : 'default',
                padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
                position: 'relative',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.emeraldMid,
                  background: '#e8f8f0', borderRadius: 5, padding: '2px 6px',
                }}>
                  {fmtTime(r.sa_scheduled_start_time)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.textMuted }}>
                  {r.work_order_record_number || r.sa_record_number}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>
                  #{i + 1}
                </span>
              </div>

              <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 16, color: C.textPrimary }}>
                {r.property_name || r.work_order_name || 'Work Order'}
              </div>

              {r.property_address && (
                <div style={{ fontSize: 13, color: C.textSecondary }}>
                  {r.property_address}
                </div>
              )}

              {(r.building || r.unit) && (
                <div style={{ fontSize: 12.5, color: C.textSecondary, display: 'flex', gap: 12 }}>
                  {r.building && <span><strong style={{ color: C.textPrimary }}>Bldg</strong> {r.building}</span>}
                  {r.unit && <span><strong style={{ color: C.textPrimary }}>Unit</strong> {r.unit}</span>}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {r.work_type_name && (
                  <span style={{ fontSize: 12, color: C.textSecondary }}>{r.work_type_name}</span>
                )}
                {r.sa_duration_minutes != null && (
                  <span style={{ fontSize: 12, color: C.textMuted }}>
                    · {Math.round(r.sa_duration_minutes)} min
                  </span>
                )}
              </div>

              {r.work_order_status && (
                <span style={{
                  alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: chip.bg, color: chip.color, borderRadius: 20,
                  padding: '4px 10px', fontSize: 12, fontWeight: 600,
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: chip.dot }} />
                  {r.work_order_status}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <UpdateControls />

      <div style={{
        textAlign: 'center', marginTop: 20, paddingTop: 12,
        borderTop: `1px solid ${C.border}`,
        fontFamily: MONO, fontSize: 11, color: C.textMuted,
      }}>
        EES Field · build {BUILD_ID}
      </div>
    </MobileShell>
  )
}

const dateNavBtn = {
  appearance: 'none', cursor: 'pointer',
  background: C.card, border: `1px solid ${C.border}`,
  color: C.textSecondary, fontFamily: FONT, fontWeight: 700, fontSize: 20,
  borderRadius: 8, width: 40, height: 40, lineHeight: 1,
}

function Empty({ children, tone }) {
  return (
    <div style={{
      ...card, padding: 24, textAlign: 'center',
      color: tone === 'error' ? C.danger : C.textMuted,
      fontFamily: FONT, fontSize: 14,
    }}>
      {children}
    </div>
  )
}
