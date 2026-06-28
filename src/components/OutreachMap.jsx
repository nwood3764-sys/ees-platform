import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'

// =====================================================================
// OutreachMap
//
// Leaflet-backed pin map for the Outreach Map view. Loads Leaflet
// and its markercluster plugin on demand from a public CDN — no
// build-time dependency added (per the Vite hazard memory about
// circular vendor chunks when introducing new shared deps).
//
// Features:
//   - Marker clustering via Leaflet.markercluster: cluster radius
//     scales with zoom; clusters spiderfy at the lowest zoom level.
//     Color intensity bands at 10 / 100 / 500 markers per cluster.
//   - Auto-fit bounds to the supplied properties on first non-empty
//     render. Subsequent prop changes do NOT reset the user's view —
//     panning around to look at a specific region shouldn't jump
//     back to the country view when filters update.
//   - onBoundsChange callback fires after every moveend (with a small
//     debounce). Parent uses this to filter a list of "visible
//     properties" alongside the map.
//   - Marker popup: name, address, units, account, HUD ID + an Open
//     property button that calls onOpenProperty(id).
// =====================================================================

const LEAFLET_CSS_URL          = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS_URL           = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
const CLUSTER_CSS_URL          = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'
const CLUSTER_DEFAULT_CSS_URL  = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
const CLUSTER_JS_URL           = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'

let _leafletPromise = null

function injectCss(href) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('No document')); return }
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === '1') { resolve(); return }
      existing.addEventListener('load',  () => resolve())
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.addEventListener('load',  () => { s.dataset.loaded = '1'; resolve() })
    s.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
    document.head.appendChild(s)
  })
}

async function loadLeaflet() {
  if (_leafletPromise) return _leafletPromise
  _leafletPromise = (async () => {
    if (typeof window === 'undefined') throw new Error('No window')
    injectCss(LEAFLET_CSS_URL)
    injectCss(CLUSTER_CSS_URL)
    injectCss(CLUSTER_DEFAULT_CSS_URL)
    if (!window.L) await injectScript(LEAFLET_JS_URL)
    if (!window.L?.markerClusterGroup) await injectScript(CLUSTER_JS_URL)
    return window.L
  })()
  return _leafletPromise
}

// Custom cluster icon — LEAP design-system palette. Density reads as an
// emerald-to-blue gradient (low → high count): emerald, emerald-mid, sky
// blue, deep navy-blue. No red/orange. Four size bands.
function makeClusterIcon(L) {
  return (cluster) => {
    const count = cluster.getChildCount()
    let cls = 'leap-cluster-sm'
    let size = 32
    if (count >= 500)      { cls = 'leap-cluster-lg'; size = 52 }
    else if (count >= 100) { cls = 'leap-cluster-md'; size = 44 }
    else if (count >= 10)  { cls = 'leap-cluster-sm-plus'; size = 36 }
    return L.divIcon({
      html: `<div class="leap-cluster ${cls}"><span>${count}</span></div>`,
      className: 'leap-cluster-wrap',
      iconSize: L.point(size, size),
    })
  }
}

function ensureClusterStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('leap-cluster-styles')) return
  const style = document.createElement('style')
  style.id = 'leap-cluster-styles'
  style.textContent = `
    .leap-cluster-wrap { background: transparent !important; border: none !important; }
    .leap-cluster {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%; border-radius: 50%;
      color: #fff; font-family: Inter, sans-serif; font-weight: 700; font-size: 13px;
      box-shadow: 0 2px 8px rgba(7,17,31,0.35);
      border: 2px solid rgba(255,255,255,0.9);
    }
    .leap-cluster.leap-cluster-sm      { background: rgba(62,207,142,0.85); font-size: 12px; }
    .leap-cluster.leap-cluster-sm-plus { background: rgba(42,171,114,0.92); font-size: 12.5px; }
    .leap-cluster.leap-cluster-md      { background: rgba(126,179,232,0.95); }
    .leap-cluster.leap-cluster-lg      { background: rgba(30,70,107,0.95); font-size: 14px; }
    .leap-cluster:hover { transform: scale(1.06); transition: transform 120ms ease; }
  `
  document.head.appendChild(style)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch])
}

