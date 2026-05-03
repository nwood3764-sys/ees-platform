import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import {
  fetchRoleById,
  fetchRoleObjectAccess, upsertRoleObjectAccess,
  fetchRoleFieldPermissions, upsertRoleFieldPermission,
} from '../../../data/permissionsService'
import ObjectAccessMatrix from './ObjectAccessMatrix'
import FieldVisibilityMatrix from './FieldVisibilityMatrix'

// ---------------------------------------------------------------------------
// RolePermissionsEditor — opened from the Roles list. Two tabs:
//   • Object Access     (role baseline)
//   • Field Visibility  (per-object, per-field)
// The header strip carries the role name, description, and a Back action.
// All saves go directly to role_object_access / field_permissions; there
// is no separate "Save" button at the editor level — each matrix manages
// its own dirty state.
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'objects', label: 'Object Access' },
  { id: 'fields',  label: 'Field Visibility' },
]

export default function RolePermissionsEditor({ roleId, onBack }) {
  const [role,    setRole]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('objects')

  // Object access lives in the editor (single fetch) so the matrix can show
  // dirty rows without re-fetching after every keystroke.
  const [objectAccess, setObjectAccess] = useState({})
  const [oaLoading,    setOaLoading]    = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRoleById(roleId)
      .then(r => { if (!cancelled) setRole(r) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [roleId])

  const reloadObjectAccess = useCallback(() => {
    setOaLoading(true)
    return fetchRoleObjectAccess(roleId)
      .then(map => setObjectAccess(map || {}))
      .finally(() => setOaLoading(false))
  }, [roleId])

  useEffect(() => { reloadObjectAccess() }, [reloadObjectAccess])

  // Save-handler bound for the Object Access matrix.
  const handleSaveObjectAccess = useCallback(async (objectName, perms) => {
    await upsertRoleObjectAccess(roleId, objectName, perms)
  }, [roleId])

  // Loaders + savers for the Field Visibility matrix.
  const loadFieldPerms = useCallback(
    (objectName) => fetchRoleFieldPermissions(roleId, objectName),
    [roleId]
  )
  const saveFieldPerm = useCallback(
    (objectName, fieldName, perms) => upsertRoleFieldPermission(roleId, objectName, fieldName, perms),
    [roleId]
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!role) return null

  const isAdminRole = role.role_name === 'Admin'

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 12, color: C.textMuted, marginBottom: 6,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to Roles
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: '#e8f8f2', color: '#1a7a4e',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14, flexShrink: 0,
          }}>
            {role.role_name?.[0]?.toUpperCase() || 'R'}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{role.role_name}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              {role.role_description || 'No description.'}
            </div>
          </div>
        </div>

        {isAdminRole && (
          <div style={{
            marginTop: 10,
            background: '#e8f3fb', border: '1px solid #b7d6ed',
            borderRadius: 6, padding: '8px 12px',
            fontSize: 12, color: '#1a4a72',
          }}>
            <strong>Admin role.</strong> The Admin role has full system access regardless of
            the rows below — the resolver short-circuits Admin to true on every check.
            Edits here have no functional effect today.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: '0 24px', display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              background: 'none', border: 'none',
              borderBottom: tab === t.id ? `2px solid ${C.emerald}` : '2px solid transparent',
              color: tab === t.id ? C.textPrimary : C.textMuted,
              fontSize: 12.5, fontWeight: tab === t.id ? 500 : 400,
              cursor: 'pointer', marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'objects' && (
          <ObjectAccessMatrix
            mode="role"
            loading={oaLoading}
            accessMap={objectAccess}
            onSave={handleSaveObjectAccess}
            onAfterSave={reloadObjectAccess}
          />
        )}
        {tab === 'fields' && (
          <FieldVisibilityMatrix
            mode="role"
            permsForObject={loadFieldPerms}
            saveFieldPerm={saveFieldPerm}
          />
        )}
      </div>
    </div>
  )
}
