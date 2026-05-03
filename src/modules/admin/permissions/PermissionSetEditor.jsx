import { useCallback, useEffect, useState } from 'react'
import { C } from '../../../data/constants'
import { LoadingState, ErrorState } from '../../../components/UI'
import {
  fetchPermissionSetById, updatePermissionSet, softDeletePermissionSet,
  fetchPSObjectAccess, upsertPSObjectAccess,
  fetchPSFieldPermissions, upsertPSFieldPermission, deletePSFieldPermission,
  fetchUsersAssignedToPS, fetchAssignableUsers,
  assignUserToPS, unassignUserFromPS,
} from '../../../data/permissionsService'
import {
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonDangerStyle,
  hintBoxStyle, FormField,
} from '../adminStyles'
import ObjectAccessMatrix from './ObjectAccessMatrix'
import FieldVisibilityMatrix from './FieldVisibilityMatrix'

// ---------------------------------------------------------------------------
// PermissionSetEditor — opened from the Permission Sets list. Four tabs:
//   • Details            — name / description / active / soft-delete
//   • Object Access      — additive grants on top of any role baseline
//   • Field Visibility   — per-object overrides (most-restrictive wins)
//   • Assigned Users     — manage user_permission_sets junction
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'details', label: 'Details' },
  { id: 'objects', label: 'Object Access' },
  { id: 'fields',  label: 'Field Visibility' },
  { id: 'users',   label: 'Assigned Users' },
]

export default function PermissionSetEditor({ psId, onBack, onChanged }) {
  const [ps,      setPS]      = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('details')

  const [objectAccess, setObjectAccess] = useState({})
  const [oaLoading,    setOaLoading]    = useState(true)

  const reloadPS = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchPermissionSetById(psId)
      .then(setPS)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [psId])

  const reloadObjectAccess = useCallback(() => {
    setOaLoading(true)
    return fetchPSObjectAccess(psId)
      .then(map => setObjectAccess(map || {}))
      .finally(() => setOaLoading(false))
  }, [psId])

  useEffect(() => { reloadPS() }, [reloadPS])
  useEffect(() => { reloadObjectAccess() }, [reloadObjectAccess])

  const handleSaveObjectAccess = useCallback(async (objectName, perms) => {
    await upsertPSObjectAccess(psId, objectName, perms)
  }, [psId])

  const loadFieldPerms = useCallback(
    (objectName) => fetchPSFieldPermissions(psId, objectName),
    [psId]
  )
  const saveFieldPerm = useCallback(async (objectName, fieldName, perms) => {
    // Permission sets always persist explicit overrides; "default" rows are
    // still meaningful as overrides. Use upsert unless every value is at the
    // visible+editable+no-tier baseline AND the user explicitly clears the
    // tier — in that case let them remove the override.
    await upsertPSFieldPermission(psId, objectName, fieldName, perms)
  }, [psId])

  if (loading) return <LoadingState />
  if (error) return <ErrorState error={error} />
  if (!ps) return null

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
          Back to Permission Sets
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: '#fef3e2', color: '#8a5a0a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14, flexShrink: 0,
          }}>
            {ps.ps_name?.[0]?.toUpperCase() || 'P'}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>{ps.ps_name}</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              {ps.ps_description || 'No description.'}
              <span style={{ marginLeft: 10 }}>
                {ps.ps_is_active
                  ? <span style={{ color: '#1a7a4e' }}>● Active</span>
                  : <span style={{ color: C.textMuted }}>○ Inactive</span>}
              </span>
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
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'details' && (
          <DetailsTab
            ps={ps}
            onUpdated={async () => { await reloadPS(); onChanged && onChanged() }}
            onDeleted={() => { onChanged && onChanged(); onBack() }}
          />
        )}
        {tab === 'objects' && (
          <ObjectAccessMatrix
            mode="pset"
            loading={oaLoading}
            accessMap={objectAccess}
            onSave={handleSaveObjectAccess}
            onAfterSave={reloadObjectAccess}
          />
        )}
        {tab === 'fields' && (
          <FieldVisibilityMatrix
            mode="pset"
            permsForObject={loadFieldPerms}
            saveFieldPerm={saveFieldPerm}
          />
        )}
        {tab === 'users' && (
          <AssignedUsersTab psId={psId} psName={ps.ps_name} />
        )}
      </div>
    </div>
  )
}

