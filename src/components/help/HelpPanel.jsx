import { useEffect, useState } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../UI'
import { lookupHelpArticles } from '../../data/helpService'
import { useHelp } from './HelpProvider'
import { renderMarkdown } from './markdown'

// ---------------------------------------------------------------------------
// HelpPanel — slide-out side panel rendered once near the app root.
//
// State:
//   • Reads anchors + audience from HelpContext.
//   • Fetches matching articles whenever the panel is opened or anchors change.
//   • Displays articles inline. If multiple match, they stack with light
//     separators and a per-article header. If none match, shows an empty
//     state with a "Suggest a help article" stub the admin can act on.
//
// Mounting:
//   Place a single <HelpPanel /> at the top of App.jsx, alongside any other
//   global overlays (toast, modals, etc.). HelpProvider must wrap it.
// ---------------------------------------------------------------------------

export default function HelpPanel() {
  const { isOpen, close, anchors, audience, title } = useHelp()
  const [articles, setArticles] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

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

  // ESC closes the panel
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // Don't render anything when closed — keeps the DOM clean.
  // We rely on a fresh open animation on each launch.
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop — light, dismiss on click */}
      <div
        onClick={close}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,26,46,0.18)',
          zIndex: 1100,
          animation: 'helpFadeIn 180ms ease-out',
        }}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Help"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 460,
          background: C.card,
          boxShadow: '-12px 0 32px rgba(13,26,46,0.18)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1101,
          animation: 'helpSlideIn 220ms ease-out',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
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
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                {title || 'Help'}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {loading ? 'Loading…'
                  : articles.length === 0 ? 'No articles yet'
                  : `${articles.length} article${articles.length === 1 ? '' : 's'}`}
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

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 0, background: C.card }}>
          {loading && <LoadingState />}
          {error && !loading && <ErrorState error={error} />}
          {!loading && !error && articles.length === 0 && <EmptyHelpState anchors={anchors} />}
          {!loading && !error && articles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {articles.map(a => (
                <HelpArticleCard key={a.id} article={a} />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Inline keyframes — added once, scoped via CSS prefix */}
      <style>{`
        @keyframes helpFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes helpSlideIn { from { transform: translateX(20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      `}</style>
    </>
  )
}

function HelpArticleCard({ article }) {
  return (
    <article style={{
      padding: '16px 18px',
      borderBottom: `1px solid ${C.border}`,
      fontSize: 13,
      color: C.textPrimary,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: C.textPrimary,
            lineHeight: 1.35,
          }}>{article.ha_title}</h2>
          {article.ha_summary && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3, lineHeight: 1.4 }}>
              {article.ha_summary}
            </div>
          )}
        </div>
        {article.ha_category && (
          <span style={{
            flexShrink: 0,
            padding: '2px 8px',
            borderRadius: 999,
            background: '#f0f9f5',
            color: '#1a7a4e',
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>{article.ha_category}</span>
        )}
      </div>
      <div
        style={{ fontSize: 12.5, lineHeight: 1.55 }}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(article.ha_body_markdown) }}
      />
    </article>
  )
}

function EmptyHelpState({ anchors }) {
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
        No help article yet
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>
        Nothing in the help library is anchored here yet. Admins can add an article in
        Setup &rarr; Administration &rarr; Help Articles and tag it to this control.
      </div>
      {anchors && anchors.length > 0 && (
        <details style={{ marginTop: 14, fontSize: 11, color: C.textMuted, textAlign: 'left', maxWidth: 360, margin: '14px auto 0' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none' }}>Show anchor info</summary>
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
