import { useEffect, useRef, useState } from 'react'
import { C } from '../data/constants'
import { geocodePropertyNow } from '../data/propertyGeocodeService'

// =====================================================================
// PropertyMapWidget
//
// Salesforce-parity "Maps" card for a property record page. Renders an
// interactive satellite map pinned to the record's stored coordinates
// (property_latitude / property_longitude).
//
// Coordinates arrive from two sources: HUD/LIHTC imports already carry
// lat/long, and a background cron geocodes the rest. But a property the
// user *just* created has neither yet, so rather than show a dead "no
// coordinates" card until the next sweep, this widget geocodes the
// property on demand (geocodePropertyNow → the geocode-property-coordinates
// edge function) the first time the card opens without coordinates, then
// pins the returned point. Addresses the geocoder can't resolve fall back
// to the address + a "Try again" action and the Google Maps link.
//
// Registered as the 'map' page-layout widget type and placed via a
// record layout's "Map" section (see RecordDetail.jsx). Config lives in
// widget_config:
//   {
//     tile_layer: 'satellite' | 'street',  // default base layer (default satellite)
//     zoom:       17,                       // initial zoom (default 17)
//     height:     420,                      // map height in px (default 420)
//     lat_field:  'property_latitude',      // coordinate column overrides
//     lng_field:  'property_longitude',
//   }
//
// Leaflet + tiles load on demand from a CDN — no build-time dependency
// added (mirrors OutreachMap, per the Vite vendor-chunk hazard). Base
// layers: Esri World Imagery (satellite, no API key, looks like Google's
// satellite view) with a place-label reference overlay, plus an
// OpenStreetMap street layer, switchable via the layers control.
// =====================================================================

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
const LEAFLET_JS_URL  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'

