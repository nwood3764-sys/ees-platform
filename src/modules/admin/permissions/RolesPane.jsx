import { useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import { ListView } from '../../../components/ListView'
import { fetchRoles } from '../../../data/adminService'
import RolePermissionsEditor from './RolePermissionsEditor'

// ---------------------------------------------------------------------------
// RolesPane — Administration > Roles.
//
// Differs from a generic NodePage in that clicking a row opens the
// dedicated RolePermissionsEditor (Object Access + Field Visibility tabs)
// rather than the generic page-layout-driven RecordDetail. We need a
// purpose-built editor here because access is matrix-shaped, not the
// vertical form layout that page_layouts emits.
//
// Editing the role's name/description happens elsewhere (Object Manager →
// Roles → row → standard RecordDetail). This pane is exclusively the
// permission-editing surface.
// ---------------------------------------------------------------------------

const ROLE_COLS = [
  { field: 'id',          label: 'Record #',    type: 'text', sortable: true, filterable: false },
  { field: 'name',        label: 'Role',        type: 'text', sortable: true, filterable: true },
  { field: 'description', label: 'Description', type: 'text', sortable: false, filterable: true },
  { field: 'status',      label: 'Status',      type: 'select', sortable: true, filterable: true, options: ['Active', 'Inactive'] },
]

export default function RolesPane() {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [openId,  setOpenId]  = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRoles()
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (openId) {
    return <RolePermissionsEditor roleId={openId} onBack={() => setOpenId(null)} />
  }

  const systemViews = [
    { id: 'AV',   name: 'All',      filters: [],                                                   sortField: 'name', sortDir: 'asc' },
    { id: 'ACT',  name: 'Active',   filters: [{ field: 'status', op: 'equals', value: 'Active' }], sortField: 'name', sortDir: 'asc' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Roles</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          {loading ? 'Loading…' : `${data.length} role${data.length === 1 ? '' : 's'} — click a row to edit object and field-level access`}
        </div>
      </div>
      {loading && <LoadingState />}
      {error && !loading && <ErrorState error={error} />}
      {!loading && !error && (
        <ListView
          data={data}
          columns={ROLE_COLS}
          systemViews={systemViews}
          defaultViewId="AV"
          newLabel={null}
          onOpenRecord={row => row?._id && setOpenId(row._id)}
        />
      )}
    </div>
  )
}
