import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { renderMarkdown } from '../../../components/help/markdown'
import {
  fetchProgramKnowledgeArticleById, updateProgramKnowledgeArticle, softDeleteProgramKnowledgeArticle,
} from '../../../data/programKnowledgeService'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonDangerStyle,
  FormField,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// ProgramKnowledgeEditor — two tabs:
//   • Content — program, title, category, body markdown, publish, soft-delete
//   • Preview — the note rendered as the assistant reads it
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'content', label: 'Content' },
  { id: 'preview', label: 'Preview' },
]

export default function ProgramKnowledgeEditor({ articleId, programs, onBack, onChanged, onDeleted }) {
  const [article, setArticle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('content')

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchProgramKnowledgeArticleById(articleId)
      .then(setArticle)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [articleId])

  useEffect(() => { reload() }, [reload])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />
  if (!article) return null

  const programName = (programs || []).find(p => p._id === article.program_id)?.name || '—'

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
          Back to Program Knowledge
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
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{article.pka_title}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{article.pka_record_number}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              <span>{programName}</span>
              <span style={{ margin: '0 8px' }}>·</span>
              {article.pka_is_published
                ? <span style={{ color: '#1a7a4e' }}>● Published</span>
                : <span style={{ color: '#1e466b' }}>○ Draft</span>}
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
            programs={programs}
            onSaved={async () => { await reload(); onChanged && onChanged() }}
            onDeleted={onDeleted}
          />
        )}
        {tab === 'preview' && <PreviewTab article={article} programName={programName} />}
      </div>
    </div>
  )
}

// ─── Content tab ────────────────────────────────────────────────────────

function ContentTab({ article, programs, onSaved, onDeleted }) {
  const [programId,   setProgramId]   = useState(article.program_id || '')
  const [title,       setTitle]       = useState(article.pka_title || '')
  const [body,        setBody]        = useState(article.pka_body_markdown || '')
  const [category,    setCategory]    = useState(article.pka_category || '')
  const [isPublished, setIsPublished] = useState(!!article.pka_is_published)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState(null)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [delReason,   setDelReason]   = useState('')

  const dirty =
    programId !== (article.program_id || '') ||
    title !== (article.pka_title || '') ||
    body !== (article.pka_body_markdown || '') ||
    category !== (article.pka_category || '') ||
    isPublished !== !!article.pka_is_published

  const save = async () => {
    if (!dirty || saving) return
    if (!programId) { setError('Program is required.'); return }
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await updateProgramKnowledgeArticle(article.id, {
        program_id: programId,
        pka_title: title.trim(),
        pka_body_markdown: body,
        pka_category: category.trim() || null,
        pka_is_published: isPublished,
      })
      await onSaved()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setSaving(false) }
  }

  const performDelete = async () => {
    try {
      await softDeleteProgramKnowledgeArticle(article.id, delReason.trim() || null)
      onDeleted && onDeleted()
    } catch (e) { setError(e?.message || String(e)) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 800 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <FormField label="Program" required>
              <select value={programId} onChange={e => setProgramId(e.target.value)} style={inputStyle}>
                <option value="">— Select program —</option>
                {(programs || []).map(p => (
                  <option key={p._id} value={p._id}>
                    {p.name}{p.state && p.state !== '—' ? ` (${p.state})` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Category" hint="Optional grouping for filtering.">
              <input type="text" value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
            </FormField>
          </div>
        </div>

        <FormField label="Title" required>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        </FormField>

        <FormField label="Body — Markdown" hint="Headings ## / ###, bullets - / *, numbered 1., bold **text**, italic *text*, inline `code`, fenced ```code blocks```, [links](https://…).">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            style={{ ...textareaStyle, minHeight: 320, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 1.5 }}
          />
        </FormField>

        <FormField label="Status">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
            <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.emerald }} />
            Published
          </label>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
            The assistant only reads published notes — drafts stay private to this editor until you publish them.
          </div>
        </FormField>

        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#1a5a8a' }}>{error}</div>}

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={!dirty || saving}
            style={{ ...buttonPrimaryStyle, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Delete */}
        <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            Delete this note
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
            Soft delete — recoverable from the recycle bin.
          </div>
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} style={buttonDangerStyle}>
              Delete note
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

// ─── Preview tab ────────────────────────────────────────────────────────

function PreviewTab({ article, programName }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px', background: C.page }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, textAlign: 'center' }}>
          Preview of the note the assistant reads
        </div>
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.textPrimary, lineHeight: 1.35 }}>
                  {article.pka_title}
                </h2>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>{programName}</div>
              </div>
              {article.pka_category && (
                <span style={{
                  flexShrink: 0, padding: '2px 8px', borderRadius: 999,
                  background: '#f0f9f5', color: '#1a7a4e',
                  fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{article.pka_category}</span>
              )}
            </div>
            <div
              style={{ fontSize: 12.5, lineHeight: 1.55 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(article.pka_body_markdown) }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