const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SATELLITE_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const STREET_TILES    = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

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
    if (!window.L) await injectScript(LEAFLET_JS_URL)
    return window.L
  })()
  return _leafletPromise
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export default function PropertyMapWidget({ widget, record, tableName, embedded = false }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const [error, setError] = useState(null)

  const cfg       = widget?.widget_config || {}
  const latField  = cfg.lat_field || 'property_latitude'
  const lngField  = cfg.lng_field || 'property_longitude'
  const baseLayer = cfg.tile_layer === 'street' ? 'street' : 'satellite'
  const zoom      = toNumber(cfg.zoom) || 17
  const height    = toNumber(cfg.height) || 420

  const storedLat = toNumber(record?.[latField])
  const storedLng = toNumber(record?.[lngField])
  const hasStoredCoords = storedLat !== null && storedLng !== null

  // On-demand geocoding. Only for the properties table pinned by the default
  // coordinate columns — a custom lat/lng mapping on another object has no
  // geocode pipeline and must not trigger one.
  const recordId    = record?.id
  const canGeocode  = tableName === 'properties' && !!recordId &&
                      latField === 'property_latitude' && lngField === 'property_longitude'
  const priorStatus = record?.property_geocode_status

  const [resolved,   setResolved]   = useState(null)   // { lat, lng } from an on-demand geocode
  const [geoPhase,   setGeoPhase]   = useState('idle') // 'idle' | 'locating' | 'no_match' | 'error'
  const [geoMessage, setGeoMessage] = useState(null)
  const attemptedRef = useRef(false)

  const runGeocode = async () => {
    setGeoPhase('locating')
    setGeoMessage(null)
    const res = await geocodePropertyNow(recordId)
    if (res.matched) {
      setResolved({ lat: res.lat, lng: res.lng })
      setGeoPhase('idle')
    } else if (res.error) {
      setGeoPhase('error')
      setGeoMessage(res.error)
    } else {
      setGeoPhase('no_match')
      setGeoMessage(res.reason || null)
    }
  }

  // First open without coordinates: geocode automatically. Skip properties the
  // geocoder already failed on (status 'Geocode No Match') so we don't re-hammer
  // it on every page view — those get the manual "Try again" action instead.
  useEffect(() => {
    if (!canGeocode || hasStoredCoords || resolved || attemptedRef.current) return
    if (priorStatus === 'Geocode No Match') { setGeoPhase('no_match'); return }
    attemptedRef.current = true
    runGeocode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGeocode, hasStoredCoords, recordId])

  // Effective coordinates: stored on the record, else the on-demand result.
  const lat = hasStoredCoords ? storedLat : (resolved ? resolved.lat : null)
  const lng = hasStoredCoords ? storedLng : (resolved ? resolved.lng : null)
  const hasCoords = lat !== null && lng !== null

  // Human-readable address (property fields). Used for the marker popup,
  // the fallback card, and the Google Maps link query.
  const addressParts = [
    record?.property_street,
    record?.property_city,
    record?.property_state,
    record?.property_zip,
  ].filter(Boolean)
  const address = addressParts.join(', ')
  const propertyName = record?.property_name || ''

  // Google Maps deep link: exact coordinates when we have them, else an
  // address search. Opens Google's own satellite-capable map in a new tab.
  const gmapsHref = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    : (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null)

  useEffect(() => {
    if (!hasCoords) return undefined
    let cancelled = false

    loadLeaflet()
      .then(L => {
        if (cancelled || !containerRef.current || mapRef.current) return

        const map = L.map(containerRef.current, {
          center: [lat, lng],
          zoom,
          zoomControl: true,
          scrollWheelZoom: false, // avoid hijacking page scroll; users click to interact
        })

        const satellite = L.tileLayer(SATELLITE_TILES, {
          maxZoom: 19,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        })
        const labels = L.tileLayer(SATELLITE_LABELS, { maxZoom: 19 })
        const satelliteGroup = L.layerGroup([satellite, labels])

        const street = L.tileLayer(STREET_TILES, {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        })

        const initial = baseLayer === 'street' ? street : satelliteGroup
        initial.addTo(map)

        L.control.layers(
          { 'Satellite': satelliteGroup, 'Street': street },
          {},
          { position: 'topright', collapsed: true },
        ).addTo(map)

        const marker = L.marker([lat, lng]).addTo(map)
        const popupHtml = `
          <div style="font-family: Inter, sans-serif; font-size: 12px; min-width:160px; max-width:240px;">
            ${propertyName ? `<div style="font-weight:600; color:#0d1a2e; margin-bottom:3px;">${escapeHtml(propertyName)}</div>` : ''}
            ${address ? `<div style="color:#4a5e7a;">${escapeHtml(address)}</div>` : ''}
          </div>`
        if (propertyName || address) marker.bindPopup(popupHtml)

        mapRef.current = map

        // Leaflet mis-measures its container when it initializes inside a
        // freshly-mounted card (height still settling). A deferred
        // invalidateSize corrects the tile layout.
        setTimeout(() => { if (!cancelled && mapRef.current) mapRef.current.invalidateSize() }, 60)
      })
      .catch(e => { if (!cancelled) setError(e) })

    return () => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [hasCoords, lat, lng, zoom, baseLayer, address, propertyName])

  const title = widget?.widget_title || 'Property Location'

  const gmapsLink = gmapsHref && (
    <a href={gmapsHref} target="_blank" rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 500, color: C.emeraldMid || '#2aab72',
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
      </svg>
      Open in Google Maps
    </a>
  )

  const errorBar = error && (
    <div style={{ padding: '10px 16px', background: '#e8f1fb', color: '#1e466b', fontSize: 12 }}>
      Map failed to load: {error.message}
    </div>
  )

  const retryButton = canGeocode && (
    <button type="button" onClick={runGeocode} disabled={geoPhase === 'locating'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
        padding: '6px 12px', fontSize: 12, fontWeight: 500,
        color: C.emeraldMid || '#2aab72', background: C.card,
        border: `1px solid ${C.borderDark || '#d0d8e8'}`, borderRadius: 6,
        cursor: geoPhase === 'locating' ? 'default' : 'pointer', fontFamily: 'inherit',
      }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
      {geoPhase === 'locating' ? 'Locating…' : 'Try again'}
    </button>
  )

  let body
  if (hasCoords) {
    // position:relative + isolation contain Leaflet's z-indexes (up to 1000)
    // so tiles never paint over app overlays like the LEAP Assistant panel.
    body = (
      <div ref={containerRef} style={{ width: '100%', height, background: C.page, position: 'relative', zIndex: 0, isolation: 'isolate' }} />
    )
  } else if (geoPhase === 'locating') {
    body = (
      <div style={{ padding: '24px 16px', fontSize: 12.5, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 15, height: 15, borderRadius: '50%',
          border: `2px solid ${C.border}`, borderTopColor: C.emerald || '#3ecf8e',
          display: 'inline-block', animation: 'leapMapSpin 0.7s linear infinite',
        }} />
        <span>Locating this property on the map…</span>
        <style>{'@keyframes leapMapSpin{to{transform:rotate(360deg)}}'}</style>
      </div>
    )
  } else {
    // No coordinates: geocoder found no match, errored, or this isn't a
    // geocodable property. Show the address and (when possible) a retry.
    const message = geoPhase === 'error'
      ? (geoMessage || 'Couldn’t reach the geocoder just now.')
      : geoPhase === 'no_match'
        ? 'This address couldn’t be located automatically.'
        : 'This property has no map coordinates yet, so it can’t be pinned.'
    body = (
      <div style={{ padding: '20px 16px', fontSize: 12.5, color: C.textSecondary, lineHeight: 1.6 }}>
        <div style={{ color: C.textMuted, marginBottom: address ? 6 : 0 }}>{message}</div>
        {address && <div style={{ color: C.textPrimary }}>{address}</div>}
        {retryButton}
      </div>
    )
  }

  // Embedded: rendered inside a page-layout Section card, which already
  // supplies the titled card chrome. Render bare — the map full-bleed with
  // a thin action bar for the Google Maps link.
  if (embedded) {
    return (
      <div>
        {errorBar}
        {body}
        {gmapsHref && (
          <div style={{
            padding: '8px 14px', borderTop: `1px solid ${C.border}`,
            display: 'flex', justifyContent: 'flex-end', background: C.cardSecondary || '#f7f9fc',
          }}>
            {gmapsLink}
          </div>
        )}
      </div>
    )
  }

  // Standalone: full card with its own titled header.
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        background: C.cardSecondary || '#f7f9fc',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{title}</div>
        {gmapsLink}
      </div>
      {errorBar}
      {body}
    </div>
  )
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch])
}
