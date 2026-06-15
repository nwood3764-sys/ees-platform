// ─── MapView.jsx ─────────────────────────────────────────────────────────────
// Today's stops in scheduled order with native-maps navigation. The property
// hierarchy stores text addresses, not geocoded coordinates, so this screen
// does NOT render arbitrary coordinate pins (that would misrepresent stop
// locations). Instead each stop deep-links to Apple/Google Maps with its
// address pre-loaded — the OS geocodes natively — and a "Route all stops"
// action builds a multi-waypoint directions URL in scheduled order.
//
// When a geocode backfill lands on buildings (lat/long), this screen can add
// an embedded pinned map without changing the navigation contract below.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import MobileShell from './MobileShell'
import { fetchTodaySchedule, chicagoToday } from './fieldMobileService'
import { C, FONT, MONO, card } from './styles'

// Apple Maps on iOS, Google Maps elsewhere. Both accept a plain address
// query and geocode it; on iOS the maps: scheme opens Apple Maps directly,
// while https://maps.google.com works universally as a fallback.
function isIOS() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function navUrlFor(address) {
  const q = encodeURIComponent(address)
  return isIOS()
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`
}

// Google Maps multi-stop directions: origin defaults to current location,
// destination is the last stop, waypoints are everything between. Works on
// both platforms via the universal https URL.
function routeUrlFor(addresses) {
  if (addresses.length === 0) return null
  const dest = encodeURIComponent(addresses[addresses.length - 1])
  const waypoints = addresses.slice(0, -1).map(encodeURIComponent).join('|')
  let url = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`
  if (waypoints) url += `&waypoints=${waypoints}`
  return url
}

function PinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

export default function MapView({ navigate }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows(await fetchTodaySchedule(chicagoToday())) }
    catch (e) { setError(e.message || 'Could not load stops.'); setRows([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const addressable = rows.filter(r => r.building_address)
  const routeUrl = routeUrlFor(addressable.map(r => r.building_address))

  return (
    <MobileShell title="Map · Today's Stops" onBack={() => navigate('/field')}>
      {loading && <Empty>Loading stops…</Empty>}
      {error && <Empty tone="error">{error}</Empty>}
      {!loading && !error && rows.length === 0 && <Empty>No stops for today.</Empty>}

      {routeUrl && (
        <a
          href={routeUrl} target="_blank" rel="noopener noreferrer"
          style={{
            ...card, width: '100%', boxSizing: 'border-box', textDecoration: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '14px', marginBottom: 12, background: C.emerald, color: '#062018',
            fontFamily: FONT, fontWeight: 700, fontSize: 15, border: 'none',
          }}
        >
          Route all stops in order
        </a>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r, i) => (
          <div key={r.sa_id} style={{ ...card, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%', background: C.sidebar,
                color: C.navActive, fontFamily: MONO, fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <span
                onClick={() => r.work_order_id && navigate(`/field/wo/${r.work_order_id}`)}
                style={{ fontFamily: FONT, fontWeight: 700, fontSize: 15, color: C.textPrimary, cursor: 'pointer' }}>
                {r.property_name || r.work_order_name || 'Work Order'}
              </span>
            </div>

            {r.building_address ? (
              <div style={{ fontSize: 13, color: C.textSecondary }}>
                {r.building_address}{r.unit ? ` · Unit ${r.unit}` : ''}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.textMuted, fontStyle: 'italic' }}>
                No address on file
              </div>
            )}

            {r.building_address && (
              <a
                href={navUrlFor(r.building_address)} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  textDecoration: 'none', background: C.cardSecondary, color: C.emeraldMid,
                  border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px',
                  fontFamily: FONT, fontWeight: 600, fontSize: 14, minHeight: 44,
                }}
              >
                <PinIcon /> Navigate
              </a>
            )}
          </div>
        ))}
      </div>
    </MobileShell>
  )
}

function Empty({ children, tone }) {
  return (
    <div style={{
      ...card, padding: 24, textAlign: 'center',
      color: tone === 'error' ? C.danger : C.textMuted, fontFamily: FONT, fontSize: 14,
    }}>
      {children}
    </div>
  )
}
