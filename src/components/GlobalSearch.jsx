/**
 * Global Search — Salesforce-style universal search across all major Anura
 * objects. Backed by the public.global_search RPC which returns up to 5
 * matches per object type from 17 tables.
 *
 * Three exports:
 *   • GlobalSearchTrigger — desktop-only inline bar (renders nothing on mobile;
 *                           the mobile MobileHeader has its own search icon).
 *   • GlobalSearchModal   — the modal itself; rendered always at App level so
 *                           Cmd/Ctrl+K and the mobile header trigger both
 *                           land in one place.
 *   • SEARCH_OBJECT_ICONS — exported for tests / future reuse.
 *
 * State convention (lifted to App):
 *   const [searchOpen, setSearchOpen] = useState(false)
 *   <GlobalSearchTrigger onOpen={() => setSearchOpen(true)} />
 *   <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)}
 *                      onNavigate={navigateToRecord} />
 *   useEffect → bind Cmd/Ctrl+K → setSearchOpen(true)
 *
 * Result navigation: passes { table, id, mode: 'view' } to onNavigate, which
 * is the same shape urlNav.useUrlNavigation().navigateToRecord accepts. The
 * RPC returns the raw table_name (e.g. 'work_orders') which already matches
 * the URL-table convention in TABLE_MODULE_MAP.
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
const GROUP_ORDER = [
  'account', 'contact', 'property', 'building', 'unit',
  'opportunity', 'project', 'work_order', 'service_appointment',
  'incentive_application', 'assessment', 'envelope',
  'program', 'vehicle', 'equipment', 'product_item', 'user',
]

function ObjectIcon({ type, size = 14, color = C.textSecondary }) {
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

// ─── Desktop trigger ─────────────────────────────────────────────────────────
// Renders nothing on mobile — MobileHeader supplies its own search button so
// we don't double-up the affordance.
export function GlobalSearchTrigger({ onOpen }) {
  const isMobile = useIsMobile()
  if (isMobile) return null

  return (
    <div style={{
      flexShrink: 0,
      height: 44,
      background: C.card,
      borderBottom: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px',
    }}>
      <button
        onClick={onOpen}
        aria-label="Search Anura"
        style={{
          width: '100%', maxWidth: 560, height: 30,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 10px',
          background: C.page,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          cursor: 'pointer',
          color: C.textMuted,
          fontSize: 13,
          textAlign: 'left',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderDark }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border }}
      >
        <ObjectIcon type="" size={14} color={C.textMuted} />
        {/* Inline magnifier — small enough to avoid loading a second icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          style={{ marginLeft: -22 }}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <span style={{ flex: 1, marginLeft: 6 }}>Search accounts, projects, work orders, properties…</span>
        <KeyHint>{IS_MAC ? '⌘' : 'Ctrl'}</KeyHint>
        <KeyHint>K</KeyHint>
      </button>
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────
// Always mounted at App level; visible only when `open` is true. The query
// state lives inside so opening + closing fully resets the search session.
export function GlobalSearchModal({ open, onClose, onNavigate }) {
  const isMobile = useIsMobile()
  const inputRef = useRef(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])     // raw rows from RPC
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)  // flat index across all groups

  // Debounced + abortable search. Each keystroke replaces the in-flight call
  // so we never display stale results from a slower earlier query.
  const debounceRef = useRef(null)
  const reqIdRef = useRef(0)

  // Reset everything when the modal closes; leave the close fast — the user
  // expects ESC to feel instant.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setError(null)
      setActiveIdx(0)
      setLoading(false)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open])

  // Autofocus on open. Slight delay to let the modal mount and animations
  // settle — focusing during the same tick fights the portal mount.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [open])

  // Keyboard: Esc to close. Up/Down to move selection. Enter to navigate.
  // Bound at the document level so the input doesn't have to dispatch them.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, Math.max(results.length - 1, 0))); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        const r = results[activeIdx]
        if (r) {
          onNavigate?.({ table: r.table_name, id: r.id, mode: 'view' })
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, results, activeIdx, onClose, onNavigate])

  // Run the RPC. Debounced 180ms so a typist's keystrokes coalesce into a
  // single network round-trip. Empty/short queries clear results but don't
  // hit the wire.
  useEffect(() => {
    if (!open) return
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
      // Guard: if a newer request already started, drop this response.
      if (myReq !== reqIdRef.current) return
      if (error) {
        setError(error.message || 'Search failed')
        setResults([])
        setLoading(false)
        return
      }
      // The RPC already orders within each object_type by match_rank then
      // primary_label. We only need to keep the rows in arrival order.
      setResults(Array.isArray(data) ? data : [])
      setActiveIdx(0)
      setLoading(false)
      setError(null)
    }, 180)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, open])

  // Group results by object_type for rendering. GROUP_ORDER drives display
  // order; any type returned by the RPC but missing from GROUP_ORDER falls
  // to the bottom in alphabetical order.
  const groups = useMemo(() => {
    if (!results.length) return []
    const byType = new Map()
    for (const r of results) {
      const arr = byType.get(r.object_type) || []
      arr.push(r)
      byType.set(r.object_type, arr)
    }
    const known = GROUP_ORDER.filter(t => byType.has(t))
    const extras = [...byType.keys()].filter(t => !GROUP_ORDER.includes(t)).sort()
    return [...known, ...extras].map(type => ({
      type,
      label: byType.get(type)[0]?.object_label || type,
      table: byType.get(type)[0]?.table_name || type,
      rows: byType.get(type),
    }))
  }, [results])

  // Flat row index across groups — needed for keyboard navigation since the
  // user moves through one logical list, not per-group lists.
  const flatRows = useMemo(() => groups.flatMap(g => g.rows), [groups])
  // results state IS the same flat list because the RPC returns ungrouped
  // rows in CTE order. Keep activeIdx scoped to flatRows.length for safety.
  const safeActiveIdx = Math.min(activeIdx, Math.max(flatRows.length - 1, 0))

  if (!open) return null

  // ─── Modal layout ─────────────────────────────────────────────────────────
  // Desktop: centered card pinned ~80px from top. Mobile: full-screen sheet.
  const overlay = (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(7, 17, 31, 0.45)',
        display: 'flex',
        alignItems: isMobile ? 'stretch' : 'flex-start',
        justifyContent: 'center',
        padding: isMobile ? 0 : '80px 16px 16px',
        animation: 'ees-fade-in 120ms ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Search"
        style={{
          width: isMobile ? '100%' : '100%',
          maxWidth: isMobile ? 'none' : 640,
          maxHeight: isMobile ? '100%' : 'calc(100vh - 96px)',
          background: C.card,
          borderRadius: isMobile ? 0 : 10,
          border: `1px solid ${C.border}`,
          boxShadow: '0 20px 50px rgba(7,17,31,0.18)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: isMobile ? 'none' : 'ees-rise 140ms ease',
        }}
      >
        {/* Input row */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: isMobile ? '12px 12px' : '12px 16px',
          borderBottom: `1px solid ${C.border}`,
          background: C.card,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke={C.textSecondary} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search Anura…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 16, color: C.textPrimary,
              fontFamily: 'inherit',
            }}
          />
          {loading && (
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: `2px solid ${C.border}`, borderTopColor: C.emerald,
              animation: 'ees-spin 0.7s linear infinite',
            }} />
          )}
          <button
            onClick={onClose}
            aria-label="Close search"
            style={{
              flexShrink: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, color: C.textMuted, lineHeight: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18 M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', background: C.page }}>
          {/* Empty / hint state */}
          {query.trim().length < 2 && !loading && (
            <div style={{
              padding: isMobile ? '32px 16px' : '40px 24px',
              textAlign: 'center', color: C.textMuted, fontSize: 13,
            }}>
              <div style={{ marginBottom: 6, color: C.textSecondary, fontWeight: 500, fontSize: 14 }}>
                Search across all of Anura
              </div>
              Type at least 2 characters to find accounts, contacts, properties,
              opportunities, projects, work orders, incentive applications, and more.
              <div style={{ marginTop: 14, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                <ExampleChip text="PROJ-00001" onClick={() => setQuery('PROJ-00001')} />
                <ExampleChip text="willow" onClick={() => setQuery('willow')} />
                <ExampleChip text="IRA HOMES" onClick={() => setQuery('IRA HOMES')} />
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: 16, color: C.danger, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* No results */}
          {query.trim().length >= 2 && !loading && !error && groups.length === 0 && (
            <div style={{
              padding: '40px 24px', textAlign: 'center',
              color: C.textMuted, fontSize: 13,
            }}>
              <div style={{ color: C.textSecondary, fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
                No matches for “{query}”
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
              onSelect={(r) => {
                onNavigate?.({ table: r.table_name, id: r.id, mode: 'view' })
                onClose()
              }}
              onHover={(idx) => setActiveIdx(idx)}
            />
          ))}
        </div>

        {/* Footer hint */}
        {!isMobile && (
          <div style={{
            flexShrink: 0,
            padding: '8px 14px',
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
      </div>

      {/* Local keyframes — don't pollute global stylesheet for a one-off use. */}
      <style>{`
        @keyframes ees-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ees-rise { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
        @keyframes ees-spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )

  return createPortal(overlay, document.body)
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
