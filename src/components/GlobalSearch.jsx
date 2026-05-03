/**
 * Global Search — Salesforce-style universal search across all major Anura
 * objects. Backed by the public.global_search RPC which returns up to 5
 * matches per object type (in the dropdown) or up to 200 (on the dedicated
 * results page) from 17 tables.
 *
 * UI shape: a real text input the user clicks into and types directly,
 * with results appearing in a dropdown panel anchored below the bar.
 * Salesforce, GitHub, Linear all use this pattern. Earlier iterations of
 * this file used a click-to-open modal — that was replaced because users
 * found the constant overlay disruptive.
 *
 * Exports:
 *   • GlobalSearchInline    — the bar + dropdown component. Always rendered
 *                             on desktop; on mobile it's a slide-down below
 *                             MobileHeader, gated by the `mobileOpen` prop.
 *   • SEARCH_OBJECT_ICONS, ObjectIcon, SearchResultRow,
 *     SEARCH_GROUP_ORDER, SEARCH_GROUP_LABELS, SEARCH_OBJECT_TABLES
 *                           — exported helpers reused by the dedicated
 *                             SearchResultsPage so both surfaces render hits
 *                             identically.
 *
 * Wiring (App.jsx):
 *   const searchInputRef = useRef(null)
 *   const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
 *
 *   // Cmd/Ctrl+K → focus input on desktop, slide-down on mobile.
 *   useEffect(() => {
 *     const onKey = e => {
 *       if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
 *         e.preventDefault()
 *         if (isMobile) setMobileSearchOpen(true)
 *         else searchInputRef.current?.focus()
 *       }
 *     }
 *     document.addEventListener('keydown', onKey)
 *     return () => document.removeEventListener('keydown', onKey)
 *   }, [isMobile])
 *
 *   <GlobalSearchInline
 *     inputRef={searchInputRef}
 *     mobileOpen={mobileSearchOpen}
 *     onCloseMobile={() => setMobileSearchOpen(false)}
 *     onNavigate={navigateToRecord}
 *     onViewAll={(q) => navigateToSearch(q)}
 *   />
 *
 * Result navigation: passes { table, id, mode: 'view' } to onNavigate, the
 * shape urlNav.useUrlNavigation().navigateToRecord accepts. The RPC's
 * table_name column already matches TABLE_MODULE_MAP keys.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../data/constants'
import { useIsMobile } from '../lib/useMediaQuery'
import { supabase } from '../lib/supabase'

// ─── Object type → icon path (lucide-style single-stroke paths) ──────────────
// Keep paths single-d so they render through the existing Icon convention.
// Order also defines display order in the result list when an object_type's
// label needs a default sort priority.
export const SEARCH_OBJECT_ICONS = {
  account:               'M3 21h18 M5 21V7l8-4 8 4v14 M9 9h.01 M9 13h.01 M9 17h.01 M14 9h.01 M14 13h.01 M14 17h.01',
  contact:               'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M16 7a4 4 0 11-8 0 4 4 0 018 0z',
  property:              'M3 21h18 M3 9l9-7 9 7v12H3V9z M9 21V13h6v8',
  building:              'M3 21h18 M5 21V7h14v14 M9 9h2 M9 13h2 M9 17h2 M13 9h2 M13 13h2 M13 17h2',
  unit:                  'M3 12l9-9 9 9 M5 10v11h14V10 M10 21v-7h4v7',
  opportunity:           'M3 17l6-6 4 4 7-7 M14 8h7v7',
  project:               'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  work_order:            'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  incentive_application: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
  assessment:            'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  program:               'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z M7 7h.01',
  vehicle:               'M1 3h15v13H1z M16 8h4l3 3v5h-7V8z M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z M18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  equipment:             'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
  product_item:          'M16.5 9.4l-9-5.19 M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
  user:                  'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M16 7a4 4 0 11-8 0 4 4 0 018 0z',
  envelope:              'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z M22 6l-10 7L2 6',
  service_appointment:   'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z M16 2v4 M8 2v4 M3 10h18',
}

// Keep group order stable across renders. Mirrors the user's mental model:
// people / places / pipeline / execution / financial / inventory / admin.
// Exported for reuse by the full SearchResultsPage module — both surfaces
// must show object types in the same order.
export const SEARCH_GROUP_ORDER = [
  'account', 'contact', 'property', 'building', 'unit',
  'opportunity', 'project', 'work_order', 'service_appointment',
  'incentive_application', 'assessment', 'envelope',
  'program', 'vehicle', 'equipment', 'product_item', 'user',
]

// Backwards-compatible alias for the old internal name. Once nothing else
// in this file references GROUP_ORDER, this can be removed.
const GROUP_ORDER = SEARCH_GROUP_ORDER

// Display label fallback when a row has no object_label but we know its type.
// The RPC always sets object_label, but the SearchResultsPage builds the
// sidebar from a static list — it needs labels even for types with zero
// matching rows so that the user can click in to see "no matches" cleanly.
export const SEARCH_GROUP_LABELS = {
  account:               'Accounts',
  contact:               'Contacts',
  property:              'Properties',
  building:              'Buildings',
  unit:                  'Units',
  opportunity:           'Opportunities',
  project:               'Projects',
  work_order:            'Work Orders',
  service_appointment:   'Service Appointments',
  incentive_application: 'Incentive Applications',
  assessment:            'Assessments',
  envelope:              'Signature Envelopes',
  program:               'Programs',
  vehicle:               'Vehicles',
  equipment:             'Equipment',
  product_item:          'Product Items',
  user:                  'Users',
}

// Mapping object_type → table_name (matches the RPC's table_name column).
// Used by the SearchResultsPage when it needs to navigate to a record but
// only has the object_type (e.g. from URL ?type=). The RPC itself always
// includes table_name on every row, so this map is only consulted when
// nothing has been fetched yet.
export const SEARCH_OBJECT_TABLES = {
  account:               'accounts',
  contact:               'contacts',
  property:              'properties',
  building:              'buildings',
  unit:                  'units',
  opportunity:           'opportunities',
  project:               'projects',
  work_order:            'work_orders',
  service_appointment:   'service_appointments',
  incentive_application: 'incentive_applications',
  assessment:            'assessments',
  envelope:              'envelopes',
  program:               'programs',
  vehicle:               'vehicles',
  equipment:             'equipment',
  product_item:          'product_items',
  user:                  'users',
}

export function ObjectIcon({ type, size = 14, color = C.textSecondary }) {
  const path = SEARCH_OBJECT_ICONS[type]
  if (!path) return null
  // Multi-segment paths (e.g. envelope) need to be split on "M" runs so each
  // subpath gets its own <path>. We split, then re-prefix every fragment
  // except the first with the leading "M" we just consumed.
  const parts = path.split(/\s(?=M)/)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {parts.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

// Shared row renderer. Both the modal and the SearchResultsPage render
// individual hits this way so the user sees the same visual record across
// surfaces. `active` toggles the selected highlight (used only in the
// modal's keyboard nav). `compact` shrinks padding for the modal density.
export function SearchResultRow({ row, active = false, compact = false, onSelect, onMouseEnter }) {
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={() => onSelect?.(row)}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: compact ? '10px 16px' : '12px 16px',
        background: active ? '#e9f7ef' : C.card,
        borderLeft: active ? `3px solid ${C.emerald}` : '3px solid transparent',
        cursor: 'pointer',
        transition: 'background 80ms',
      }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 6,
        background: C.page, border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <ObjectIcon type={row.object_type} size={14} color={C.textSecondary} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: C.textPrimary, fontSize: 13.5, fontWeight: 500,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {row.primary_label || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Unnamed</span>}
        </div>
        {row.secondary_label && (
          <div style={{
            color: C.textMuted, fontSize: 12, marginTop: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {row.secondary_label}
          </div>
        )}
      </div>
      {row.record_number && (
        <span style={{
          flexShrink: 0,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11, color: C.textSecondary,
          background: C.page, border: `1px solid ${C.border}`,
          padding: '2px 7px', borderRadius: 4,
        }}>
          {row.record_number}
        </span>
      )}
    </div>
  )
}

// ─── Module/Cmd hint pill ────────────────────────────────────────────────────
function KeyHint({ children }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 18, height: 18, padding: '0 5px',
      background: C.page, border: `1px solid ${C.border}`, borderRadius: 4,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
      color: C.textMuted, lineHeight: 1,
    }}>{children}</kbd>
  )
}

// Detect mac at module load for Cmd/Ctrl hint label.
const IS_MAC = typeof navigator !== 'undefined'
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '')

// ─── Inline search bar ───────────────────────────────────────────────────────
// One component for both desktop and mobile. Replaces the old click-to-open-
// modal pattern: the user clicks directly into the input and types. Results
// appear in a dropdown panel anchored below the bar (portal + position:fixed
// so the parent overflow:hidden doesn't clip it).
//
// On desktop the bar is always rendered (44px below the MobileHeader slot).
// On mobile the bar slides down only when `mobileOpen` is true — the
// MobileHeader's magnifier icon toggles it.
//
// Props:
//   inputRef       — optional. Caller (App.jsx) keeps a ref so a global
//                    Cmd/Ctrl+K listener can focus the input directly.
//   mobileOpen     — only meaningful on mobile. Controls slide-down
//                    visibility. Ignored on desktop (always visible).
//   onCloseMobile  — called when the user dismisses the mobile slide-down
//                    via the X button or Esc.
//   onNavigate     — { table, id, mode } — pass to urlNav.navigateToRecord.
//   onViewAll      — (query) => void. Hooked to the "View all results"
//                    CTA at the bottom of the dropdown.
export function GlobalSearchInline({
  inputRef: inputRefProp,
  mobileOpen = false,
  onCloseMobile,
  onNavigate,
  onViewAll,
}) {
  const isMobile = useIsMobile()
  const internalInputRef = useRef(null)
  const inputRef = inputRefProp || internalInputRef
  const barRef = useRef(null)
  const dropdownRef = useRef(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [open, setOpen] = useState(false)   // dropdown visibility
  const [barRect, setBarRect] = useState(null)

  // Debounced + abortable search.
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)

  // ─── Dropdown positioning ─────────────────────────────────────────────────
  // The bar lives inside a flex column with overflow:hidden, so a normal
  // absolutely-positioned dropdown would get clipped. Instead the dropdown
  // is portaled to body with position:fixed using the bar's viewport rect.
  // Recompute on open and on window resize. No scroll listener — the bar
  // itself doesn't scroll (it's in the fixed app-chrome region), only the
  // inner module does.
  useEffect(() => {
    if (!open) return
    const measure = () => {
      if (barRef.current) setBarRect(barRef.current.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Close dropdown when sidebar collapse / window-resize / mobile-toggle
  // changes the bar size out from under us. Same effect as the resize
  // listener above but also fires when the bar mounts/unmounts.
  useEffect(() => {
    if (!barRef.current || !open) return
    const ro = new ResizeObserver(() => {
      if (barRef.current) setBarRect(barRef.current.getBoundingClientRect())
    })
    ro.observe(barRef.current)
    return () => ro.disconnect()
  }, [open])

  // ─── Click outside to close ───────────────────────────────────────────────
  // Bar click and dropdown click both keep the dropdown open. Anywhere else
  // closes it. The input itself stays focused — only the dropdown hides.
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (barRef.current?.contains(e.target)) return
      if (dropdownRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  // Esc closes dropdown (and on mobile, dismisses the slide-down too).
  // Up/Down move selection within the result list. Enter opens the active
  // hit. Listening on document is fine because we only act when open.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
        if (isMobile) onCloseMobile?.()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(i + 1, Math.max(results.length - 1, 0)))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        const r = results[activeIdx]
        if (r) {
          e.preventDefault()
          handleSelectRow(r)
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, activeIdx, isMobile])

  // ─── Mobile: focus input as the slide-down opens ──────────────────────────
  useEffect(() => {
    if (isMobile && mobileOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, mobileOpen])

  // ─── Run the search ───────────────────────────────────────────────────────
  // 180ms debounce so a typist's keystrokes coalesce into a single round
  // trip. Stale-response guard via reqIdRef.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const myReq = ++reqIdRef.current
      const { data, error } = await supabase.rpc('global_search', {
        p_query: trimmed,
        p_limit_per_object: 5,
      })
      if (myReq !== reqIdRef.current) return
      if (error) {
        setError(error.message || 'Search failed')
        setResults([])
        setLoading(false)
        return
      }
      setResults(Array.isArray(data) ? data : [])
      setActiveIdx(0)
      setLoading(false)
      setError(null)
    }, 180)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  // Group results for display. Same logic the modal used.
  const groups = useMemo(() => {
    if (!results.length) return []
    const byType = new Map()
    for (const r of results) {
      const arr = byType.get(r.object_type) || []
      arr.push(r)
      byType.set(r.object_type, arr)
    }
    const known = SEARCH_GROUP_ORDER.filter(t => byType.has(t))
    const extras = [...byType.keys()].filter(t => !SEARCH_GROUP_ORDER.includes(t)).sort()
    return [...known, ...extras].map(type => ({
      type,
      label: byType.get(type)[0]?.object_label || type,
      table: byType.get(type)[0]?.table_name || type,
      rows: byType.get(type),
    }))
  }, [results])

  const flatRows = useMemo(() => groups.flatMap(g => g.rows), [groups])
  const safeActiveIdx = Math.min(activeIdx, Math.max(flatRows.length - 1, 0))

  const handleSelectRow = (r) => {
    onNavigate?.({ table: r.table_name, id: r.id, mode: 'view' })
    // Close the dropdown but keep the query — user might want to refine.
    setOpen(false)
    if (isMobile) onCloseMobile?.()
  }

  const handleViewAll = () => {
    const trimmed = query.trim()
    if (!trimmed) return
    onViewAll?.(trimmed)
    setOpen(false)
    if (isMobile) onCloseMobile?.()
  }

  // ─── Mobile gating ────────────────────────────────────────────────────────
  // On mobile we only render when the user has opened the slide-down via
  // MobileHeader's magnifier. Desktop renders the bar inline always.
  if (isMobile && !mobileOpen) return null

  // The bar itself (input + magnifier + spinner). Rendered both desktop
  // and mobile; only the surrounding chrome differs.
  const bar = (
    <div
      ref={barRef}
      style={{
        flexShrink: 0,
        height: 44,
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? '0 8px' : '0 16px',
      }}
    >
      <div style={{
        width: '100%', maxWidth: isMobile ? 'none' : 560, height: 30,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 10px',
        background: C.page,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={isMobile
            ? 'Search Anura…'
            : 'Search accounts, projects, work orders, properties…'}
          aria-label="Search Anura"
          style={{
            flex: 1,
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 13.5, color: C.textPrimary,
            fontFamily: 'inherit',
            minWidth: 0,
          }}
        />
        {loading && (
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            border: `2px solid ${C.border}`, borderTopColor: C.emerald,
            animation: 'ees-spin 0.7s linear infinite',
            flexShrink: 0,
          }} />
        )}
        {/* Clear button when there's a query */}
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus(); setOpen(true) }}
            aria-label="Clear search"
            tabIndex={-1}
            style={{
              flexShrink: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 2, color: C.textMuted, lineHeight: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18 M6 6l12 12" />
            </svg>
          </button>
        )}
        {/* Cmd/Ctrl+K hint pills only on desktop, only when not focused */}
        {!isMobile && !open && !query && (
          <>
            <KeyHint>{IS_MAC ? '⌘' : 'Ctrl'}</KeyHint>
            <KeyHint>K</KeyHint>
          </>
        )}
        {/* Mobile close button — dismisses the slide-down entirely */}
        {isMobile && (
          <button
            onClick={() => { setOpen(false); onCloseMobile?.() }}
            aria-label="Close search"
            style={{
              flexShrink: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 2, color: C.textMuted, lineHeight: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18 M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )

  // The dropdown panel — portaled to body, position:fixed, anchored to
  // the bar's viewport coordinates. Only rendered when open AND we have
  // measurements. For mobile the dropdown is full-width across the
  // viewport rather than tied to a maxWidth.
  const dropdown = open && barRect ? createPortal(
    <div
      ref={dropdownRef}
      role="listbox"
      style={{
        position: 'fixed',
        top: barRect.bottom + 4,
        left: isMobile ? 8 : barRect.left + (barRect.width - Math.min(barRect.width, 560)) / 2,
        width: isMobile ? 'calc(100vw - 16px)' : Math.min(barRect.width - 32, 560),
        maxHeight: 'min(70vh, 540px)',
        background: C.card,
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        boxShadow: '0 14px 38px rgba(7,17,31,0.14), 0 2px 6px rgba(7,17,31,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 9000,
        animation: 'ees-rise 120ms ease',
      }}
    >
      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', background: C.page }}>
        {/* Empty / hint state */}
        {query.trim().length < 2 && !loading && (
          <div style={{
            padding: '24px 20px',
            textAlign: 'center', color: C.textMuted, fontSize: 13,
          }}>
            <div style={{ marginBottom: 6, color: C.textSecondary, fontWeight: 500, fontSize: 13.5 }}>
              Start typing to search
            </div>
            Type at least 2 characters to find accounts, contacts, properties,
            opportunities, projects, work orders, and more.
            <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              <ExampleChip text="PROJ-00001" onClick={() => { setQuery('PROJ-00001'); inputRef.current?.focus() }} />
              <ExampleChip text="willow" onClick={() => { setQuery('willow'); inputRef.current?.focus() }} />
              <ExampleChip text="IRA HOMES" onClick={() => { setQuery('IRA HOMES'); inputRef.current?.focus() }} />
            </div>
          </div>
        )}

        {error && (
          <div style={{ padding: 14, color: C.danger, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* No results */}
        {query.trim().length >= 2 && !loading && !error && groups.length === 0 && (
          <div style={{
            padding: '32px 20px', textAlign: 'center',
            color: C.textMuted, fontSize: 13,
          }}>
            <div style={{ color: C.textSecondary, fontWeight: 500, fontSize: 13.5, marginBottom: 4 }}>
              No matches for "{query.trim()}"
            </div>
            Check spelling or search by record number (e.g. PROJ-00001).
          </div>
        )}

        {/* Grouped results */}
        {groups.map(group => (
          <ResultGroup
            key={group.type}
            group={group}
            flatRows={flatRows}
            activeIdx={safeActiveIdx}
            onSelect={handleSelectRow}
            onHover={(idx) => setActiveIdx(idx)}
          />
        ))}

        {/* View all results CTA */}
        {groups.length > 0 && onViewAll && (
          <button
            onClick={handleViewAll}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '12px 16px',
              background: C.card,
              border: 'none',
              borderTop: `1px solid ${C.border}`,
              color: C.emerald,
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f4fbf7' }}
            onMouseLeave={e => { e.currentTarget.style.background = C.card }}
          >
            View all results for "{query.trim()}"
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14 M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Footer kbd hints — desktop only */}
      {!isMobile && groups.length > 0 && (
        <div style={{
          flexShrink: 0,
          padding: '7px 14px',
          background: C.card,
          borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 11, color: C.textMuted,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <KeyHint>↑</KeyHint><KeyHint>↓</KeyHint> navigate
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <KeyHint>↵</KeyHint> open
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <KeyHint>esc</KeyHint> close
          </span>
          <span style={{ marginLeft: 'auto' }}>
            {flatRows.length > 0 && `${flatRows.length} result${flatRows.length === 1 ? '' : 's'}`}
          </span>
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <>
      {bar}
      {dropdown}
      {/* Local keyframes — same names as elsewhere in the app */}
      <style>{`
        @keyframes ees-rise { from { transform: translateY(-6px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes ees-spin { to { transform: rotate(360deg) } }
      `}</style>
    </>
  )
}

// ─── Result group ────────────────────────────────────────────────────────────
function ResultGroup({ group, flatRows, activeIdx, onSelect, onHover }) {
  // Find the absolute starting index of this group inside the flat row list.
  // Required because activeIdx is global (cross-group) for keyboard nav.
  const startIdx = flatRows.indexOf(group.rows[0])
  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <div style={{
        padding: '8px 16px 6px',
        fontSize: 11, fontWeight: 600,
        color: C.textMuted, letterSpacing: 0.4,
        textTransform: 'uppercase',
        background: C.page,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <ObjectIcon type={group.type} size={12} color={C.textMuted} />
        <span>{group.label}</span>
        <span style={{ color: C.textMuted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          ({group.rows.length})
        </span>
      </div>
      {group.rows.map((r, idx) => {
        const flatIndex = startIdx + idx
        const active = flatIndex === activeIdx
        return (
          <div
            key={`${r.table_name}:${r.id}`}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(r)}
            onMouseEnter={() => onHover(flatIndex)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 16px',
              background: active ? '#e9f7ef' : C.card,
              borderLeft: active ? `3px solid ${C.emerald}` : '3px solid transparent',
              cursor: 'pointer',
              transition: 'background 80ms',
            }}
          >
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: C.page, border: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <ObjectIcon type={r.object_type} size={14} color={C.textSecondary} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                color: C.textPrimary, fontSize: 13.5, fontWeight: 500,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {r.primary_label || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Unnamed</span>}
              </div>
              {r.secondary_label && (
                <div style={{
                  color: C.textMuted, fontSize: 12, marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {r.secondary_label}
                </div>
              )}
            </div>
            {r.record_number && (
              <span style={{
                flexShrink: 0,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11, color: C.textSecondary,
                background: C.page, border: `1px solid ${C.border}`,
                padding: '2px 7px', borderRadius: 4,
              }}>
                {r.record_number}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ExampleChip({ text, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '4px 10px', fontSize: 12, color: C.textSecondary,
        fontFamily: 'inherit', cursor: 'pointer',
      }}
    >
      {text}
    </button>
  )
}
