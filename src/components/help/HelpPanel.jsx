import { useEffect, useRef, useState } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../UI'
import { lookupHelpArticles, searchHelpArticles } from '../../data/helpService'
import { useHelp } from './HelpProvider'
import { renderMarkdown } from './markdown'

// ---------------------------------------------------------------------------
// HelpPanel — slide-out side panel rendered once near the app root.
//
// Two modes inside the same panel:
//   • Context mode (default): when opened, fetches articles anchored to the
//     current page (per anchors passed in). Header reads "Help for: <page>".
//   • Search mode: triggered when the user types in the search box. Replaces
//     the context article list with full-library search results until the
//     search box is cleared.
//
// Footer link: "Browse all help articles →" routes to /help, the full
// help center (sidebar nav by category, dedicated reading pane).
// ---------------------------------------------------------------------------

export default function HelpPanel() {
  const { isOpen, close, anchors, audience, title } = useHelp()

  // ── Context-mode articles (anchor lookup) ───────────────────────────────
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ── Search-mode state ───────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const searchAbortRef = useRef(0)

  const inSearchMode = query.trim().length > 0

  // Refetch context articles whenever panel opens or anchors change.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setArticles([])

    lookupHelpArticles(anchors, audience)
      .then(rows => { if (!cancelled) setArticles(rows || []) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [isOpen, anchors, audience])

  // Reset search box every time the panel reopens — the panel is meant
  // to be glanceable, not stateful across closes.
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSearchResults([])
      setSearchError(null)
    }
  }, [isOpen])

  // Debounced search. Bumps a request id on every keystroke so a slow
  // earlier request can't overwrite a faster later one.
  useEffect(() => {
    if (!isOpen) return
    if (!inSearchMode) {
      setSearchResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    const myId = ++searchAbortRef.current
    setSearching(true)
    const t = setTimeout(() => {
      searchHelpArticles(query.trim(), audience, 25)
        .then(rows => {
          if (myId !== searchAbortRef.current) return
          setSearchResults(rows || [])
          setSearchError(null)
        })
        .catch(e => {
          if (myId !== searchAbortRef.current) return
          setSearchError(e)
          setSearchResults([])
        })
        .finally(() => {
          if (myId === searchAbortRef.current) setSearching(false)
        })
    }, 220)
    return () => clearTimeout(t)
  }, [isOpen, query, inSearchMode, audience])

  // ESC closes the panel
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  if (!isOpen) return null

  const subhead = inSearchMode
    ? (searching
        ? 'Searching…'
        : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query.trim()}"`)
    : (loading
        ? 'Loading…'
        : articles.length === 0 ? 'No articles for this page yet'
        : `${articles.length} article${articles.length === 1 ? '' : 's'} for this page`)

  return (
    <>
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,26,46,0.18)',
          zIndex: 1100,
          animation: 'helpFadeIn 180ms ease-out',
        }}
      />

      <aside
        role="dialog"
        aria-label="Help"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: 460,
          background: C.card,
          boxShadow: '-12px 0 32px rgba(13,26,46,0.18)',
          display: 'flex', flexDirection: 'column',
          zIndex: 1101,
          animation: 'helpSlideIn 220ms ease-out',
        }}
      >
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.emerald}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title || 'Help'}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subhead}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, borderRadius: 6,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.textSecondary,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = C.page }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search box */}
        <div style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
          background: C.cardSecondary || '#f7f9fc',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0 10px',
            height: 32,
            background: C.card,
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
              placeholder="Search all help articles…"
              aria-label="Search help articles"
              autoFocus
              style={{
                flex: 1,
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: C.textPrimary,
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                tabIndex={-1}
                style={{
                  flexShrink: 0,
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

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 0, background: C.card }}>
          {inSearchMode ? (
            <SearchResults loading={searching} error={searchError} results={searchResults} query={query} />
          ) : (
            <ContextResults loading={loading} error={error} articles={articles} anchors={anchors} />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
          background: C.cardSecondary || '#f7f9fc',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <a
            href="/help"
            onClick={e => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return
              e.preventDefault()
              window.history.pushState({}, '', '/help')
              window.dispatchEvent(new PopStateEvent('popstate'))
              close()
            }}
            style={{
              fontSize: 12,
              color: C.emerald,
              textDecoration: 'none',
              fontWeight: 500,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            Browse all help articles
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </a>
          <span style={{ fontSize: 11, color: C.textMuted }}>Esc to close</span>
        </div>
      </aside>

      <style>{`
        @keyframes helpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes helpSlideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      `}</style>
    </>
  )
}

function ContextResults({ loading, error, articles, anchors }) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (articles.length === 0) return <EmptyContextState anchors={anchors} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {articles.map(a => <HelpArticleCard key={a.id} article={a} />)}
    </div>
  )
}

function SearchResults({ loading, error, results, query }) {
  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (results.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>
        No articles found for &ldquo;{query.trim()}&rdquo;.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {results.map(a => <SearchResultRow key={a.id} article={a} />)}
    </div>
  )
}

function SearchResultRow({ article }) {
  const [expanded, setExpanded] = useState(false)
  if (expanded) return <HelpArticleCard article={article} onCollapse={() => setExpanded(false)} />
  return (
    <button
      type="button"
      onClick={() => setExpanded(true)}
      style={{
        textAlign: 'left',
        padding: '12px 16px',
        borderBottom: `1px solid ${C.border}`,
        background: C.card,
        border: 'none',
        borderBottomColor: C.border,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = C.page }}
      onMouseLeave={e => { e.currentTarget.style.background = C.card }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, lineHeight: 1.35 }}>
            {article.ha_title}
          </div>
          {article.ha_summary && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, lineHeight: 1.4 }}>
              {article.ha_summary}
            </div>
          )}
        </div>
        {article.ha_category && (
          <span style={{
            flexShrink: 0,
            padding: '2px 8px', borderRadius: 999,
            background: '#f0f9f5', color: '#1a7a4e',
            fontSize: 10.5, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{article.ha_category}</span>
        )}
      </div>
    </button>
  )
}

