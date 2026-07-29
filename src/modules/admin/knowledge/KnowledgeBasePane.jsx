import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { ListView } from '../../../components/ListView'
import {
  fetchAllKnowledgeDocuments, createKnowledgeNote, uploadKnowledgeFile,
  fetchProgramScopeOptions, KNOWLEDGE_STATES,
} from '../../../data/knowledgeBaseService'
import {
  inputStyle, textareaStyle, buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from '../adminStyles'
import KnowledgeDocumentEditor from './KnowledgeDocumentEditor'

// ---------------------------------------------------------------------------
// KnowledgeBasePane — Administration > Knowledge Base.
// One general pool: upload files or add notes; the assistant searches it by
// meaning. Admin-only writes (RLS); internal-only reads.
// ---------------------------------------------------------------------------

const COLS = [
  { field: 'id',        label: 'Record #', type: 'text',   sortable: true,  filterable: false },
  { field: 'title',     label: 'Title',    type: 'text',   sortable: true,  filterable: true  },
  { field: 'type',      label: 'Type',     type: 'select', sortable: true,  filterable: true, options: ['File', 'Note'] },
  { field: 'scope',     label: 'Scope',    type: 'text',   sortable: true,  filterable: true  },
  { field: 'indexed',   label: 'Indexed',  type: 'select', sortable: true,  filterable: true, options: ['Indexed', 'Pending', 'Error'] },
  { field: 'updatedAt', label: 'Updated',  type: 'text',   sortable: true,  filterable: false },
]

function shapeRow(r) {
  const scope = [r.kd_state, r.kd_opportunity_record_type].filter(Boolean).join(' · ') || 'All'
  const indexed = r.kd_index_error ? 'Error' : (r.kd_is_indexed ? 'Indexed' : 'Pending')
  return {
    id:        r.kd_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:       r.id,
    title:     r.kd_title,
    type:      r.kd_source_type === 'file' ? 'File' : 'Note',
    scope,
    indexed,
    updatedAt: r.kd_updated_at ? new Date(r.kd_updated_at).toLocaleDateString() : '—',
  }
}

export default function KnowledgeBasePane() {
  const [data,     setData]     = useState([])
  const [programs, setPrograms] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [openId,   setOpenId]   = useState(null)
  const [modal,    setModal]    = useState(null) // 'file' | 'note' | null

  const reload = useCallback(() => {
    setLoading(true); setError(null)
    return Promise.all([fetchAllKnowledgeDocuments(), fetchProgramScopeOptions().catch(() => [])])
      .then(([rows, progs]) => { setPrograms(progs); setData(rows.map(shapeRow)) })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  if (openId) {
    return (
      <KnowledgeDocumentEditor
        documentId={openId}
        programs={programs}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onDeleted={() => { setOpenId(null); reload() }}
      />
    )
  }

  const systemViews = [
    { id: 'AV',  name: 'All',      filters: [],                                                     sortField: 'updatedAt', sortDir: 'desc' },
    { id: 'ERR', name: 'Needs attention', filters: [{ field: 'indexed', op: 'equals', value: 'Error' }], sortField: 'updatedAt', sortDir: 'desc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Knowledge Base</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
            {loading ? 'Loading…' : `${data.length} item${data.length === 1 ? '' : 's'} — the company brain the LEAP assistant searches by meaning. Admin-only to edit.`}
          </div>
        </div>
        <button type="button" onClick={() => setModal('note')} style={buttonSecondaryStyle}>Add Note</button>
        <button type="button" onClick={() => setModal('file')} style={buttonPrimaryStyle}>Upload File</button>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={data}
          columns={COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          onOpenRecord={row => row?._id && setOpenId(row._id)}
          onRefresh={reload}
        />
      )}
      {modal && (
        <NewKnowledgeModal
          mode={modal}
          programs={programs}
          onClose={() => setModal(null)}
          onCreated={(created) => { setModal(null); reload(); setOpenId(created.id) }}
        />
      )}
    </div>
  )
}

function ScopeFields({ state, setState, program, setProgram, programs }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <FormField label="State scope" hint="Optional — leave blank if it applies everywhere.">
          <select value={state} onChange={e => setState(e.target.value)} style={inputStyle}>
            <option value="">All states</option>
            {KNOWLEDGE_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>
      </div>
      <div style={{ flex: 1 }}>
        <FormField label="Program scope" hint="Optional — the opportunity record type this is specific to.">
          <select value={program} onChange={e => setProgram(e.target.value)} style={inputStyle}>
            <option value="">All programs</option>
            {programs.map(p => <option key={p.picklist_value} value={p.picklist_value}>{p.picklist_label}</option>)}
          </select>
        </FormField>
      </div>
    </div>
  )
}

function NewKnowledgeModal({ mode, programs, onClose, onCreated }) {
  const isFile = mode === 'file'
  const [file,        setFile]        = useState(null)
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [body,        setBody]        = useState('')
  const [state,       setState]       = useState('')
  const [program,     setProgram]     = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)

  const onFile = (f) => { setFile(f); if (f && !title) setTitle(f.name.replace(/\.[a-z0-9]+$/i, '')) }

  const submit = async () => {
    if (isFile && !file)       { setError('Choose a file to upload.'); return }
    if (!title.trim())         { setError('Title is required.'); return }
    if (!isFile && !body.trim()) { setError('Write the note body.'); return }
    setBusy(true); setError(null)
    try {
      const created = isFile
        ? await uploadKnowledgeFile({ file, title: title.trim(), description, state, program })
        : await createKnowledgeNote({ title: title.trim(), description, content_text: body, state, program })
      onCreated(created)
    } catch (e) { setError(e?.message || String(e)); setBusy(false) }
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>{isFile ? 'Upload File' : 'Add Note'}</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            {isFile
              ? 'Word, Excel/CSV, text, or PDF. LEAP extracts the text and indexes it so the assistant can read it.'
              : 'Type or paste knowledge directly. It gets indexed for the assistant to search.'}
          </div>
        </div>
        <div style={{ padding: 18, maxHeight: '60vh', overflow: 'auto' }}>
          {isFile && (
            <FormField label="File" required>
              <input type="file" onChange={e => onFile(e.target.files?.[0] || null)}
                accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md" style={{ fontSize: 13 }} />
            </FormField>
          )}
          <FormField label="Title" required>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus={!isFile} style={inputStyle} />
          </FormField>
          <FormField label="Brief description" hint="One line on what this is — helps retrieval and disambiguation.">
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
          </FormField>
          {!isFile && (
            <FormField label="Note body" required>
              <textarea value={body} onChange={e => setBody(e.target.value)}
                style={{ ...textareaStyle, minHeight: 200, fontSize: 12.5, lineHeight: 1.5 }} />
            </FormField>
          )}
          <ScopeFields state={state} setState={setState} program={program} setProgram={setProgram} programs={programs} />
          {error && <div style={{ fontSize: 12, color: '#1a5a8a', marginTop: 6 }}>{error}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={{ ...buttonPrimaryStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? (isFile ? 'Uploading & indexing…' : 'Saving & indexing…') : (isFile ? 'Upload' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

const modalBackdrop = {
  position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modalCard = {
  background: C.card, borderRadius: 8, width: '90%', maxWidth: 520,
  display: 'flex', flexDirection: 'column', boxShadow: '0 12px 32px rgba(13,26,46,0.18)', overflow: 'hidden',
}
