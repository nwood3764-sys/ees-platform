import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { ListView } from '../../../components/ListView'
import { fetchAllProgramKnowledgeArticles, createProgramKnowledgeArticle } from '../../../data/programKnowledgeService'
import { fetchPrograms } from '../../../data/adminService'
import {
  inputStyle, buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from '../adminStyles'
import ProgramKnowledgeEditor from './ProgramKnowledgeEditor'

// ---------------------------------------------------------------------------
// ProgramKnowledgePane — Business Configuration > Program Knowledge.
// List of every program-knowledge note. Click a row → editor. "New" picks the
// program and creates a draft, then opens it. Admin-only writes are enforced by
// RLS; a non-admin who somehow reached this view can browse but not save.
// ---------------------------------------------------------------------------

const COLS = [
  { field: 'id',        label: 'Record #', type: 'text',   sortable: true,  filterable: false },
  { field: 'title',     label: 'Title',    type: 'text',   sortable: true,  filterable: true  },
  { field: 'program',   label: 'Program',  type: 'text',   sortable: true,  filterable: true  },
  { field: 'category',  label: 'Category', type: 'text',   sortable: true,  filterable: true  },
  { field: 'status',    label: 'Status',   type: 'select', sortable: true,  filterable: true,
    options: ['Published', 'Draft'] },
  { field: 'updatedAt', label: 'Updated',  type: 'text',   sortable: true,  filterable: false },
]

function shapeRow(r, programName) {
  return {
    id:        r.pka_record_number || r.id.slice(0, 8).toUpperCase(),
    _id:       r.id,
    title:     r.pka_title,
    program:   programName || '—',
    category:  r.pka_category || '—',
    status:    r.pka_is_published ? 'Published' : 'Draft',
    updatedAt: r.pka_updated_at ? new Date(r.pka_updated_at).toLocaleDateString() : '—',
  }
}

export default function ProgramKnowledgePane() {
  const [data,     setData]     = useState([])
  const [programs, setPrograms] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [openId,   setOpenId]   = useState(null)
  const [showNew,  setShowNew]  = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return Promise.all([fetchAllProgramKnowledgeArticles(), fetchPrograms()])
      .then(([rows, progs]) => {
        setPrograms(progs)
        const nameById = new Map(progs.map(p => [p._id, p.name || p.shortName]))
        setData(rows.map(r => shapeRow(r, nameById.get(r.program_id))))
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  if (openId) {
    return (
      <ProgramKnowledgeEditor
        articleId={openId}
        programs={programs}
        onBack={() => setOpenId(null)}
        onChanged={reload}
        onDeleted={() => { setOpenId(null); reload() }}
      />
    )
  }

  const systemViews = [
    { id: 'AV',  name: 'All',       filters: [],                                                      sortField: 'title', sortDir: 'asc' },
    { id: 'PUB', name: 'Published', filters: [{ field: 'status', op: 'equals', value: 'Published' }], sortField: 'title', sortDir: 'asc' },
    { id: 'DRF', name: 'Drafts',    filters: [{ field: 'status', op: 'equals', value: 'Draft' }],     sortField: 'title', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Program Knowledge</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.length} note${data.length === 1 ? '' : 's'} — internal, per-program knowledge the LEAP assistant answers from. Admin-only to edit.`}
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
          newLabel="Knowledge Note"
          onNew={() => setShowNew(true)}
          onOpenRecord={row => row?._id && setOpenId(row._id)}
          onRefresh={reload}
        />
      )}
      {showNew && (
        <NewProgramKnowledgeModal
          programs={programs}
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

function NewProgramKnowledgeModal({ programs, onClose, onCreated }) {
  const [programId, setProgramId] = useState('')
  const [title,     setTitle]     = useState('')
  const [category,  setCategory]  = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState(null)

  const submit = async () => {
    if (!programId)     { setError('Choose the program this note is about.'); return }
    if (!title.trim())  { setError('Title is required.'); return }
    setBusy(true)
    setError(null)
    try {
      const created = await createProgramKnowledgeArticle({
        program_id: programId,
        pka_title: title.trim(),
        pka_category: category.trim() || null,
        pka_body_markdown: '',
        pka_is_published: false,
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
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>New Program Knowledge Note</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Creates a draft. After it's open, write the note body and publish it so
            the assistant can answer from it.
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <FormField label="Program" required hint="The program this knowledge is about.">
            <select value={programId} onChange={e => setProgramId(e.target.value)} autoFocus style={inputStyle}>
              <option value="">— Select program —</option>
              {programs.map(p => (
                <option key={p._id} value={p._id}>
                  {p.name}{p.state && p.state !== '—' ? ` (${p.state})` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Title" required>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
          </FormField>
          <FormField label="Category" hint="Optional grouping — e.g. Rates, Eligibility, Process Changes, Exceptions.">
            <input type="text" value={category} onChange={e => setCategory(e.target.value)} style={inputStyle} />
          </FormField>
          {error && <div style={{ fontSize: 12, color: '#1a5a8a', marginBottom: 10 }}>{error}</div>}
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