function HelpArticleCard({ article, onCollapse }) {
  return (
    <article style={{
      padding: '16px 18px',
      borderBottom: `1px solid ${C.border}`,
      fontSize: 13,
      color: C.textPrimary,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.textPrimary, lineHeight: 1.35 }}>
            {article.ha_title}
          </h2>
          {article.ha_summary && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, lineHeight: 1.4 }}>
              {article.ha_summary}
            </div>
          )}
        </div>
        {article.ha_category && (
          <span style={{
            flexShrink: 0,
            padding: '2px 8px', borderRadius: 999,
            background: '#f0f9f5', color: '#1a7a4e',
            fontSize: 10.5, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>{article.ha_category}</span>
        )}
      </div>
      <div
        style={{ fontSize: 12.5, lineHeight: 1.55 }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(article.ha_body_markdown) }}
      />
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          style={{
            marginTop: 8,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, color: C.textMuted, fontSize: 11, fontFamily: 'inherit',
          }}
        >
          ← back to search results
        </button>
      )}
    </article>
  )
}

function EmptyContextState({ anchors }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, margin: '20px auto 12px',
        borderRadius: '50%',
        background: '#f0f3f8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: C.textMuted,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, marginBottom: 4 }}>
        No help article for this page yet
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>
        Try searching above, or browse all articles using the link at the bottom of this panel.
      </div>
      {anchors && anchors.length > 0 && (
        <details style={{ marginTop: 14, fontSize: 11, color: C.textMuted, textAlign: 'left', maxWidth: 360, margin: '14px auto 0' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none' }}>Show anchor info (admin)</summary>
          <pre style={{
            marginTop: 6,
            background: '#f0f3f8',
            padding: 8,
            borderRadius: 4,
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10.5,
            overflow: 'auto',
            color: C.textSecondary,
          }}>{JSON.stringify(anchors, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}
