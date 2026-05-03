import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { ListView } from '../../../components/ListView'
import HelpIcon from '../../../components/help/HelpIcon'
import {
  fetchAllHelpArticles, createHelpArticle, slugify,
} from '../../../data/helpService'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from '../adminStyles'
import HelpArticleEditor from './HelpArticleEditor'

// ---------------------------------------------------------------------------
// HelpArticlesPane — Administration > Help Articles.
// List view of every help article in the system. Click a row → editor.
// "New" → create-and-open flow.
// ---------------------------------------------------------------------------

const COLS = [
  { field: 'id',         label: 'Record #',  type: 'text',   sortable: true,  filterable: false },
  { field: 'title',      label: 'Title',     type: 'text',   sortable: true,  filterable: true  },
  { field: 'slug',       label: 'Slug',      type: 'text',   sortable: true,  filterable: true  },
  { field: 'category',   label: 'Category',  type: 'text',   sortable: true,  filterable: true  },
  { field: 'audience',   label: 'Audience',  type: 'select', sortable: true,  filterable: true,
    options: ['admin', 'internal', 'portal', 'all'] },
  { field: 'status',     label: 'Status',    type: 'select', sortable: true,  filterable: true,
    options: ['Published', 'Draft'] },
  { field: 'updatedAt',  label: 'Updated',   type: 'text',   sortable: true,  filterable: false },
]

function shapeRow(r) {
  return {
    id:        r.ha_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:       r.id,
    title:     r.ha_title,
    slug:      r.ha_slug,
    category:  r.ha_category || '—',
    audience:  r.ha_audience,
    status:    r.ha_is_published ? 'Published' : 'Draft',
    updatedAt: r.ha_updated_at ? new Date(r.ha_updated_at).toLocaleDateString() : '—',
  }
}

export default function HelpArticlesPane() {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [openId,  setOpenId]  = useState(null)
  const [showNew, setShowNew] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchAllHelpArticles()
      .then(rows => setData(rows.map(shapeRow)))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  if (openId) {
    return (
      <HelpArticleEditor
        articleId={openId}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onDeleted={() => { setOpenId(null); reload() }}
      />
    )
  }

  const systemViews = [
    { id: 'AV',    name: 'All',         filters: [],                                                        sortField: 'title', sortDir: 'asc' },
    { id: 'PUB',   name: 'Published',   filters: [{ field: 'status', op: 'equals', value: 'Published' }],   sortField: 'title', sortDir: 'asc' },
    { id: 'DRF',   name: 'Drafts',      filters: [{ field: 'status', op: 'equals', value: 'Draft' }],       sortField: 'title', sortDir: 'asc' },
    { id: 'ADMIN', name: 'Admin only',  filters: [{ field: 'audience', op: 'equals', value: 'admin' }],     sortField: 'title', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Help Articles</div>
          <HelpIcon concept="help-system" title="Help System" />
        </div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.length} article${data.length === 1 ? '' : 's'} — surface inline next to features and in the global Help browse view`}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={data}
          columns={COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel="Help Article"
          onNew={() => setShowNew(true)}
          onOpenRecord={row => row?._id && setOpenId(row._id)}
          onRefresh={reload}
        />
      )}
      {showNew && (
        <NewHelpArticleModal
          existingSlugs={new Set(data.map(d => d.slug))}
          onClose={() => setShowNew(false)}
          onCreated={(created) => {
            setShowNew(false)
            reload()
            setOpenId(created.id)
          }}
        />
      )}
    </div>
  )
}

function NewHelpArticleModal({ existingSlugs, onClose, onCreated }) {
  const [title,    setTitle]    = useState('')
  const [slug,     setSlug]     = useState('')
  const [audience, setAudience] = useState('admin')
  const [category, setCategory] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)
  const [slugTouched, setSlugTouched] = useState(false)

  // Auto-derive slug from title until the admin types in the slug box.
  const onTitleChange = (v) => {
    setTitle(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  const submit = async () => {
    if (!title.trim()) { setError('Title is required.'); return }
    if (!slug.trim())  { setError('Slug is required.'); return }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must be lowercase letters, numbers, and dashes only.'); return
    }
    if (existingSlugs.has(slug)) { setError('Slug already in use — choose another.'); return }
    setBusy(true)
    setError(null)
    try {
      const created = await createHelpArticle({
        ha_title: title.trim(),
        ha_slug: slug,
        ha_category: category.trim() || null,
        ha_audience: audience,
        ha_body_markdown: '',
        ha_is_published: false,
      })
      onCreated(created)
    } catch (e) {
      setError(e?.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>New Help Article</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Creates a draft. After it's open, write the body and add anchors that
            tie it to specific routes, objects, fields, or concepts.
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <FormField label="Title" required>
            <input type="text" value={title} onChange={e => onTitleChange(e.target.value)}
              autoFocus style={inputStyle} />
          </FormField>
          <FormField label="Slug" required hint="URL-safe identifier — lowercase letters, numbers, dashes.">
            <input type="text" value={slug}
              onChange={e => { setSlug(e.target.value); setSlugTouched(true) }}
              style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace' }} />
          </FormField>
          <FormField label="Audience" required hint="Which users should see this article in panels and search.">
            <select value={audience} onChange={e => setAudience(e.target.value)} style={inputStyle}>
              <option value="admin">Admin — system administrators</option>
              <option value="internal">Internal — Energy Efficiency Services staff</option>
              <option value="portal">Portal — property owners, partners</option>
              <option value="all">All — everyone</option>
            </select>
          </FormField>
          <FormField label="Category" hint="Optional grouping — e.g. Permissions, Page Layouts, Work Plans.">
            <input type="text" value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
          </FormField>
          {error && <div style={{ fontSize: 12, color: '#b03a2e', marginBottom: 10 }}>{error}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            style={{ ...buttonPrimaryStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  )
}

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000,
}
const modalCard = {
  background: C.card,
  borderRadius: 8,
  width: '90%', maxWidth: 480,
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 32px rgba(13,26,46,0.18)',
  overflow: 'hidden',
}
