import { useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { fetchAllHelpArticles, fetchHelpArticleById, searchHelpArticles } from '../data/helpService'
import { renderMarkdown } from '../components/help/markdown'
import { useHelp } from '../components/help/HelpProvider'

// ---------------------------------------------------------------------------
// HelpCenterPage — the /help full library page.
//
// Layout: left sidebar (categories + article list) + right reading pane.
// Routes:
//   /help                          → category browse + first article shown
//   /help/<slug>                   → specific article in reading pane
//
// The page bypasses module routing — see urlNav handling in App.jsx.
// All read access uses the same audience-aware service the panel uses.
// ---------------------------------------------------------------------------

export default function HelpCenterPage({ initialSlug }) {
  const { audience } = useHelp()

  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedId, setSelectedId] = useState(null)
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [selectedLoading, setSelectedLoading] = useState(false)

  // Search across the library (top of the sidebar).
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)

  // Load the full library on mount. We only fetch published, audience-relevant
  // articles. The fetchAllHelpArticles helper doesn't filter by audience —
  // it's intended for admin authoring — so we filter client-side here.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchAllHelpArticles({ includeDrafts: false })
      .then(rows => {
        if (cancelled) return
        const filtered = (rows || []).filter(a => isAudienceMatch(a, audience))
        setArticles(filtered)
        // Pick initial selection: from URL slug if present, otherwise first
        // article in the first category.
        if (initialSlug) {
          const found = filtered.find(a => a.ha_slug === initialSlug)
          if (found) setSelectedId(found.id)
        }
        if (!initialSlug && filtered.length > 0) {
          setSelectedId(filtered[0].id)
        }
      })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [audience, initialSlug])

  // Fetch full article body when selectedId changes.
  useEffect(() => {
    if (!selectedId) {
      setSelectedArticle(null)
      return
    }
    let cancelled = false
    setSelectedLoading(true)
    fetchHelpArticleById(selectedId)
      .then(({ article }) => { if (!cancelled) setSelectedArticle(article) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setSelectedLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  // Sync the URL when selection changes — pushState so back-button works.
  useEffect(() => {
    if (!selectedArticle?.ha_slug) return
    const desired = `/help/${selectedArticle.ha_slug}`
    if (window.location.pathname !== desired) {
      window.history.pushState({}, '', desired)
    }
  }, [selectedArticle?.ha_slug])

  // Debounced library search.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(() => {
      searchHelpArticles(q, audience, 50)
        .then(rows => { if (!cancelled) setSearchResults(rows || []) })
        .catch(e => { if (!cancelled) setError(e) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, audience])

  // Group articles by category for the sidebar TOC.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const a of articles) {
      const cat = a.ha_category || 'Other'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat).push(a)
    }
    // Sort categories alphabetically, articles by title within each.
    const arr = [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, list] of arr) list.sort((a, b) => a.ha_title.localeCompare(b.ha_title))
    return arr
  }, [articles])

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />

  const inSearchMode = query.trim().length > 0

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      overflow: 'hidden',
      background: C.page,
    }}>
      {/* Sidebar — search + TOC */}
      <aside style={{
        width: 320,
        flexShrink: 0,
        background: C.card,
        borderRight: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 18px 12px',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.emerald}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Help Center
          </h1>
          <div style={{ marginTop: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 10px', height: 32,
              background: C.page,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search help…"
                aria-label="Search help articles"
                style={{
                  flex: 1,
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 13, color: C.textPrimary, fontFamily: 'inherit',
                  minWidth: 0,
                }}
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear"
                  tabIndex={-1}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 2, color: C.textMuted, lineHeight: 0,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18 M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {inSearchMode ? (
            <SearchList
              loading={searching}
              results={searchResults}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <CategoryList
              grouped={grouped}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </nav>
      </aside>

      {/* Reading pane */}
      <main style={{ flex: 1, overflow: 'auto', background: C.page }}>
        {selectedLoading ? (
          <LoadingState />
        ) : selectedArticle ? (
          <ArticleReader article={selectedArticle} />
        ) : (
          <EmptyReader />
        )}
      </main>
    </div>
  )
}

// ── Audience match (mirrors server-side filter logic) ──────────────────────
function isAudienceMatch(article, audience) {
  if (!audience) return article.ha_audience === 'all'
  if (article.ha_audience === 'all') return true
  return article.ha_audience === audience
}

// ── Sidebar lists ──────────────────────────────────────────────────────────
function CategoryList({ grouped, selectedId, onSelect }) {
  if (grouped.length === 0) {
    return (
      <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>
        No help articles yet.
      </div>
    )
  }
  return (
    <div>
      {grouped.map(([cat, list]) => (
        <div key={cat} style={{ marginBottom: 6 }}>
          <div style={{
            padding: '8px 18px 4px',
            fontSize: 10.5,
            fontWeight: 700,
            color: C.textMuted,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>{cat}</div>
          {list.map(a => (
            <TocRow
              key={a.id}
              article={a}
              selected={a.id === selectedId}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function SearchList({ loading, results, selectedId, onSelect }) {
  if (loading) {
    return <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>Searching…</div>
  }
  if (results.length === 0) {
    return <div style={{ padding: 18, fontSize: 12.5, color: C.textMuted }}>No results.</div>
  }
  return (
    <div>
      <div style={{
        padding: '8px 18px 4px',
        fontSize: 10.5,
        fontWeight: 700,
        color: C.textMuted,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>Results · {results.length}</div>
      {results.map(a => (
        <TocRow
          key={a.id}
          article={a}
          selected={a.id === selectedId}
          onClick={() => onSelect(a.id)}
          showCategory
        />
      ))}
    </div>
  )
}

function TocRow({ article, selected, onClick, showCategory }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 18px',
        background: selected ? '#e9f7ef' : 'transparent',
        borderLeft: selected ? `3px solid ${C.emerald}` : '3px solid transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 13,
        color: selected ? C.textPrimary : C.textSecondary,
        fontWeight: selected ? 600 : 400,
        lineHeight: 1.4,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = C.page }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {article.ha_title}
      </div>
      {showCategory && article.ha_category && (
        <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 500, marginTop: 2 }}>
          {article.ha_category}
        </div>
      )}
    </button>
  )
}

// ── Reading pane ───────────────────────────────────────────────────────────
function ArticleReader({ article }) {
  return (
    <div style={{
      maxWidth: 780,
      margin: '0 auto',
      padding: '36px 48px 80px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {article.ha_category && (
          <span style={{
            padding: '3px 9px', borderRadius: 999,
            background: '#f0f9f5', color: '#1a7a4e',
            fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{article.ha_category}</span>
        )}
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
          {article.ha_record_number}
        </span>
      </div>
      <h1 style={{
        margin: 0,
        fontSize: 28,
        fontWeight: 700,
        color: C.textPrimary,
        lineHeight: 1.2,
      }}>{article.ha_title}</h1>
      {article.ha_summary && (
        <p style={{
          marginTop: 10,
          fontSize: 15,
          color: C.textSecondary,
          lineHeight: 1.5,
        }}>{article.ha_summary}</p>
      )}
      <hr style={{ margin: '24px 0', border: 0, borderTop: `1px solid ${C.border}` }} />
      <div
        style={{ fontSize: 14.5, lineHeight: 1.65, color: C.textPrimary }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(article.ha_body_markdown) }}
      />
    </div>
  )
}

function EmptyReader() {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      color: C.textMuted,
      gap: 12,
    }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div style={{ fontSize: 13 }}>Select an article from the sidebar.</div>
    </div>
  )
}
