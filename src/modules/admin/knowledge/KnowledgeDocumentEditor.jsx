import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import {
  fetchKnowledgeDocumentById, updateKnowledgeDocument, softDeleteKnowledgeDocument,
  reindexKnowledgeDocument, knowledgeFileUrl, KNOWLEDGE_STATES,
} from '../../../data/knowledgeBaseService'
import {
  inputStyle, textareaStyle, buttonPrimaryStyle, buttonSecondaryStyle, buttonDangerStyle, FormField,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// KnowledgeDocumentEditor — edit one knowledge item (note or file):
// title, description, State/Program scope, content text, re-index, delete.
// ---------------------------------------------------------------------------

export default function KnowledgeDocumentEditor({ documentId, programs, onBack, onChanged, onDeleted }) {
  const [doc,     setDoc]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const reload = useCallback(() => {
    setLoading(true); setError(null)
    return fetchKnowledgeDocumentById(documentId).then(setDoc).catch(setError).finally(() => setLoading(false))
  }, [documentId])
  useEffect(() => { reload() }, [reload])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />
  if (!doc) return null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <button type="button" onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: C.textMuted, marginBottom: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          Back to Knowledge Base
        </button>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{doc.kd_title}</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{doc.kd_record_number}</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span>{doc.kd_source_type === 'file' ? 'File' : 'Note'}</span>
          <span style={{ margin: '0 8px' }}>·</span>
          {doc.kd_index_error
            ? <span style={{ color: '#1a5a8a' }}>⚠ Not indexed</span>
            : doc.kd_is_indexed
              ? <span style={{ color: '#1a7a4e' }}>● Indexed ({doc.kd_chunk_count} chunks)</span>
              : <span style={{ color: '#1e466b' }}>○ Pending index</span>}
        </div>
      </div>
      <ContentTab doc={doc} programs={programs}
        onSaved={async () => { await reload(); onChanged && onChanged() }}
        onDeleted={onDeleted} />
    </div>
  )
}

function ContentTab({ doc, programs, onSaved, onDeleted }) {
  const isFile = doc.kd_source_type === 'file'
  const [title,       setTitle]       = useState(doc.kd_title || '')
  const [description, setDescription] = useState(doc.kd_description || '')
  const [content,     setContent]     = useState(doc.kd_content_text || '')
  const [state,       setState]       = useState(doc.kd_state || '')
  const [program,     setProgram]     = useState(doc.kd_opportunity_record_type || '')
  const [saving,      setSaving]      = useState(false)
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [delReason,   setDelReason]   = useState('')

  const contentChanged = content !== (doc.kd_content_text || '')
  const dirty =
    title !== (doc.kd_title || '') ||
    description !== (doc.kd_description || '') ||
    contentChanged ||
    state !== (doc.kd_state || '') ||
    program !== (doc.kd_opportunity_record_type || '')

  const save = async () => {
    if (!dirty || saving) return
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true); setError(null)
    try {
      // Re-embed when the searchable text changed.
      await updateKnowledgeDocument(doc.id, {
        title: title.trim(), description, content_text: content, state, program,
      }, { reindex: contentChanged })
      await onSaved()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setSaving(false) }
  }

  const reindex = async () => {
    setBusy(true); setError(null)
    try { await reindexKnowledgeDocument(doc.id); await onSaved() }
    catch (e) { setError(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  const download = async () => {
    try { const url = await knowledgeFileUrl(doc.kd_file_path); if (url) window.open(url, '_blank') }
    catch (e) { setError(e?.message || String(e)) }
  }

  const performDelete = async () => {
    try { await softDeleteKnowledgeDocument(doc.id, delReason.trim() || null); onDeleted && onDeleted() }
    catch (e) { setError(e?.message || String(e)) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 820 }}>
        {doc.kd_index_error && (
          <div style={{ background: '#eef4fb', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#1a5a8a', marginBottom: 14 }}>
            Not searchable yet: {doc.kd_index_error}
          </div>
        )}

        <FormField label="Title" required>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        </FormField>
        <FormField label="Brief description" hint="One line on what this is — helps retrieval and disambiguation.">
          <input type="text" value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
        </FormField>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <FormField label="State scope" hint="Optional — blank = all states.">
              <select value={state} onChange={e => setState(e.target.value)} style={inputStyle}>
                <option value="">All states</option>
                {KNOWLEDGE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
          </div>
          <div style={{ flex: 1 }}>
            <FormField label="Program scope" hint="Optional — the opportunity record type.">
              <select value={program} onChange={e => setProgram(e.target.value)} style={inputStyle}>
                <option value="">All programs</option>
                {(programs || []).map(p => <option key={p.picklist_value} value={p.picklist_value}>{p.picklist_label}</option>)}
              </select>
            </FormField>
          </div>
        </div>

        {isFile && (
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: C.textSecondary }}>File: {doc.kd_file_name}</span>
            {doc.kd_file_path && (
              <button type="button" onClick={download} style={buttonSecondaryStyle}>Download original</button>
            )}
          </div>
        )}

        <FormField label={isFile ? 'Extracted text (searchable — edit to correct extraction)' : 'Note body'}
          hint="This is what the assistant searches. Editing it re-indexes on save.">
          <textarea value={content} onChange={e => setContent(e.target.value)}
            style={{ ...textareaStyle, minHeight: 260, fontFamily: 'JetBrains Mono, monospace', fontSize: 12, lineHeight: 1.5 }} />
        </FormField>

        {error && <div style={{ marginTop: 8, fontSize: 12, color: '#1a5a8a' }}>{error}</div>}

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={!dirty || saving} style={{ ...buttonPrimaryStyle, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={reindex} disabled={busy} style={{ ...buttonSecondaryStyle, opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Re-indexing…' : 'Re-index'}
          </button>
        </div>

        <div style={{ marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>Delete this item</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>Soft delete — recoverable from the recycle bin.</div>
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} style={buttonDangerStyle}>Delete item</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FormField label="Reason" hint="Optional — appears in the audit log.">
                <input type="text" value={delReason} onChange={e => setDelReason(e.target.value)} style={inputStyle} />
              </FormField>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={performDelete} style={buttonDangerStyle}>Confirm delete</button>
                <button type="button" onClick={() => setConfirmDel(false)} style={buttonSecondaryStyle}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
