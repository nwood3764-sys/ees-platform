import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { OBJECT_CATALOG } from '../objectCatalog'
import { renderMarkdown } from '../../../components/help/markdown'
import {
  fetchHelpArticleById, updateHelpArticle, softDeleteHelpArticle,
  setArticleAnchors,
} from '../../../data/helpService'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonDangerStyle,
  hintBoxStyle, FormField,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// HelpArticleEditor — three tabs:
//   • Content   — title, slug, summary, audience, category, body markdown,
//                 publish toggle, soft-delete
//   • Anchors   — list of anchors that surface this article (route / object /
//                 field / concept). Add, remove, reorder.
//   • Preview   — shows the article rendered as it would appear in the side
//                 panel, updated live from the body markdown.
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'anchors', label: 'Anchors' },
  { id: 'preview', label: 'Preview' },
]

export default function HelpArticleEditor({ articleId, onBack, onChanged, onDeleted }) {
  const [article, setArticle] = useState(null)
  const [anchors, setAnchorsState] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('content')

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchHelpArticleById(articleId)
      .then(({ article, anchors }) => {
        setArticle(article)
        setAnchorsState(anchors)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [articleId])

  useEffect(() => { reload() }, [reload])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />
  if (!article) return null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <button type="button" onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12, color: C.textMuted, marginBottom: 6,
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to Help Articles
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: '#e8f3fb', color: '#1a5a8a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{article.ha_title}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{article.ha_slug}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              <span>{article.ha_audience}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              {article.ha_is_published
                ? <span style={{ color: '#1a7a4e' }}>● Published</span>
                : <span style={{ color: '#8a5a0a' }}>○ Draft</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? `2px solid ${C.emerald}` : '2px solid transparent',
              color: tab === t.id ? C.textPrimary : C.textMuted,
              fontSize: 12.5, fontWeight: tab === t.id ? 500 : 400,
              cursor: 'pointer', marginBottom: -1,
            }}>{t.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'content' && (
          <ContentTab
            article={article}
            onSaved={async () => { await reload(); onChanged && onChanged() }}
            onDeleted={onDeleted}
          />
        )}
        {tab === 'anchors' && (
          <AnchorsTab
            articleId={articleId}
            anchors={anchors}
            onSaved={async () => { await reload(); onChanged && onChanged() }}
          />
        )}
        {tab === 'preview' && <PreviewTab article={article} />}
      </div>
    </div>
  )
}

// ─── Content tab ────────────────────────────────────────────────────────

