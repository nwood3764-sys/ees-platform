// =============================================================================
// ServiceAreaMap — draw a service-area boundary on a map, derive the ZIP codes
// inside it. Used by the public Service Provider intake funnel so an applicant
// never has to type ZIP codes: they draw one or more polygons around the areas
// they cover and we compute the ZIPs whose centroid falls inside.
//
// Fully client-side: Leaflet (OpenStreetMap tiles) for the map + a compact
// bundled ZIP-centroid asset (public/geo/us-zip-centroids.json) + turf
// point-in-polygon. Lazy-loaded (its own chunk) so Leaflet/turf/the ZIP data
// only load when the applicant reaches the coverage step.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon as turfPolygon } from '@turf/helpers'
import { C } from '../data/constants'

// Fetch + cache the ZIP centroid asset once per page load.
let ZIP_CACHE = null
async function loadZipCentroids() {
  if (ZIP_CACHE) return ZIP_CACHE
  const res = await fetch('/geo/us-zip-centroids.json')
  if (!res.ok) throw new Error('Could not load ZIP data')
  ZIP_CACHE = await res.json()
  return ZIP_CACHE
}

// Rough state centers so the map opens near where the applicant works.
const STATE_CENTER = {
  NC: [35.6, -79.4], WI: [44.5, -89.6], MI: [44.3, -85.6], CO: [39.0, -105.5], IN: [39.9, -86.3],
}

export default function ServiceAreaMap({ homeState = 'NC', onChange }) {
  const mapEl = useRef(null)
  const api = useRef({})            // stable action handlers set up in the init effect
  const [count, setCount] = useState(0)
  const [vertN, setVertN] = useState(0)
  const [areaN, setAreaN] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const center = STATE_CENTER[homeState] || [39.5, -98.35]
    const map = L.map(mapEl.current, { center, zoom: STATE_CENTER[homeState] ? 7 : 4, zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map)

    const verts = []            // in-progress vertices [[lat,lng], ...]
    const inProgress = L.layerGroup().addTo(map)
    const areas = []            // finished { layer, coords }

    const redraw = () => {
      inProgress.clearLayers()
      if (verts.length > 1) {
        L.polyline(verts, { color: C.emeraldMid, weight: 2, dashArray: '6,5' }).addTo(inProgress)
      }
      verts.forEach((v) => L.circleMarker(v, { radius: 5, color: C.emeraldMid, weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(inProgress))
      setVertN(verts.length)
    }

    const recompute = async () => {
      if (!areas.length) { setCount(0); onChange?.([]); return }
      setBusy(true); setError('')
      try {
        const zips = await loadZipCentroids()
        const rings = areas.map((a) => {
          const ring = a.coords.map(([lat, lng]) => [lng, lat])
          ring.push(ring[0]) // close the ring
          return turfPolygon([ring])
        })
        const found = new Set()
        for (const zip in zips) {
          const c = zips[zip]
          const pt = point(c)
          for (let i = 0; i < rings.length; i++) {
            if (booleanPointInPolygon(pt, rings[i])) { found.add(zip); break }
          }
        }
        const arr = Array.from(found).sort()
        setCount(arr.length)
        onChange?.(arr)
      } catch (e) {
        setError(e?.message || 'Could not compute ZIP codes.')
      } finally { setBusy(false) }
    }

    const onClick = (e) => { verts.push([e.latlng.lat, e.latlng.lng]); redraw() }
    map.on('click', onClick)

    api.current = {
      undo: () => { verts.pop(); redraw() },
      finish: async () => {
        if (verts.length < 3) return
        const coords = verts.slice()
        const layer = L.polygon(coords, { color: C.emeraldMid, weight: 2, fillColor: C.emerald, fillOpacity: 0.15 }).addTo(map)
        areas.push({ layer, coords })
        setAreaN(areas.length)
        verts.length = 0; redraw()
        await recompute()
      },
      clearAll: async () => {
        areas.forEach((a) => map.removeLayer(a.layer)); areas.length = 0
        verts.length = 0; redraw(); setAreaN(0)
        await recompute()
      },
    }

    const t = setTimeout(() => map.invalidateSize(), 80)
    return () => { clearTimeout(t); map.off('click', onClick); map.remove(); api.current = {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeState])

  const btn = (label, fn, kind = 'ghost', disabled = false) => {
    const styles = {
      primary: { background: C.emerald, color: '#06231a', border: 'none' },
      ghost: { background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}` },
    }[kind]
    return (
      <button type="button" onClick={fn} disabled={disabled}
        style={{ padding: '7px 13px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...styles }}>
        {label}
      </button>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {btn(vertN >= 3 ? `Finish this area (${vertN} points)` : `Click the map to outline an area${vertN ? ` — ${vertN} point${vertN === 1 ? '' : 's'}` : ''}`, () => api.current.finish?.(), 'primary', vertN < 3 || busy)}
        {vertN > 0 && btn('Undo point', () => api.current.undo?.(), 'ghost', busy)}
        {(areaN > 0 || vertN > 0) && btn('Clear', () => api.current.clearAll?.(), 'ghost', busy)}
      </div>
      <div ref={mapEl} style={{ height: 340, width: '100%', borderRadius: 11, overflow: 'hidden', border: `1px solid ${C.borderDark}` }} />
      <div style={{ marginTop: 8, fontSize: 13, color: C.textSecondary, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {busy ? <span style={{ color: C.textMuted }}>Calculating ZIP codes…</span>
          : count > 0
            ? <span><strong style={{ color: C.emeraldMid }}>{count}</strong> ZIP code{count === 1 ? '' : 's'} in {areaN} area{areaN === 1 ? '' : 's'}</span>
            : <span style={{ color: C.textMuted }}>Click points on the map to trace the areas you serve, then Finish. Draw as many areas as you like.</span>}
        {error && <span style={{ color: '#1a5a8a' }}>{error}</span>}
      </div>
    </div>
  )
}
