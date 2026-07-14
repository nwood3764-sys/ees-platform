import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useIsMobile } from '../../lib/useMediaQuery'
import { fetchPageLayoutsFor, fetchPicklistsFor, fetchRoles } from '../../data/adminService'
import {
  createPageLayout,
  cloneFromLayout,
  softDeletePageLayout,
} from '../../data/pageLayoutBuilderService'
import {
  FormField,
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonSmSecondaryStyle, buttonSmDangerStyle,
  hintBoxStyle, dangerBoxStyle,
} from './adminStyles'

// ---------------------------------------------------------------------------
// LayoutsPane — Object Manager > Page Layouts tab.
//
// Upgraded from the read-only viewer: adds "New Layout" (blank or clone
// from existing), per-row Delete with reason capture, a Record Type column,
// and a Role column. Clicking a row still navigates into the editor.
// ---------------------------------------------------------------------------

export default function LayoutsPane({
  objectName,
  objectLabel,
  onSelectLayout,
  onCountChange,
}) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [roles, setRoles] = useState([])
  const [recordTypes, setRecordTypes] = useState([])
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState('name')   // name|recordType|role|updated
  const [sortDir, setSortDir] = useState('asc')

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const visibleRows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = needle
      ? rows.filter(l => JSON.stringify(l).toLowerCase().includes(needle))
      : [...rows]
    const get = (l) => {
      switch (sortKey) {
        case 'recordType': return (l.recordTypeLabel || '').toLowerCase()
        case 'role':       return (l.roleName || '').toLowerCase()
        case 'updated':    return l.updatedAt || ''
        default:           return (l.name || '').toLowerCase()
      }
    }
    list.sort((a, b) => {
      const av = get(a), bv = get(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rows, q, sortKey, sortDir])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Parallel: layouts + roles + record-type picklist values for modal dropdowns
      const [layoutRows, roleRows, picklistRows] = await Promise.all([
        fetchPageLayoutsFor(objectName),
        fetchRoles(),
        fetchPicklistsFor(objectName),
      ])
      setRows(layoutRows)
      setRoles(roleRows)
      setRecordTypes(picklistRows.filter(p => p.field === 'record_type' && p.status === 'Active'))
      if (onCountChange) onCountChange(layoutRows.length)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [objectName, onCountChange])

  useEffect(() => { refresh() }, [refresh])

  async function handleDelete(reason) {
    if (!deleteTarget || !reason.trim()) return
    try {
      await softDeletePageLayout(deleteTarget._id, reason.trim())
      toast.success(`Deleted "${deleteTarget.name}"`)
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      toast.error(`Could not delete: ${err.message || err}`)
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>Loading layouts…</div>
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: '#1a5a8a', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Could not load layouts</div>
        <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{String(error.message || error)}</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13.5, color: C.textSecondary }}>
          {rows.length === 0
            ? 'No layouts for this object yet.'
            : `${visibleRows.length}${q.trim() ? ` of ${rows.length}` : ''} layout${rows.length === 1 ? '' : 's'}`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {rows.length > 0 && (
            <div style={{ position: 'relative', width: 220 }}>
              <input
                value={q} onChange={e => setQ(e.target.value)} placeholder="Search layouts…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px 7px 30px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.page, color: C.textPrimary, outline: 'none' }}
              />
              <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </span>
            </div>
          )}
          <button onClick={() => setModalOpen(true)} style={buttonPrimaryStyle}>
            <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" />
            New Layout
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{
          padding: '50px 24px', textAlign: 'center',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          <div style={{ color: C.textPrimary, fontWeight: 500, fontSize: 14, marginBottom: 6 }}>
            No Page Layouts yet
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, maxWidth: 520, margin: '0 auto', lineHeight: 1.5 }}>
            Page layouts control how records of this object are displayed and edited.
            Create one to get started.
          </div>
        </div>
      ) : (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden',
        }}>
          <div style={tableHeaderStyle}>
            <div>Record #</div>
            <div onClick={() => toggleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>Name <SortArrow active={sortKey === 'name'} dir={sortDir} /></div>
            <div onClick={() => toggleSort('recordType')} style={{ cursor: 'pointer', userSelect: 'none' }}>Record Type <SortArrow active={sortKey === 'recordType'} dir={sortDir} /></div>
            <div onClick={() => toggleSort('role')} style={{ cursor: 'pointer', userSelect: 'none' }}>Role <SortArrow active={sortKey === 'role'} dir={sortDir} /></div>
            <div style={{ textAlign: 'center' }}>Default</div>
            <div onClick={() => toggleSort('updated')} style={{ cursor: 'pointer', userSelect: 'none' }}>Updated <SortArrow active={sortKey === 'updated'} dir={sortDir} /></div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>
          {visibleRows.map(l => (
            <LayoutRow
              key={l._id}
              layout={l}
              onOpen={() => onSelectLayout(l._id)}
              onDelete={() => setDeleteTarget(l)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewLayoutModal
          objectName={objectName}
          objectLabel={objectLabel || objectName}
          existingLayouts={rows}
          roles={roles}
          recordTypes={recordTypes}
          onClose={() => setModalOpen(false)}
          onCreated={async (newLayoutId) => {
            setModalOpen(false)
            await refresh()
            // Drop the user straight into the editor for the new layout
            if (newLayoutId) onSelectLayout(newLayoutId)
          }}
        />
      )}

      {deleteTarget && (
        <DeleteLayoutModal
          layout={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}

// ─── Row ───────────────────────────────────────────────────────────────

function LayoutRow({ layout, onOpen, onDelete }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...tableRowStyle,
        cursor: 'pointer',
        background: hover ? '#f7f9fc' : 'transparent',
      }}
    >
      <div style={{ color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {layout.id}
      </div>
      <div style={{ color: C.emerald, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {layout.name}
        {layout.type === 'review' && (
          <span style={{ background: '#e8f1fb', color: '#1e466b', border: '1px solid #bcd9f2', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, marginLeft: 6, verticalAlign: 'middle' }}>Review</span>
        )}
      </div>
      <div style={{ color: C.textSecondary, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {layout.recordTypeLabel || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Master</span>}
      </div>
      <div style={{ color: C.textSecondary, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {layout.roleName || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>All roles</span>}
      </div>
      <div style={{ textAlign: 'center' }}>
        {layout.isDefault === 'Yes' ? (
          <span style={{ background: '#e8f8f2', color: '#1a7a4e', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>Default</span>
        ) : <span style={{ color: C.textMuted }}>—</span>}
      </div>
      <div style={{ color: C.textSecondary, fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace' }}>
        {layout.updatedAt}
      </div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        <button
          style={buttonSmDangerStyle}
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ─── New Layout modal ──────────────────────────────────────────────────

function NewLayoutModal({
  objectName, objectLabel, existingLayouts, roles, recordTypes,
  onClose, onCreated,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()
  const firstInputRef = useRef(null)

  const [mode, setMode] = useState('blank') // 'blank' | 'clone'
  // 'record_detail' (record pages) or 'review' (fields shown to a reviewer on
  // the verification review screen — Salesforce approval-page-layout parity).
  const [layoutType, setLayoutType] = useState('record_detail')
  const [sourceLayoutId, setSourceLayoutId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [roleId, setRoleId] = useState('')
  const [recordTypeId, setRecordTypeId] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // When switching to clone mode or picking a source, seed sensible defaults.
  useEffect(() => {
    if (mode === 'clone' && sourceLayoutId) {
      const source = existingLayouts.find(l => l._id === sourceLayoutId)
      if (source) {
        if (!name) setName(`Copy of ${source.name}`)
        setRoleId(source.roleId || '')
        setRecordTypeId(source.recordTypeId || '')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sourceLayoutId])

  useEffect(() => {
    const id = requestAnimationFrame(() => firstInputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  function validate() {
    if (!name.trim()) return 'Name is required'
    if (mode === 'clone' && !sourceLayoutId) return 'Pick a source layout to clone from'
    return null
  }

  // Warn if a default already exists in the same scope — they'll be demoted.
  // Scope includes the layout type: a review layout never conflicts with a
  // record-page layout.
  const effectiveType = mode === 'clone'
    ? (existingLayouts.find(l => l._id === sourceLayoutId)?.type || 'record_detail')
    : layoutType
  const conflictingDefault = isDefault
    ? existingLayouts.find(l =>
        l.isDefault === 'Yes' &&
        (l.type || 'record_detail') === effectiveType &&
        (l.roleId || null) === (roleId || null) &&
        (l.recordTypeId || null) === (recordTypeId || null),
      )
    : null

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      let newId
      if (mode === 'blank') {
        newId = await createPageLayout({
          object: objectName,
          type: layoutType,
          name: name.trim(),
          description: description.trim() || null,
          roleId: roleId || null,
          recordTypeId: recordTypeId || null,
          isDefault,
        })
      } else {
        newId = await cloneFromLayout({
          sourceLayoutId,
          name: name.trim(),
          description: description.trim() || null,
          roleId: roleId || null,
          recordTypeId: recordTypeId || null,
          isDefault,
        })
      }
      toast.success(`Created "${name.trim()}"`)
      onCreated(newId)
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="New Layout" style={{
        background: C.card,
        borderRadius: isMobile ? '12px 12px 0 0' : 10,
        padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
        width: isMobile ? '100%' : 560,
        maxWidth: '100%',
        maxHeight: isMobile ? '92vh' : '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>New Page Layout</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            on <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{objectName}</span>
          </div>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
          marginBottom: 18,
        }}>
          <ModeButton
            label="Blank"
            hint="Start fresh — no sections or widgets"
            active={mode === 'blank'}
            onClick={() => { setMode('blank'); setError(null) }}
            disabled={busy}
          />
          <ModeButton
            label="Clone existing"
            hint="Copy sections + widgets from another layout"
            active={mode === 'clone'}
            onClick={() => { setMode('clone'); setError(null) }}
            disabled={busy || existingLayouts.length === 0}
          />
        </div>

        {/* Source picker (clone mode only) */}
        {mode === 'clone' && (
          <FormField label="Source layout" hint="The new layout starts as a copy of this one.">
            <select
              value={sourceLayoutId}
              onChange={e => setSourceLayoutId(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— Select a source —</option>
              {existingLayouts.map(l => (
                <option key={l._id} value={l._id}>
                  {l.name}{l.isDefault === 'Yes' ? ' (default)' : ''}
                  {l.recordTypeLabel ? ` · ${l.recordTypeLabel}` : ''}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {/* Layout type (blank mode only — clones inherit the source's type) */}
        {mode === 'blank' && (
          <FormField label="Layout type" hint="Record Page drives the record detail view. Review Page controls which fields a reviewer sees on the verification review screen.">
            <select
              value={layoutType}
              onChange={e => setLayoutType(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="record_detail">Record Page</option>
              <option value="review">Review Page</option>
            </select>
          </FormField>
        )}

        <FormField label="Name" required>
          <input
            ref={firstInputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={busy}
            placeholder={mode === 'clone' ? 'Copy of …' : `${objectLabel} Detail`}
            style={inputStyle}
          />
        </FormField>

        <FormField label="Description" hint="Optional — shown in the layouts list.">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={busy}
            placeholder="What this layout is for…"
            style={textareaStyle}
          />
        </FormField>

        <FormField label="Role" hint="Leave blank for all roles (most common).">
          <select
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
            disabled={busy}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">All roles</option>
            {roles.map(r => (
              <option key={r._id} value={r._id}>{r.name}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Record Type" hint="Which record type this layout applies to. Blank = the master/default layout.">
          <select
            value={recordTypeId}
            onChange={e => setRecordTypeId(e.target.value)}
            disabled={busy}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="">Master (no specific record type)</option>
            {recordTypes.map(rt => (
              <option key={rt._id} value={rt._id}>{rt.label}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Default layout for this scope">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={e => setIsDefault(e.target.checked)}
              disabled={busy}
            />
            Use this layout by default for its (record type, role) combination
          </label>
        </FormField>

        {conflictingDefault && (
          <div style={hintBoxStyle}>
            <strong>Heads up:</strong> <em>"{conflictingDefault.name}"</em> is currently the default
            for this combination. It will be demoted automatically so the new layout can take its place.
          </div>
        )}

        {error && <div style={dangerBoxStyle}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button onClick={submit} disabled={busy} style={buttonPrimaryStyle}>
            {busy ? 'Creating…' : 'Create Layout'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeButton({ label, hint, active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '12px 14px',
        border: `1.5px solid ${active ? C.emerald : C.border}`,
        borderRadius: 8,
        background: active ? '#f0f9f5' : C.card,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        textAlign: 'left',
        transition: 'border 0.1s, background 0.1s',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.emerald : C.textPrimary, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>{hint}</div>
    </button>
  )
}

// ─── Delete Layout modal ───────────────────────────────────────────────

function DeleteLayoutModal({ layout, onClose, onConfirm }) {
  const isMobile = useIsMobile()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const reasonRef = useRef(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => reasonRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  async function confirm() {
    if (!reason.trim()) return
    setBusy(true)
    await onConfirm(reason)
    setBusy(false)
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Delete layout" style={{
        background: C.card,
        borderRadius: isMobile ? '12px 12px 0 0' : 10,
        padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
        width: isMobile ? '100%' : 440,
        maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>Delete this layout?</div>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          <strong>{layout.name}</strong> will be soft-deleted. Records that use this layout will
          fall back to the master/default layout for their scope. You can recover from the recycle bin.
        </div>

        <FormField label="Reason" hint="Required — recorded on the layout for audit purposes." required>
          <input
            ref={reasonRef}
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={busy}
            placeholder="e.g. Consolidated into the Single Family layout"
            style={inputStyle}
          />
        </FormField>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
          <button
            onClick={confirm}
            disabled={busy || !reason.trim()}
            style={{ ...buttonPrimaryStyle, background: '#1a5a8a' }}
          >
            {busy ? 'Deleting…' : 'Delete Layout'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────

function SortArrow({ active, dir }) {
  return (
    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.25, fontSize: 9 }}>
      {active ? (dir === 'asc' ? '▲' : '▼') : '▲'}
    </span>
  )
}

const GRID_COLS = '120px 2fr 1.2fr 1.1fr 80px 110px 100px'

const tableHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: GRID_COLS,
  gap: 12,
  fontSize: 11, fontWeight: 600, color: C.textMuted,
  textTransform: 'uppercase', letterSpacing: '0.04em',
  padding: '10px 14px', background: '#fafbfd',
  borderBottom: `1px solid ${C.border}`,
}

const tableRowStyle = {
  display: 'grid',
  gridTemplateColumns: GRID_COLS,
  gap: 12,
  alignItems: 'center',
  padding: '10px 14px', fontSize: 12.5,
  borderBottom: `1px solid ${C.border}`,
  transition: 'background 0.1s',
}
