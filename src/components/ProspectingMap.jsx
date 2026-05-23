import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'

// Load Leaflet on demand from a public CDN. Avoids adding leaflet as a
// build-time dependency (the Vite hazard memory warns about circular
// vendor chunks when new shared deps are introduced). One-time global
// promise so multiple <ProspectingMap> mounts don't re-inject scripts.

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS_URL  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'

let _leafletPromise = null

function loadLeaflet() {
  if (_leafletPromise) return _leafletPromise
  _leafletPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('No window')); return }
    if (window.L) { resolve(window.L); return }

    if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
      const link = document.createElement('link')
      link.rel  = 'stylesheet'
      link.href = LEAFLET_CSS_URL
      document.head.appendChild(link)
    }

    let script = document.querySelector(`script[src="${LEAFLET_JS_URL}"]`)
    if (!script) {
      script = document.createElement('script')
      script.src   = LEAFLET_JS_URL
      script.async = true
      document.head.appendChild(script)
    }

    script.addEventListener('load',  () => resolve(window.L))
    script.addEventListener('error', () => reject(new Error('Failed to load Leaflet')))
    // If Leaflet was previously loaded by another widget the script tag
    // already exists and 'load' won't fire again — check window.L too.
    if (window.L) resolve(window.L)
  })
  return _leafletPromise
}

/**
 * Lightweight map that drops a marker for each prospect property with
 * valid lat/lng. Click a marker → opens the property's RecordDetail.
 * Properties without coordinates are filtered out (no map pin) but
 * counted at the bottom of the card for transparency.
 */
export function ProspectingMap({ properties, onOpenProperty }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const markersLayerRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  // Initialize the map once Leaflet is available.
  useEffect(() => {
    let cancelled = false
    loadLeaflet()
      .then(L => {
        if (cancelled || !containerRef.current) return
        if (mapRef.current) return // already initialized
        const map = L.map(containerRef.current, {
          center: [39.8283, -98.5795], // approximate centre of CONUS
          zoom: 4,
          zoomControl: true,
          attributionControl: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap contributors',
        }).addTo(map)
        mapRef.current = map
        markersLayerRef.current = L.layerGroup().addTo(map)
        setReady(true)
      })
      .catch(e => { if (!cancelled) setError(e) })
    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markersLayerRef.current = null
      }
    }
  }, [])

  // Re-render pins whenever the properties prop changes (and the map is up).
  useEffect(() => {
    if (!ready) return
    const L = window.L
    if (!L || !mapRef.current || !markersLayerRef.current) return

    markersLayerRef.current.clearLayers()

    const valid = (properties || []).filter(p =>
      typeof p.latitude  === 'number' && !Number.isNaN(p.latitude) &&
      typeof p.longitude === 'number' && !Number.isNaN(p.longitude)
    )

    valid.forEach(p => {
      const marker = L.marker([p.latitude, p.longitude])
      const popup = `
        <div style="font-family: Inter, sans-serif; font-size: 12px; min-width:180px; max-width:240px;">
          <div style="font-weight:600; color:#0d1a2e; margin-bottom:4px;">${escapeHtml(p.name || 'Unnamed property')}</div>
          <div style="color:#4a5e7a; margin-bottom:6px;">${escapeHtml(p.address || '')}${p.state ? ', ' + escapeHtml(p.state) : ''}</div>
          ${p.units    ? `<div style="color:#4a5e7a;">Units: <b>${p.units}</b></div>` : ''}
          ${p.account  ? `<div style="color:#4a5e7a;">Account: <b>${escapeHtml(p.account)}</b></div>` : ''}
          ${p.hudPropertyId ? `<div style="color:#4a5e7a; font-family:'JetBrains Mono', monospace;">HUD ${escapeHtml(p.hudPropertyId)}</div>` : ''}
          ${onOpenProperty ? `<button data-leap-open-property="${p._id}" style="margin-top:8px; padding:5px 10px; background:#3ecf8e; color:#fff; border:none; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">Open property →</button>` : ''}
        </div>
      `
      marker.bindPopup(popup)
      marker.addTo(markersLayerRef.current)
    })

    // Auto-fit to markers if there are any
    if (valid.length > 0) {
      try {
        const group = L.featureGroup(markersLayerRef.current.getLayers())
        const bounds = group.getBounds()
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
        }
      } catch { /* ignore */ }
    }
  }, [properties, ready, onOpenProperty])

  // Delegate clicks on the popup's Open button (rendered inside Leaflet popup).
  useEffect(() => {
    if (!ready || !onOpenProperty) return
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      const t = e.target
      if (t && t.dataset && t.dataset.leapOpenProperty) {
        onOpenProperty(t.dataset.leapOpenProperty)
      }
    }
    container.addEventListener('click', handler)
    return () => container.removeEventListener('click', handler)
  }, [ready, onOpenProperty])

  const total = properties?.length ?? 0
  const placed = (properties || []).filter(p =>
    typeof p.latitude  === 'number' && !Number.isNaN(p.latitude) &&
    typeof p.longitude === 'number' && !Number.isNaN(p.longitude)
  ).length
  const missing = total - placed

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
      {error && (
        <div style={{ padding:'10px 16px', background:'#fde8e8', color:'#a32626', fontSize:12, borderBottom:`1px solid ${C.border}` }}>
          Map failed to load: {error.message}
        </div>
      )}
      <div ref={containerRef} style={{ flex:1, minHeight:400, background:C.page }} />
      <div style={{ padding:'8px 16px', background:C.card, borderTop:`1px solid ${C.border}`, fontSize:11.5, color:C.textSecondary, display:'flex', gap:14 }}>
        <span><b>{placed.toLocaleString()}</b> placed</span>
        <span><b>{missing.toLocaleString()}</b> missing coordinates</span>
        <span><b>{total.toLocaleString()}</b> total</span>
      </div>
    </div>
  )
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch])
}
