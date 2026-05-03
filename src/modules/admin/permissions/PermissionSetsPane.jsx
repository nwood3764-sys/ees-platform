import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { ListView } from '../../../components/ListView'
import {
  fetchPermissionSetsList, createPermissionSet,
} from '../../../data/permissionsService'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, FormField,
} from '../adminStyles'
import PermissionSetEditor from './PermissionSetEditor'

// ---------------------------------------------------------------------------
// PermissionSetsPane — Administration > Permission Sets.
// List view with a "New" action. Click a row → PermissionSetEditor.
// ---------------------------------------------------------------------------

const COLS = [
  { field: 'id',          label: 'Record #',     type: 'text', sortable: true, filterable: false },
  { field: 'name',        label: 'Permission Set', type: 'text', sortable: true, filterable: true },
  { field: 'description', label: 'Description',  type: 'text', sortable: false, filterable: true },
  { field: 'status',      label: 'Status',       type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
  { field: 'updatedAt',   label: 'Updated',      type: 'text', sortable: true, filterable: false },
]

function shapeRow(r) {
  return {
    id:          r.id.slice(0, 8).toUpperCase(),
    _id:         r.id,
    name:        r.ps_name,
    description: r.ps_description || '—',
    status:      r.ps_is_active ? 'Active' : 'Inactive',
    updatedAt:   r.ps_updated_at ? new Date(r.ps_updated_at).toLocaleDateString() : '—',
  }
}

export default function PermissionSetsPane() {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [openId,  setOpenId]  = useState(null)
  const [showNew, setShowNew] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchPermissionSetsList()
      .then(rows => setData(rows.map(shapeRow)))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  if (openId) {
    return (
      <PermissionSetEditor
        psId={openId}
        onBack={() => setOpenId(null)}
        onChanged={reload}
      />
    )
  }

  const systemViews = [
    { id: 'AV',   name: 'All',    filters: [],                                                     sortField: 'name', sortDir: 'asc' },
    { id: 'ACT',  name: 'Active', filters: [{ field: 'status', op: 'equals', value: 'Active' }],   sortField: 'name', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Permission Sets</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading
            ? 'Loading…'
            : `${data.length} permission set${data.length === 1 ? '' : 's'} — additive grants assigned to specific users on top of their role baseline`}
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
          newLabel="Permission Set"
          onNew={() => setShowNew(true)}
          onOpenRecord={row => row?._id && setOpenId(row._id)}
          onRefresh={reload}
        />
      )}

      {showNew && (
        <NewPermissionSetModal
          onClose={() => setShowNew(false)}
          onCreated={(newPS) => {
            setShowNew(false)
            reload()
            setOpenId(newPS.id)
          }}
        />
      )}
    </div>
  )
}

function NewPermissionSetModal({ onClose, onCreated }) {
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)

  const submit = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setBusy(true)
    setError(null)
    try {
      const created = await createPermissionSet({
        ps_name: name.trim(),
        ps_description: description.trim() || null,
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
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>New Permission Set</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            After creating, you&rsquo;ll land on the editor where you can add object access, field
            visibility overrides, and user assignments.
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <FormField label="Name" required hint="Short and descriptive — e.g. &lsquo;Financial Visibility&rsquo;.">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
          </FormField>
          <FormField label="Description" hint="Optional. What does this permission set grant?">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              style={textareaStyle}
              rows={3}
            />
          </FormField>
          {error && <div style={{ fontSize: 12, color: '#b03a2e', marginBottom: 10 }}>{error}</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            style={{ ...buttonPrimaryStyle, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Creating…' : 'Create'}
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