function ContentTab({ article, onSaved, onDeleted }) {
  const [title,       setTitle]       = useState(article.ha_title || '')
  const [slug,        setSlug]        = useState(article.ha_slug || '')
  const [summary,     setSummary]     = useState(article.ha_summary || '')
  const [body,        setBody]        = useState(article.ha_body_markdown || '')
  const [category,    setCategory]    = useState(article.ha_category || '')
  const [audience,    setAudience]    = useState(article.ha_audience || 'all')
  const [isPublished, setIsPublished] = useState(!!article.ha_is_published)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [delReason,   setDelReason]   = useState('')

  const dirty =
    title !== (article.ha_title || '') ||
    slug !== (article.ha_slug || '') ||
    summary !== (article.ha_summary || '') ||
    body !== (article.ha_body_markdown || '') ||
    category !== (article.ha_category || '') ||
    audience !== (article.ha_audience || 'all') ||
    isPublished !== !!article.ha_is_published

  const save = async () => {
    if (!dirty || saving) return
    if (!title.trim()) { setError('Title is required.'); return }
    if (!slug.trim() || !/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must be lowercase letters, numbers, and dashes only.'); return
    }
    setSaving(true)
    setError(null)
    try {
      await updateHelpArticle(article.id, {
        ha_title: title.trim(),
        ha_slug: slug,
        ha_summary: summary.trim() || null,
        ha_body_markdown: body,
        ha_category: category.trim() || null,
        ha_audience: audience,
        ha_is_published: isPublished,
      })
      await onSaved()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setSaving(false) }
  }

  const performDelete = async () => {
    try {
      await softDeleteHelpArticle(article.id, delReason.trim() || null)
      onDeleted && onDeleted()
    } catch (e) { setError(e?.message || String(e)) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 800 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Title" required>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Slug" required hint="URL-safe — lowercase + dashes.">
              <input type="text" value={slug} onChange={e => setSlug(e.target.value)}
                style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} />
            </FormField>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Audience" required>
              <select value={audience} onChange={e => setAudience(e.target.value)} style={inputStyle}>
                <option value="admin">Admin</option>
                <option value="internal">Internal</option>
                <option value="portal">Portal</option>
                <option value="all">All</option>
              </select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Category" hint="Optional grouping for filtering.">
              <input type="text" value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
            </FormField>
          </div>
        </div>

        <FormField label="Summary" hint="One-line teaser shown above the body in the side panel.">
          <input type="text" value={summary} onChange={e => setSummary(e.target.value)} style={inputStyle} />
        </FormField>

        <FormField label="Body — Markdown" hint="Headings ## / ###, bullets - / *, numbered 1., bold **text**, italic *text*, inline `code`, fenced ```code blocks```, [links](https://…).">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            style={{ ...textareaStyle, minHeight: 280, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 1.5 }}
          />
        </FormField>

        <FormField label="Status">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
            <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.emerald }} />
            Published
          </label>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
            Drafts are visible only here in the editor — the lookup and search RPCs only return published articles.
          </div>
        </FormField>

        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#b03a2e' }}>{error}</div>}

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={!dirty || saving}
            style={{ ...buttonPrimaryStyle, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Delete */}
        <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            Delete this article
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
            Soft delete — recoverable from the recycle bin. Anchors are preserved on the deleted row.
          </div>
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} style={buttonDangerStyle}>
              Delete article
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FormField label="Reason" hint="Optional but recommended — appears in the audit log.">
                <input type="text" value={delReason} onChange={e => setDelReason(e.target.value)} style={inputStyle} />
              </FormField>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={performDelete} style={buttonDangerStyle}>
                  Confirm delete
                </button>
                <button type="button" onClick={() => setConfirmDel(false)} style={buttonSecondaryStyle}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Anchors tab ────────────────────────────────────────────────────────

