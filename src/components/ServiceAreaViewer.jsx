// =============================================================================
// ServiceAreaViewer — READ-ONLY view of the ZIP codes a service provider
// selected during intake. Renders two things side by side with the ZIP data
// the applicant submitted:
//   1. A coverage map — each ZIP's centroid plotted as a dot, the map fit to
//      the covered area (the drawn polygons aren't stored, only the resulting
//      ZIPs, so plotting the centroids is the honest reconstruction).
//   2. A grouped ZIP table/list (by state) with a total count, copy-all, and
//      CSV export.
//
// Purpose-built for the Service Provider review card — NOT the drawing widget
// (ServiceAreaMap) used on the public intake funnel. Fully client-side and
// lazy-loaded (its own chunk with Leaflet + the bundled ZIP centroid asset).
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { C } from '../data/constants'

const MONO = 'JetBrains Mono, ui-monospace, monospace'

// Fetch + cache the ZIP centroid asset once per page load (shape: { zip: [lng, lat] }).
let ZIP_CACHE = null
async function loadZipCentroids() {
  if (ZIP_CACHE) return ZIP_CACHE
  const res = await fetch('/geo/us-zip-centroids.json')
  if (!res.ok) throw new Error('Could not load ZIP map data')
  ZIP_CACHE = await res.json()
  return ZIP_CACHE
}

// The read-only Leaflet coverage map. Plots a dot per ZIP centroid and fits the
// view to them. Re-plots whenever the ZIP list changes.
function CoverageMap({ zips }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [status, setStatus] = useState('') // '', 'loading', error text

  useEffect(() => {
    const map = L.map(mapEl.current, { center: [39.5, -98.35], zoom: 4, zoomControl: true, scrollWheelZoom: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)
    mapRef.current = map
    const t = setTimeout(() => map.invalidateSize(), 80)
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; layerRef.current = null }
  }, [])

  useEffect(() => {
    let cancelled = false
    const map = mapRef.current
    if (!map) return
    setStatus('loading')
    loadZipCentroids().then((centroids) => {
      if (cancelled || !mapRef.current) return
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
      const group = L.layerGroup().addTo(map)
      const pts = []
      let missing = 0
      for (const z of zips) {
        const c = centroids[z]
        if (!c) { missing++; continue }
        const latlng = [c[1], c[0]]
        pts.push(latlng)
        L.circleMarker(latlng, { radius: 5, color: C.emeraldMid, weight: 1.5, fillColor: C.emerald, fillOpacity: 0.7 })
          .bindTooltip(z, { direction: 'top' })
          .addTo(group)
      }
      layerRef.current = group
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 11 })
      setStatus(missing ? `${missing} ZIP${missing === 1 ? '' : 's'} without a map location` : '')
    }).catch((e) => { if (!cancelled) setStatus(e?.message || 'Could not load the map.') })
    return () => { cancelled = true }
  }, [zips])

  return (
    <div>
      <div ref={mapEl} style={{ height: 320, width: '100%', borderRadius: 11, overflow: 'hidden', border: `1px solid ${C.borderDark}` }} />
      {status && status !== 'loading' && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.textMuted }}>{status}</div>
      )}
    </div>
  )
}

export default function ServiceAreaViewer({ areas }) {
  // Normalize + de-dupe the incoming rows to { zip, state }.
  const rows = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const a of areas || []) {
      const zip = String(a.spsa_zip_code || a.zip || '').trim()
      if (!zip || seen.has(zip)) continue
      seen.add(zip)
      out.push({ zip, state: a.spsa_state || a.state || '' })
    }
    return out.sort((x, y) => (x.state || '').localeCompare(y.state || '') || x.zip.localeCompare(y.zip))
  }, [areas])

  const zips = useMemo(() => rows.map((r) => r.zip), [rows])

  // Group by state for the table.
  const byState = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      const s = r.state || '—'
      if (!m.has(s)) m.set(s, [])
      m.get(s).push(r.zip)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const [copied, setCopied] = useState(false)

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(zips.join(', '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked — ignore */ }
  }

  const exportCsv = () => {
    const lines = ['ZIP Code,State', ...rows.map((r) => `${r.zip},${r.state}`)]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'service-area-zip-codes.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!rows.length) {
    return <div style={{ fontSize: 12.5, color: C.textMuted }}>No service-area ZIP codes were submitted with this application.</div>
  }

  const chip = (z) => (
    <span key={z} style={{ fontFamily: MONO, fontSize: 12, color: C.textPrimary, background: '#f0f5fb', border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 7px' }}>{z}</span>
  )

  return (
    <div>
      {/* summary + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: C.textSecondary }}>
          <strong style={{ color: C.emeraldMid, fontFamily: MONO }}>{zips.length}</strong> ZIP code{zips.length === 1 ? '' : 's'}
          {byState.length > 1 ? ` across ${byState.length} states` : (byState[0] && byState[0][0] !== '—' ? ` in ${byState[0][0]}` : '')}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={copyAll}
          style={{ background: '#fff', border: `1px solid ${C.borderDark}`, color: C.textSecondary, borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          {copied ? 'Copied' : 'Copy ZIPs'}
        </button>
        <button type="button" onClick={exportCsv}
          style={{ background: '#fff', border: `1px solid ${C.borderDark}`, color: C.textSecondary, borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Export CSV
        </button>
      </div>

      {/* map + list */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="sav-grid">
        <CoverageMap zips={zips} />
        <div style={{ maxHeight: 340, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, background: C.cardSecondary || '#f7f9fc' }}>
          {byState.map(([state, list]) => (
            <div key={state} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSecondary, letterSpacing: 0.4, marginBottom: 6 }}>
                {state === '—' ? 'NO STATE' : state} <span style={{ color: C.textMuted, fontWeight: 600 }}>· {list.length}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {list.map(chip)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* responsive: stack on narrow cards */}
      <style>{`@media (max-width: 720px){ .sav-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}
