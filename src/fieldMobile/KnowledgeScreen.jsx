// ─── KnowledgeScreen.jsx ─────────────────────────────────────────────────────
// Field knowledge base. Two modes driven by the route:
//   /field/knowledge          → searchable list of published articles
//                               (audience all/internal), grouped by category
//   /field/knowledge/<slug>   → full article, markdown-rendered
//
// Content is the real help_articles table, scoped to the technician's audience;
// RLS gates readability. Reuses the in-tree dependency-free markdown renderer
// so no bundle bloat. No red/orange; navy/emerald/sky only.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useMemo } from 'react'
import AppChrome, { PullIndicator } from './AppChrome'
import MobileShell from './MobileShell'
import { usePullToRefresh } from './usePullToRefresh'
import { fetchKnowledgeArticles, fetchKnowledgeArticle } from './fieldMobileService'
import { renderMarkdown } from '../components/help/markdown'
import { C, FONT, card } from './styles'

function BookIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.textMuted}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

// Normalize category casing so "admin"/"Admin" group together for display.
function normCat(c) {
  const t = (c || 'General').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ─── List mode ───────────────────────────────────────────────────────────────
export default function KnowledgeScreen({ navigate }) {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [query, setQuery]     = useState('')

  const load = useCallback(async () => {
    try {
      setError(null)
      setRows(await fetchKnowledgeArticles())
    } catch (e) {
      setError(e.message || 'Could not load the knowledge base.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => { setLoading(true); await load(); if (!cancelled) setLoading(false) })()
    return () => { cancelled = true }
  }, [load])

  const pr = usePullToRefresh(load)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      (r.ha_title || '').toLowerCase().includes(q) ||
      (r.ha_summary || '').toLowerCase().includes(q) ||
      (r.ha_category || '').toLowerCase().includes(q)
    )
  }, [rows, query])

  const grouped = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const cat = normCat(r.ha_category)
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat).push(r)
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  return (
    <AppChrome title="Knowledge base" activeKey={null} navigate={navigate}>
      <PullIndicator {...pr} />

      {/* Search */}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search articles"
        style={{
          width: '100%', boxSizing: 'border-box',
          appearance: 'none', WebkitAppearance: 'none',
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '12px 14px', marginBottom: 14,
          fontFamily: FONT, fontSize: 15, color: C.textPrimary,
        }}
      />

      {loading && (
        <div style={{ ...card, padding: 24, textAlign: 'center', color: C.textMuted, fontFamily: FONT, fontSize: 14 }}>
          Loading articles…
        </div>
      )}
      {error && (
        <div style={{ ...card, padding: 24, textAlign: 'center', color: C.danger, fontFamily: FONT, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && grouped.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '40px 20px', gap: 12 }}>
          <BookIcon />
          <div style={{ fontFamily: FONT, fontSize: 15, color: C.textSecondary }}>
            {query ? 'No articles match your search.' : 'No articles available yet.'}
          </div>
        </div>
      )}

      {!loading && !error && grouped.map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            textTransform: 'uppercase', color: C.textMuted, margin: '0 2px 8px',
          }}>
            {cat}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(a => (
              <button
                key={a.id}
                onClick={() => navigate(`/field/knowledge/${a.ha_slug}`)}
                style={{
                  ...card, width: '100%', textAlign: 'left', appearance: 'none', cursor: 'pointer',
                  padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
                    {a.ha_title}
                  </span>
                  {a.ha_summary && (
                    <span style={{
                      display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {a.ha_summary}
                    </span>
                  )}
                </span>
                <span style={{ color: C.emeraldMid, flexShrink: 0, display: 'flex' }}><ArrowIcon /></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </AppChrome>
  )
}

// ─── Article reader mode ─────────────────────────────────────────────────────
// Full-screen (MobileShell) with a back chevron to the list — matches the
// WorkOrderDetail reading pattern; no tab bar while reading.
export function KnowledgeArticle({ slug, navigate }) {
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true); setError(null)
        const a = await fetchKnowledgeArticle(slug)
        if (cancelled) return
        if (!a) setError('Article not found.')
        else setArticle(a)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load this article.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  return (
    <MobileShell title={article?.ha_title || 'Article'} onBack={() => navigate('/field/knowledge')}>
      {loading && (
        <div style={{ ...card, padding: 24, textAlign: 'center', color: C.textMuted, fontFamily: FONT, fontSize: 14 }}>
          Loading…
        </div>
      )}
      {error && (
        <div style={{ ...card, padding: 24, textAlign: 'center', color: C.danger, fontFamily: FONT, fontSize: 14 }}>
          {error}
        </div>
      )}
      {!loading && !error && article && (
        <div style={{ ...card, padding: 18 }}>
          <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: C.textPrimary, marginBottom: 6 }}>
            {article.ha_title}
          </div>
          {article.ha_summary && (
            <div style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
              {article.ha_summary}
            </div>
          )}
          <div
            className="ees-md"
            style={{ fontFamily: FONT, fontSize: 15, color: C.textPrimary, lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(article.ha_body_markdown || '') }}
          />
        </div>
      )}
    </MobileShell>
  )
}