// ─── Details tab ─────────────────────────────────────────────────────────

function DetailsTab({ ps, onUpdated, onDeleted }) {
  const [name,        setName]        = useState(ps.ps_name || '')
  const [description, setDescription] = useState(ps.ps_description || '')
  const [isActive,    setIsActive]    = useState(!!ps.ps_is_active)
  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [error,       setError]       = useState(null)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [delReason,   setDelReason]   = useState('')

  const dirty =
    name !== (ps.ps_name || '') ||
    description !== (ps.ps_description || '') ||
    isActive !== !!ps.ps_is_active

  const save = async () => {
    if (!dirty || saving) return
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await updatePermissionSet(ps.id, {
        ps_name: name.trim(),
        ps_description: description.trim() || null,
        ps_is_active: isActive,
      })
      await onUpdated()
    } catch (e) { setError(e?.message || String(e)) }
    finally { setSaving(false) }
  }

  const performDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await softDeletePermissionSet(ps.id, delReason.trim() || null)
      onDeleted()
    } catch (e) { setError(e?.message || String(e)); setDeleting(false) }
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: 640 }}>
        <div style={hintBoxStyle}>
          A permission set is a named bundle of additive grants. Assign it to specific users
          on the <strong>Assigned Users</strong> tab. Users keep their role baseline and gain
          whatever this permission set adds.
        </div>

        <FormField label="Name" required hint="Short, descriptive — e.g. &lsquo;Financial Visibility&rsquo;, &lsquo;Verification Reviewer&rsquo;.">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            style={inputStyle}
          />
        </FormField>

        <FormField label="Description" hint="What does this permission set grant, and who should it be assigned to?">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={textareaStyle}
            rows={3}
          />
        </FormField>

        <FormField label="Status">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: C.emerald }}
            />
            Active
          </label>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
            Inactive permission sets are still visible here but are ignored by the resolver.
          </div>
        </FormField>

        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#b03a2e' }}>{error}</div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={!dirty || saving}
            style={{ ...buttonPrimaryStyle, opacity: !dirty || saving ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Delete */}
        <div style={{
          marginTop: 32, paddingTop: 18, borderTop: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 4 }}>
            Delete this permission set
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
            Soft delete — the row is hidden from the list and ignored by the resolver, but
            recoverable from the recycle bin. Existing user assignments are not removed; if
            you restore the set, they take effect again.
          </div>
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} style={buttonDangerStyle}>
              Delete permission set
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FormField label="Deletion reason" hint="Optional but recommended — appears in the audit log.">
                <input
                  type="text"
                  value={delReason}
                  onChange={e => setDelReason(e.target.value)}
                  style={inputStyle}
                  placeholder="e.g. consolidated into Financial Visibility v2"
                />
              </FormField>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={performDelete} disabled={deleting}
                  style={{ ...buttonDangerStyle, opacity: deleting ? 0.6 : 1 }}>
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
                <button type="button" onClick={() => setConfirmDel(false)} disabled={deleting}
                  style={buttonSecondaryStyle}>
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

// ─── Assigned Users tab ─────────────────────────────────────────────────