function AnchorsTab({ articleId, anchors, onSaved }) {
  // Local mutable copy of the anchors list while the admin edits.
  const [items, setItems] = useState(() => anchors.map(a => ({
    id: a.id,
    type: a.haa_anchor_type,
    route: a.haa_route || '',
    object: a.haa_object || '',
    field: a.haa_field || '',
    concept: a.haa_concept || '',
  })))
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const dirty = useMemo(() => {
    if (items.length !== anchors.length) return true
    for (let i = 0; i < items.length; i++) {
      const a = items[i], b = anchors[i]
      if (!b) return true
      if (a.type !== b.haa_anchor_type) return true
      if ((a.route || null)   !== (b.haa_route   || null)) return true
      if ((a.object || null)  !== (b.haa_object  || null)) return true
      if ((a.field || null)   !== (b.haa_field   || null)) return true
      if ((a.concept || null) !== (b.haa_concept || null)) return true
    }
    return false
  }, [items, anchors])

  const addAnchor = (type) => {
    setItems(prev => [...prev, { type, route: '', object: '', field: '', concept: '' }])
  }
  const removeAnchor = (idx) => setItems(prev => prev.filter((_, i) => i !== idx))
  const updateAnchor = (idx, patch) => setItems(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      // Validate every anchor before sending — we wipe the existing rows first
      // so a partially-bad list would otherwise corrupt the article's anchors.
      for (const a of items) {
        if (a.type === 'route' && !a.route) throw new Error('Route anchors need a route value.')
        if (a.type === 'object' && !a.object) throw new Error('Object anchors need an object.')
        if (a.type === 'field' && (!a.object || !a.field)) throw new Error('Field anchors need both object and field.')
        if (a.type === 'concept' && !a.concept) throw new Error('Concept anchors need a concept tag.')
      }
      await setArticleAnchors(articleId, items.map((a, i) => ({
        type: a.type,
        route: a.route, object: a.object, field: a.field, concept: a.concept,
        sort_order: i,
      })))
      await onSaved()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 760 }}>
        <div style={hintBoxStyle}>
          Anchors decide where this article surfaces. The article appears next to a HelpIcon
          whose anchor matches one of the entries below. One article can have many anchors.
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li><strong>Route</strong> — appears next to the page header on a specific URL, e.g. <code>/admin/permission-sets</code>.</li>
            <li><strong>Object</strong> — appears anywhere we anchor by table name, e.g. <code>permission_sets</code>.</li>
            <li><strong>Field</strong> — anchors next to a specific field on a specific object.</li>
            <li><strong>Concept</strong> — free tag, e.g. <code>financial-tier</code>. Use for cross-cutting topics.</li>
          </ul>
        </div>

        {items.length === 0 && (
          <div style={{ padding: 18, textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>
            No anchors yet. The article will only be reachable via the global Help browse view.
          </div>
        )}

        {items.map((a, idx) => (
          <AnchorRow
            key={idx}
            anchor={a}
            onChange={patch => updateAnchor(idx, patch)}
            onRemove={() => removeAnchor(idx)}
          />
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => addAnchor('route')}   style={buttonSecondaryStyle}>+ Route</button>
          <button type="button" onClick={() => addAnchor('object')}  style={buttonSecondaryStyle}>+ Object</button>
          <button type="button" onClick={() => addAnchor('field')}   style={buttonSecondaryStyle}>+ Field</button>
          <button type="button" onClick={() => addAnchor('concept')} style={buttonSecondaryStyle}>+ Concept</button>
        </div>

        {error && <div style={{ marginTop: 12, fontSize: 12, color: '#b03a2e' }}>{error}</div>}

        <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={!dirty || saving}
            style={{ ...buttonPrimaryStyle, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save anchors'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AnchorRow({ anchor, onChange, onRemove }) {
  const objectOptions = OBJECT_CATALOG.map(o => o.table)

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 6,
      padding: '10px 12px', marginBottom: 8,
      background: C.card,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{
          padding: '2px 8px', borderRadius: 999,
          background: '#f0f9f5', color: '#1a7a4e',
          fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{anchor.type}</span>
        <button type="button" onClick={onRemove}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none', padding: 0,
            color: '#b03a2e', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>Remove</button>
      </div>

      {anchor.type === 'route' && (
        <FormField label="Route" hint="App route this article anchors to. Start with '/'.">
          <input type="text" value={anchor.route}
            onChange={e => onChange({ route: e.target.value })}
            placeholder="/admin/permission-sets"
            style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} />
        </FormField>
      )}

      {(anchor.type === 'object' || anchor.type === 'field') && (
        <FormField label="Object (table name)" required>
          <select value={anchor.object} onChange={e => onChange({ object: e.target.value })} style={inputStyle}>
            <option value="">— Select object —</option>
            {objectOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </FormField>
      )}

      {anchor.type === 'field' && (
        <FormField label="Field name" required hint="Exact column name on the selected object.">
          <input type="text" value={anchor.field}
            onChange={e => onChange({ field: e.target.value })}
            style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} />
        </FormField>
      )}

      {anchor.type === 'concept' && (
        <FormField label="Concept tag" required hint="Free-form tag — e.g. 'financial-tier', 'soft-delete'.">
          <input type="text" value={anchor.concept}
            onChange={e => onChange({ concept: e.target.value })}
            style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} />
        </FormField>
      )}
    </div>
  )
}

// ─── Preview tab ────────────────────────────────────────────────────────

function PreviewTab({ article }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: C.page }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, textAlign: 'center' }}>
          Preview as it would appear in the help side panel
        </div>
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.emerald}
              strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Help</div>
          </div>
          <div style={{ padding: '16px 18px' }}>
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
                  flexShrink: 0, padding: '2px 8px', borderRadius: 999,
                  background: '#f0f9f5', color: '#1a7a4e',
                  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{article.ha_category}</span>
              )}
            </div>
            <div
              style={{ fontSize: 12.5, lineHeight: 1.55 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.ha_body_markdown) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
