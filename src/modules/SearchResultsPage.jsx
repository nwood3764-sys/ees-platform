/**
 * SearchResultsPage — full grouped results for a global search query.
 *
 * Activated by URL: /search?q=<term>&type=<object_type?>. The search modal
 * has a "View all results" footer button that lands users here. The
 * dedicated page differs from the modal in three ways:
 *   1. Higher per-object cap (50 unfiltered, 200 when one type is selected)
 *   2. Sidebar that lets the user filter to a single object_type
 *   3. Stable shareable URL — copy the address, paste, get the same view
 *
 * Data flow:
 *   - allResults  : RPC global_search(q, 50)         — always loaded; powers
 *                                                      the sidebar counts AND
 *                                                      the unfiltered main view
 *   - typedResults: RPC global_search(q, 200, type)  — only loaded when a
 *                                                      type filter is active;
 *                                                      replaces allResults in
 *                                                      the main view
 * Sidebar always reads allResults so the user can see counts for every type
 * even while a filter is active.
 *
 * Query refinement: typing into the page-level search input pushes a new
 * URL via onNavigateToSearch (replace=true so back-button doesn't pile up
 * one entry per keystroke). The hook re-parses the URL → page re-fetches.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { C } from '../data/constants'
import { useIsMobile } from '../lib/useMediaQuery'
import { supabase } from '../lib/supabase'
import {
  ObjectIcon,
  SearchResultRow,
  SEARCH_GROUP_ORDER,
  SEARCH_GROUP_LABELS,
} from '../components/GlobalSearch'

// Per-object caps. The unfiltered cap is small enough to keep the RPC
// fast across 17 tables; the filtered cap is high enough to cover any
// realistic search at our current data scale.
const UNFILTERED_LIMIT = 50
const FILTERED_LIMIT   = 200

// ─── Counts pill ─────────────────────────────────────────────────────────────
// Tiny grey number shown next to each sidebar entry. Suffixes "+" when the
// row count maxes out the per-object cap (so the user knows there may be
// more if they filter).
function CountPill({ count, maxedOut }) {
  return (
    <span style={{
      flexShrink: 0,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11, color: C.textMuted,
      background: C.page, border: `1px solid ${C.border}`,
      padding: '1px 6px', borderRadius: 4,
      minWidth: 24, textAlign: 'center',
    }}>
      {count}{maxedOut ? '+' : ''}
    </span>
  )
}

// ─── Sidebar entry ───────────────────────────────────────────────────────────
function SidebarEntry({ icon, label, count, maxedOut, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%',
        padding: '8px 12px',
        background: active ? '#e9f7ef' : 'transparent',
        border: 'none',
        borderLeft: active ? `3px solid ${C.emerald}` : '3px solid transparent',
        color: active ? C.textPrimary : C.textSecondary,
        fontWeight: active ? 600 : 400,
        fontSize: 13,
        cursor: count === 0 && !active ? 'default' : 'pointer',
        opacity: count === 0 && !active ? 0.55 : 1,
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <CountPill count={count} maxedOut={maxedOut} />
    </button>
  )
}

// ─── Mobile filter pills ─────────────────────────────────────────────────────
// Horizontal-scrollable row of object-type chips. Mobile equivalent of the
// desktop sidebar — same data, different layout. "All" pill resets the
// filter; other pills show only types that actually have hits.
function MobileFilterPills({ countsByType, activeType, allCount, onSelect }) {
  // Hide pills for types with zero hits to keep the row tight on mobile.
  const visibleTypes = SEARCH_GROUP_ORDER.filter(t => (countsByType[t] || 0) > 0)
  return (
    <div className="ees-hscroll" style={{
      display: 'flex', gap: 8,
      padding: '8px 12px',
      borderBottom: `1px solid ${C.border}`,
      background: C.card,
      overflowX: 'auto',
      scrollSnapType: 'x proximity',
    }}>
      <Pill active={!activeType} onClick={() => onSelect(null)}>
        All <span style={{ marginLeft: 4, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{allCount}</span>
      </Pill>
      {visibleTypes.map(t => (
        <Pill key={t} active={activeType === t} onClick={() => onSelect(t)}>
          <ObjectIcon type={t} size={12} color={activeType === t ? C.emerald : C.textSecondary} />
          <span style={{ marginLeft: 6 }}>{SEARCH_GROUP_LABELS[t]}</span>
          <span style={{ marginLeft: 6, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            {countsByType[t]}
          </span>
        </Pill>
      ))}
    </div>
  )
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center',
        flexShrink: 0,
        padding: '6px 12px',
        background: active ? '#e9f7ef' : C.page,
        border: `1px solid ${active ? C.emerald : C.border}`,
        borderRadius: 16,
        color: active ? C.textPrimary : C.textSecondary,
        fontSize: 12.5, fontWeight: active ? 600 : 500,
        cursor: 'pointer', fontFamily: 'inherit',
        scrollSnapAlign: 'start',
      }}
    >
      {children}
    </button>
  )
}

// ─── Group section in main column ────────────────────────────────────────────
// Section header + result rows for one object type. When unfiltered, the
// header doubles as a "Show all N" link — clicking it sets the type filter,
// which expands the per-type cap from 50 → 200.
function ResultsGroupSection({ type, label, rows, maxedOut, isFiltered, isMobile, onShowAll, onSelectRow }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: isMobile ? 12 : 16,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '10px 16px',
        borderBottom: `1px solid ${C.border}`,
        background: C.cardSecondary || C.page,
      }}>
        <ObjectIcon type={type} size={14} color={C.textSecondary} />
        <span style={{ marginLeft: 8, fontWeight: 600, fontSize: 13, color: C.textPrimary }}>
          {label}
        </span>
        <span style={{ marginLeft: 8, color: C.textMuted, fontSize: 12 }}>
          ({rows.length}{maxedOut ? '+' : ''})
        </span>
        {/* Show all link only when unfiltered AND the per-type cap was hit */}
        {!isFiltered && maxedOut && (
          <button
            onClick={onShowAll}
            style={{
              marginLeft: 'auto',
              background: 'transparent', border: 'none',
              color: C.emerald, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: 0,
            }}
          >
            Show all
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
      {rows.length === 0
        ? (
          <div style={{ padding: '20px 16px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No matches in {label}.
          </div>
        )
        : rows.map(r => (
          <div key={`${r.table_name}:${r.id}`} style={{ borderTop: `1px solid ${C.border}` }}>
            <SearchResultRow row={r} onSelect={onSelectRow} />
          </div>
        ))
      }
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function SearchResultsPage({
  searchQuery,
  searchType,
  onNavigateToRecord,
  onNavigateToSearch,   // (query, type, { useReplace }) — pushes new /search URL
}) {
  const isMobile = useIsMobile()

  // Local, debounced editing state for the page-level search input. The
  // URL/searchQuery prop drives reload; the local input value just tracks
  // what the user is typing so we can debounce before pushing to URL.
  const [inputValue, setInputValue] = useState(searchQuery || '')
  const inputDebounceRef = useRef(null)

  // Result state. allResults is always loaded for the chosen query and
  // drives the sidebar/All view. typedResults is loaded only when a type
  // filter is active and replaces the main view.
  const [allResults, setAllResults] = useState([])
  const [typedResults, setTypedResults] = useState(null)
  const [loadingAll, setLoadingAll] = useState(false)
  const [loadingTyped, setLoadingTyped] = useState(false)
  const [error, setError] = useState(null)

  // Cancellation guards: increment on each fetch start, drop responses
  // whose ID doesn't match the latest. Two separate counters because the
  // two fetches race independently.
  const allReqRef = useRef(0)
  const typedReqRef = useRef(0)

  // Sync the input value when searchQuery (URL) changes externally. This
  // catches popstate (browser back), the modal-driven landing, and any
  // out-of-band query changes. Avoids overwriting the user's in-progress
  // typing if the URL change came from THIS input — the values are equal
  // in that case so the setState is a no-op.
  useEffect(() => {
    setInputValue(searchQuery || '')
  }, [searchQuery])

  // Push input changes back to URL with a 300ms debounce. The hook is
  // configured to use replaceState so the back button doesn't accumulate
  // an entry per keystroke — back from /search?q=foo should go to
  // wherever the user came from, not /search?q=fo / /search?q=f / etc.
  useEffect(() => {
    const trimmed = (inputValue || '').trim()
    if (trimmed === (searchQuery || '').trim()) return
    if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current)
    inputDebounceRef.current = setTimeout(() => {
      onNavigateToSearch?.(trimmed, searchType, { useReplace: true })
    }, 300)
    return () => { if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue])

  // Fetch unfiltered results whenever the query changes. Even when a type
  // filter is active we still need this for the sidebar counts.
  useEffect(() => {
    const q = (searchQuery || '').trim()
    if (q.length < 2) {
      setAllResults([])
      setLoadingAll(false)
      setError(null)
      return
    }
    setLoadingAll(true)
    const myReq = ++allReqRef.current
    supabase.rpc('global_search', { p_query: q, p_limit_per_object: UNFILTERED_LIMIT })
      .then(({ data, error }) => {
        if (myReq !== allReqRef.current) return
        if (error) {
          setError(error.message || 'Search failed')
          setAllResults([])
        } else {
          setError(null)
          setAllResults(Array.isArray(data) ? data : [])
        }
        setLoadingAll(false)
      })
  }, [searchQuery])

  // Fetch type-filtered results only when a type filter is active. Skip
  // entirely otherwise to save one round-trip per page load.
  useEffect(() => {
    if (!searchType) {
      setTypedResults(null)
      setLoadingTyped(false)
      return
    }
    const q = (searchQuery || '').trim()
    if (q.length < 2) {
      setTypedResults([])
      setLoadingTyped(false)
      return
    }
    setLoadingTyped(true)
    const myReq = ++typedReqRef.current
    supabase.rpc('global_search', { p_query: q, p_limit_per_object: FILTERED_LIMIT, p_object_type: searchType })
      .then(({ data, error }) => {
        if (myReq !== typedReqRef.current) return
        if (error) {
          setError(error.message || 'Search failed')
          setTypedResults([])
        } else {
          setError(null)
          setTypedResults(Array.isArray(data) ? data : [])
        }
        setLoadingTyped(false)
      })
  }, [searchQuery, searchType])

  // Group both result sets by type for rendering and sidebar counts.
  const allByType = useMemo(() => {
    const m = new Map()
    for (const r of allResults) {
      const arr = m.get(r.object_type) || []
      arr.push(r)
      m.set(r.object_type, arr)
    }
    return m
  }, [allResults])

  const countsByType = useMemo(() => {
    const c = {}
    for (const t of SEARCH_GROUP_ORDER) c[t] = (allByType.get(t) || []).length
    return c
  }, [allByType])

  // The main display: when filtered, show the typed results (which can
  // exceed UNFILTERED_LIMIT). When unfiltered, group allResults.
  const groupsToRender = useMemo(() => {
    if (searchType) {
      const rows = typedResults || []
      const label = SEARCH_GROUP_LABELS[searchType] || searchType
      return [{ type: searchType, label, rows, maxedOut: rows.length === FILTERED_LIMIT }]
    }
    return SEARCH_GROUP_ORDER
      .filter(t => (allByType.get(t) || []).length > 0)
      .map(t => ({
        type: t,
        label: SEARCH_GROUP_LABELS[t] || t,
        rows: allByType.get(t),
        maxedOut: allByType.get(t).length === UNFILTERED_LIMIT,
      }))
  }, [searchType, typedResults, allByType])

  const totalUnfilteredCount = allResults.length
  const totalUnfilteredMaxed = SEARCH_GROUP_ORDER.some(t => countsByType[t] === UNFILTERED_LIMIT)

  const isQueryEmpty = !(searchQuery || '').trim() || (searchQuery || '').trim().length < 2
  const showLoading  = loadingAll || loadingTyped
  const showEmpty    = !showLoading && !error && !isQueryEmpty && groupsToRender.length === 0

  const handleSelectRow = (r) => {
    onNavigateToRecord?.({ table: r.table_name, id: r.id, mode: 'view' })
  }

  const handleSelectType = (type) => {
    // Pushing a real history entry on type changes — back button should
    // step the user out of the filtered view back into the unfiltered one.
    onNavigateToSearch?.((searchQuery || '').trim(), type, { useReplace: false })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
      {/* Topbar — same height/border as every other module */}
      <div data-module-topbar="1" style={{
        height: 54, background: C.card, borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '0 12px' : '0 24px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, minWidth: 0 }}>
          <span style={{ color: C.textMuted }}>Search</span>
          <span style={{ color: C.textMuted }}>/</span>
          <span style={{
            color: C.textPrimary, fontWeight: 500,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: isMobile ? 180 : 360,
          }}>
            {searchQuery ? `"${searchQuery}"` : 'New search'}
          </span>
          {searchType && (
            <>
              <span style={{ color: C.textMuted }}>/</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.textPrimary, fontWeight: 500 }}>
                <ObjectIcon type={searchType} size={12} color={C.textPrimary} />
                {SEARCH_GROUP_LABELS[searchType] || searchType}
              </span>
              <button
                onClick={() => handleSelectType(null)}
                aria-label="Clear type filter"
                style={{
                  marginLeft: 4, background: 'transparent', border: 'none',
                  color: C.textMuted, cursor: 'pointer', padding: 2, lineHeight: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18 M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search input row — refines query inline without leaving the page */}
      <div style={{
        flexShrink: 0,
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: isMobile ? '10px 12px' : '12px 24px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={C.textSecondary} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Search Anura…"
          autoFocus={!searchQuery}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, color: C.textPrimary, fontFamily: 'inherit',
          }}
        />
        {showLoading && (
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: `2px solid ${C.border}`, borderTopColor: C.emerald,
            animation: 'ees-spin 0.7s linear infinite',
          }} />
        )}
      </div>

      {/* Mobile filter pills — only on mobile */}
      {isMobile && !isQueryEmpty && (
        <MobileFilterPills
          countsByType={countsByType}
          allCount={totalUnfilteredCount}
          activeType={searchType}
          onSelect={handleSelectType}
        />
      )}

      {/* Body */}
      <div style={{
        flex: 1, overflow: 'hidden',
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        background: C.page,
      }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <div style={{
            width: 240, flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            background: C.card,
            overflowY: 'auto',
            padding: '12px 0',
          }}>
            <SidebarEntry
              icon={null}
              label="All Results"
              count={totalUnfilteredCount}
              maxedOut={totalUnfilteredMaxed}
              active={!searchType}
              onClick={() => handleSelectType(null)}
            />
            <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
            {SEARCH_GROUP_ORDER.map(t => (
              <SidebarEntry
                key={t}
                icon={<ObjectIcon type={t} size={14} color={searchType === t ? C.emerald : C.textSecondary} />}
                label={SEARCH_GROUP_LABELS[t]}
                count={countsByType[t] || 0}
                maxedOut={(countsByType[t] || 0) === UNFILTERED_LIMIT}
                active={searchType === t}
                onClick={() => {
                  // Don't navigate to types with zero hits unless they're
                  // already active (then user is clearing back to All).
                  if ((countsByType[t] || 0) === 0 && searchType !== t) return
                  handleSelectType(t)
                }}
              />
            ))}
          </div>
        )}

        {/* Main column */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: isMobile ? 12 : 24,
          minWidth: 0,
        }}>
          {error && (
            <div style={{
              padding: '12px 16px', marginBottom: 16,
              background: '#fdecec', border: `1px solid ${C.danger}`,
              borderRadius: 6, color: C.danger, fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {isQueryEmpty && (
            <div style={{
              padding: '60px 24px', textAlign: 'center', color: C.textMuted, fontSize: 13,
            }}>
              <div style={{ color: C.textSecondary, fontWeight: 500, fontSize: 15, marginBottom: 6 }}>
                Search Anura
              </div>
              Type at least 2 characters to search across accounts, contacts,
              properties, projects, work orders, and more.
            </div>
          )}

          {showLoading && !groupsToRender.length && !isQueryEmpty && (
            <div style={{
              padding: '40px 24px', textAlign: 'center',
              color: C.textMuted, fontSize: 13,
            }}>
              Searching…
            </div>
          )}

          {showEmpty && (
            <div style={{
              padding: '60px 24px', textAlign: 'center',
              color: C.textMuted, fontSize: 13,
            }}>
              <div style={{ color: C.textSecondary, fontWeight: 500, fontSize: 15, marginBottom: 6 }}>
                No matches for "{searchQuery}"
                {searchType ? ` in ${SEARCH_GROUP_LABELS[searchType] || searchType}` : ''}
              </div>
              {searchType
                ? <>Try clearing the type filter to search across all objects.</>
                : <>Check spelling or search by record number (e.g. PROJ-00001).</>
              }
            </div>
          )}

          {groupsToRender.map(g => (
            <ResultsGroupSection
              key={g.type}
              type={g.type}
              label={g.label}
              rows={g.rows}
              maxedOut={g.maxedOut}
              isFiltered={!!searchType}
              isMobile={isMobile}
              onShowAll={() => handleSelectType(g.type)}
              onSelectRow={handleSelectRow}
            />
          ))}
        </div>
      </div>

      {/* Local keyframes — match the modal's spinner animation */}
      <style>{`@keyframes ees-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