function AssignedUsersTab({ psId, psName }) {
  const [assigned, setAssigned] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [showPicker, setShowPicker] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    return fetchUsersAssignedToPS(psId)
      .then(setAssigned)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [psId])

  useEffect(() => { reload() }, [reload])

  const handleUnassign = async (assignmentId) => {
    if (!window.confirm('Remove this assignment?')) return
    try {
      await unassignUserFromPS(assignmentId)
      await reload()
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 0' }}>
        <div style={hintBoxStyle}>
          Users assigned this permission set keep their base role and gain the additional
          access defined in <strong>Object Access</strong> and <strong>Field Visibility</strong>.
          Removing an assignment is immediate.
        </div>
      </div>

      <div style={{ padding: '0 24px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: C.textSecondary }}>
          {loading ? 'Loading…' : `${assigned.length} user${assigned.length === 1 ? '' : 's'} assigned`}
        </div>
        <button type="button" onClick={() => setShowPicker(true)} style={buttonPrimaryStyle}>
          Assign user
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {loading && <LoadingState />}
        {error && !loading && <ErrorState error={error} />}
        {!loading && !error && (
          <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Active</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {assigned.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: C.textMuted }}>
                    No users assigned to {psName}.
                  </td>
                </tr>
              )}
              {assigned.map(u => (
                <tr key={u.id}>
                  <td style={tdStyle}>{u.name}</td>
                  <td style={tdStyle}>{u.role}</td>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}>
                    {u.isActive
                      ? <span style={{ color: '#1a7a4e' }}>Active</span>
                      : <span style={{ color: C.textMuted }}>Inactive</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button type="button" onClick={() => handleUnassign(u.id)}
                      style={{
                        background: 'none', border: 'none', padding: 0,
                        color: '#b03a2e', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                      }}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPicker && (
        <UserPickerModal
          psId={psId}
          excludeUserIds={new Set(assigned.map(a => a.userId))}
          onClose={() => setShowPicker(false)}
          onAssigned={async () => {
            setShowPicker(false)
            await reload()
          }}
        />
      )}
    </div>
  )
}

// Modal: pick a user to assign to this permission set.
function UserPickerModal({ psId, excludeUserIds, onClose, onAssigned }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [busyId,  setBusyId]  = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAssignableUsers()
      .then(d => { if (!cancelled) setUsers(d) })
      .catch(e => { if (!cancelled) setError(e) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = users
    .filter(u => !excludeUserIds.has(u.id))
    .filter(u => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return u.name.toLowerCase().includes(q) ||
             u.email.toLowerCase().includes(q) ||
             u.role.toLowerCase().includes(q)
    })

  const assign = async (userId) => {
    setBusyId(userId)
    try {
      await assignUserToPS(userId, psId)
      await onAssigned()
    } catch (e) {
      setError(e)
      setBusyId(null)
    }
  }

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary }}>Assign User</div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: C.textMuted }}
            aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}` }}>
          <input
            type="text"
            placeholder="Search by name, email, or role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
            style={inputStyle}
          />
        </div>

        <div style={{ flex: 1, overflow: 'auto', maxHeight: '50vh' }}>
          {loading && <LoadingState />}
          {error && !loading && <ErrorState error={error} />}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 12.5 }}>
              {users.length === 0 ? 'No users available.' : 'No users match your search.'}
            </div>
          )}
          {!loading && !error && filtered.map(u => (
            <div key={u.id} style={{
              padding: '10px 18px',
              borderBottom: `1px solid ${C.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 500, color: C.textPrimary, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.name}
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted }}>
                  {u.role} · {u.email}
                </div>
              </div>
              <button type="button" onClick={() => assign(u.id)} disabled={busyId === u.id}
                style={{ ...buttonPrimaryStyle, padding: '5px 10px', fontSize: 12, opacity: busyId === u.id ? 0.6 : 1 }}>
                {busyId === u.id ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          ))}
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
  width: '90%', maxWidth: 520,
  maxHeight: '80vh',
  display: 'flex', flexDirection: 'column',
  boxShadow: '0 12px 32px rgba(13,26,46,0.18)',
  overflow: 'hidden',
}

const thStyle = {
  padding: '8px 8px',
  fontSize: 11,
  fontWeight: 600,
  color: C.textSecondary,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  textAlign: 'left',
  background: C.card,
  borderBottom: `2px solid ${C.borderDark}`,
  position: 'sticky',
  top: 0,
}
const tdStyle = {
  padding: '8px 8px',
  borderBottom: `1px solid ${C.border}`,
  fontSize: 12.5,
  color: C.textPrimary,
  verticalAlign: 'middle',
}