export function OutreachMap({ properties, onOpenProperty, onBoundsChange }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const clusterRef   = useRef(null)
  const fitDoneRef   = useRef(false)
  const boundsCbRef  = useRef(onBoundsChange)
  const openCbRef    = useRef(onOpenProperty)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  // Keep callback refs current so we don't tear down/rebuild the map
  // every time a parent re-renders with a new function identity.
  useEffect(() => { boundsCbRef.current = onBoundsChange }, [onBoundsChange])
  useEffect(() => { openCbRef.current   = onOpenProperty },  [onOpenProperty])

  // Initialize Leaflet + cluster plugin once.
  useEffect(() => {
    let cancelled = false
    ensureClusterStyles()
    loadLeaflet()
      .then(L => {
        if (cancelled || !containerRef.current || mapRef.current) return
        const map = L.map(containerRef.current, {
          center: [39.8283, -98.5795],
          zoom: 4,
          zoomControl: true,
          attributionControl: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap contributors',
        }).addTo(map)

        const cluster = L.markerClusterGroup({
          iconCreateFunction: makeClusterIcon(L),
          showCoverageOnHover: false,
          maxClusterRadius: 60,
          spiderfyOnMaxZoom: true,
          disableClusteringAtZoom: 16,
        })
        cluster.addTo(map)
        mapRef.current     = map
        clusterRef.current = cluster

        // Bounds change handler — debounced via setTimeout chain.
        let pending = null
        const fire = () => {
          if (!boundsCbRef.current) return
          const b = map.getBounds()
          boundsCbRef.current({
            south: b.getSouth(), west: b.getWest(),
            north: b.getNorth(), east: b.getEast(),
            zoom:  map.getZoom(),
          })
        }
        map.on('moveend zoomend', () => {
          if (pending) clearTimeout(pending)
          pending = setTimeout(fire, 120)
        })

        setReady(true)
      })
      .catch(e => { if (!cancelled) setError(e) })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        clusterRef.current = null
        fitDoneRef.current = false
      }
    }
  }, [])

  // Re-render markers whenever the filtered properties prop changes.
  useEffect(() => {
    if (!ready) return
    const L = window.L
    if (!L || !mapRef.current || !clusterRef.current) return

    clusterRef.current.clearLayers()

    const valid = (properties || []).filter(p =>
      typeof p.latitude  === 'number' && !Number.isNaN(p.latitude) &&
      typeof p.longitude === 'number' && !Number.isNaN(p.longitude)
    )

    // Build markers in bulk for performance.
    const layers = valid.map(p => {
      const m = L.marker([p.latitude, p.longitude])
      m.bindPopup(`
        <div style="font-family: Inter, sans-serif; font-size: 12px; min-width:180px; max-width:240px;">
          <div style="font-weight:600; color:#0d1a2e; margin-bottom:4px;">${escapeHtml(p.name || 'Unnamed property')}</div>
          <div style="color:#4a5e7a; margin-bottom:6px;">${escapeHtml(p.address || '')}${p.state ? ', ' + escapeHtml(p.state) : ''}</div>
          ${p.units    ? `<div style="color:#4a5e7a;">Units: <b>${p.units}</b></div>` : ''}
          ${p.account  ? `<div style="color:#4a5e7a;">Account: <b>${escapeHtml(p.account)}</b></div>` : ''}
          ${p.hudPropertyId ? `<div style="color:#4a5e7a; font-family:'JetBrains Mono', monospace;">HUD ${escapeHtml(p.hudPropertyId)}</div>` : ''}
          <button data-leap-open-property="${p._id}" style="margin-top:8px; padding:5px 10px; background:#3ecf8e; color:#fff; border:none; border-radius:4px; font-size:11px; font-weight:600; cursor:pointer;">Open property →</button>
        </div>
      `)
      return m
    })
    clusterRef.current.addLayers(layers)

    // Auto-fit only the first time we have rows — preserve user's
    // zoom/pan on subsequent filter changes.
    if (!fitDoneRef.current && valid.length > 0) {
      try {
        const group = L.featureGroup(layers)
        const bounds = group.getBounds()
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 })
          fitDoneRef.current = true
        }
      } catch { /* ignore */ }
    }

    // Force a bounds-change emission so the parent's visible-list
    // syncs even before the user pans.
    if (boundsCbRef.current) {
      const b = mapRef.current.getBounds()
      boundsCbRef.current({
        south: b.getSouth(), west: b.getWest(),
        north: b.getNorth(), east: b.getEast(),
        zoom:  mapRef.current.getZoom(),
      })
    }
  }, [properties, ready])

  // Delegate clicks on the popup's Open button (Leaflet renders the
  // popup HTML inside the map container — event delegation here picks
  // up the click without us needing to hand each marker a JSX node).
  useEffect(() => {
    if (!ready) return
    const container = containerRef.current
    if (!container) return
    const handler = (e) => {
      const t = e.target
      if (t && t.dataset && t.dataset.leapOpenProperty && openCbRef.current) {
        openCbRef.current(t.dataset.leapOpenProperty)
      }
    }
    container.addEventListener('click', handler)
    return () => container.removeEventListener('click', handler)
  }, [ready])

  const total = properties?.length ?? 0
  const placed = (properties || []).filter(p =>
    typeof p.latitude  === 'number' && !Number.isNaN(p.latitude) &&
    typeof p.longitude === 'number' && !Number.isNaN(p.longitude)
  ).length
  const missing = total - placed

  return (
    <div style={{ display:'flex', flexDirection:'column', flex:1, overflow:'hidden' }}>
      {error && (
        <div style={{ padding:'10px 16px', background:'#e8f1fb', color:'#1e466b', fontSize:12, borderBottom:`1px solid ${C.border}` }}>
          Map failed to load: {error.message}
        </div>
      )}
      <div ref={containerRef} style={{ flex:1, minHeight:300, background:C.page }} />
      <div style={{ padding:'6px 16px', background:C.card, borderTop:`1px solid ${C.border}`, fontSize:11, color:C.textSecondary, display:'flex', gap:14 }}>
        <span><b>{placed.toLocaleString()}</b> placed</span>
        {missing > 0 && <span><b>{missing.toLocaleString()}</b> missing coordinates</span>}
        <span style={{ marginLeft:'auto', fontStyle:'italic' }}>Pan and zoom to explore. The list updates with what you see.</span>
      </div>
    </div>
  )
}
