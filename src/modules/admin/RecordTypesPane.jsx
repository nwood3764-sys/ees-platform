import { useState, useEffect, useCallback, useRef } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { useIsMobile } from '../../lib/useMediaQuery'
import {
  listRecordTypesForObject,
  createRecordTypeWithLayout,
  updateRecordType,
  deactivateRecordType,
  reactivateRecordType,
  cloneFromLayout,
} from '../../data/pageLayoutBuilderService'
import { fetchPageLayoutsFor } from '../../data/adminService'

// ---------------------------------------------------------------------------
// RecordTypesPane — Object Manager > Record Types tab.
//
// List + create + deactivate/reactivate + inline edit. Per-row shortcut to
// create a layout for a record type that doesn't have one yet. The "New
// Record Type" modal asks for Value, Label, Sort Order, and a Page Layout
// strategy (see NewRecordTypeModal for the four strategies).
// ---------------------------------------------------------------------------

export default function RecordTypesPane({ objectName, objectLabel, onCountChange }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [layouts, setLayouts] = useState([])       // all layouts on this object — for dropdowns
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [busyRowId, setBusyRowId] = useState(null)
  const [editingRowId, setEditingRowId] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [types, layoutRows] = await Promise.all([
        listRecordTypesForObject(objectName),
        fetchPageLayoutsFor(objectName),
      ])
      setRows(types)
      setLayouts(layoutRows)
      // Report count upward so the sub-tab badge stays in sync.
      if (onCountChange) onCountChange(types.length)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [objectName, onCountChange])

  useEffect(() => { refresh() }, [refresh])

  async function handleDeactivate(row) {
    setBusyRowId(row.id)
    try {
      await deactivateRecordType(row.id)
      toast.success(`Deactivated "${row.label}"`)
      await refresh()
    } catch (err) {
      toast.error(`Could not deactivate: ${err.message || err}`)
    } finally {
      setBusyRowId(null)
    }
  }

  async function handleReactivate(row) {
    setBusyRowId(row.id)
    try {
      await reactivateRecordType(row.id)
      toast.success(`Reactivated "${row.label}"`)
      await refresh()
    } catch (err) {
      toast.error(`Could not reactivate: ${err.message || err}`)
    } finally {
      setBusyRowId(null)
    }
  }

  async function handleCreateLayout(row) {
    // Inline shortcut: clone the master layout and assign to this record type.
    // Only available on rows with no assigned layout yet.
    const master = layouts.find(l => l.isDefault === 'Yes')
    if (!master) {
      toast.error('No default layout exists for this object — create one first.')
      return
    }
    setBusyRowId(row.id)
    try {
      await cloneFromLayout({
        sourceLayoutId: master._id,
        name: `${row.label} — ${objectLabel || objectName}`,
        recordTypeId: row.id,
        isDefault: true,
      })
      toast.success(`Created layout for "${row.label}"`)
      await refresh()
    } catch (err) {
      toast.error(`Could not create layout: ${err.message || err}`)
    } finally {
      setBusyRowId(null)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
        Loading record types…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: '#b03a2e', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
          Could not load record types
        </div>
        <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
          {String(error.message || error)}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* Header bar: count + "New Record Type" button */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13.5, color: C.textSecondary }}>
          {rows.length === 0
            ? 'No record types defined yet.'
            : `${rows.length} record type${rows.length === 1 ? '' : 's'}`}
        </div>
        <button
          onClick={() => setModalOpen(true)}
          style={buttonPrimaryStyle}
        >
          <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" />
          New Record Type
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{
          padding: '50px 24px', textAlign: 'center',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          <div style={{ color: C.textPrimary, fontWeight: 500, fontSize: 14, marginBottom: 6 }}>
            No Record Types yet
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, maxWidth: 520, margin: '0 auto', lineHeight: 1.5 }}>
            Record types let you give different records on the same object their own page layouts.
            Create one to get started.
          </div>
        </div>
      ) : (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          overflow: 'hidden',
        }}>
          {/* Desktop table header */}
          <div style={tableHeaderStyle}>
            <div>Value</div>
            <div>Label</div>
            <div style={{ textAlign: 'center' }}>Order</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div>Assigned Layout</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {rows.map(row => (
            <RecordTypeRow
              key={row.id}
              row={row}
              busy={busyRowId === row.id}
              editing={editingRowId === row.id}
              onStartEdit={() => setEditingRowId(row.id)}
              onCancelEdit={() => setEditingRowId(null)}
              onSaved={async () => { setEditingRowId(null); await refresh() }}
              onDeactivate={() => handleDeactivate(row)}
              onReactivate={() => handleReactivate(row)}
              onCreateLayout={() => handleCreateLayout(row)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewRecordTypeModal
          objectName={objectName}
          objectLabel={objectLabel || objectName}
          existingValues={rows.map(r => r.value)}
          layouts={layouts}
          onClose={() => setModalOpen(false)}
          onCreated={async (result) => {
            setModalOpen(false)
            await refresh()
            if (result?.layoutId) {
              toast.success(`Created record type with layout`)
            } else {
              toast.success(`Created record type "${result?.label || ''}"`)
            }
          }}
        />
      )}
    </div>
  )
}

// ─── Record Type Row ───────────────────────────────────────────────────

function RecordTypeRow({
  row, busy, editing,
  onStartEdit, onCancelEdit, onSaved,
  onDeactivate, onReactivate, onCreateLayout,
}) {
  const toast = useToast()
  const [label, setLabel] = useState(row.label)
  const [value, setValue] = useState(row.value)
  const [sortOrder, setSortOrder] = useState(String(row.sortOrder))
  const [saving, setSaving] = useState(false)

  // Reset local state when row changes or edit is cancelled
  useEffect(() => {
    if (!editing) {
      setLabel(row.label)
      setValue(row.value)
      setSortOrder(String(row.sortOrder))
    }
  }, [row.id, editing, row.label, row.value, row.sortOrder])

  async function save() {
    if (!label.trim() || !value.trim()) {
      toast.error('Value and Label are required')
      return
    }
    if (!/^[a-z0-9_]+$/.test(value)) {
      toast.error('Value must use lowercase letters, numbers, and underscores only')
      return
    }
    setSaving(true)
    try {
      await updateRecordType(row.id, {
        label: label.trim(),
        value: value.trim(),
        sortOrder: parseInt(sortOrder, 10) || 0,
      })
      toast.success('Record type updated')
      onSaved()
    } catch (err) {
      toast.error(`Could not save: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      ...tableRowStyle,
      opacity: !row.isActive ? 0.55 : 1,
      background: busy ? '#f7f9fc' : 'transparent',
    }}>
      {/* Value */}
      <div style={{ color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, minWidth: 0 }}>
        {editing
          ? <TextInput value={value} onChange={setValue} mono placeholder="single_family" />
          : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>{row.value}</span>
        }
      </div>

      {/* Label */}
      <div style={{ color: C.textPrimary, fontSize: 12.5, minWidth: 0 }}>
        {editing
          ? <TextInput value={label} onChange={setLabel} placeholder="Single Family" />
          : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '100%' }}>{row.label}</span>
        }
      </div>

      {/* Order */}
      <div style={{ textAlign: 'center', color: C.textSecondary, fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>
        {editing
          ? <TextInput value={sortOrder} onChange={setSortOrder} mono type="number" width={64} center />
          : <span>{row.sortOrder}</span>
        }
      </div>

      {/* Status */}
      <div style={{ textAlign: 'center' }}>
        {row.isActive ? (
          <span style={{ background: '#e8f8f2', color: '#1a7a4e', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3 }}>
            Active
          </span>
        ) : (
          <span style={{ background: '#f0f3f8', color: '#8fa0b8', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3 }}>
            Inactive
          </span>
        )}
      </div>

      {/* Assigned Layout */}
      <div style={{ color: C.textSecondary, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.assignedLayoutName ? (
          <span style={{ color: C.emerald, fontWeight: 500 }}>{row.assignedLayoutName}</span>
        ) : (
          <span style={{ color: C.textMuted, fontStyle: 'italic', fontSize: 11.5 }}>
            Uses default layout
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button style={buttonSmSecondaryStyle} onClick={onCancelEdit} disabled={saving}>
              Cancel
            </button>
            <button style={buttonSmPrimaryStyle} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <>
            {!row.assignedLayoutName && row.isActive && (
              <button
                style={buttonSmSecondaryStyle}
                onClick={onCreateLayout}
                disabled={busy}
                title="Clone the default layout and assign it to this record type"
              >
                Create layout
              </button>
            )}
            <button style={buttonSmSecondaryStyle} onClick={onStartEdit} disabled={busy}>
              Edit
            </button>
            {row.isActive ? (
              <button style={buttonSmDangerStyle} onClick={onDeactivate} disabled={busy}>
                Deactivate
              </button>
            ) : (
              <button style={buttonSmSecondaryStyle} onClick={onReactivate} disabled={busy}>
                Reactivate
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── New Record Type Modal ─────────────────────────────────────────────

function NewRecordTypeModal({
  objectName, objectLabel, existingValues, layouts,
  onClose, onCreated,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()
  const firstInputRef = useRef(null)

  const [label, setLabel] = useState('')
  const [value, setValue] = useState('')
  const [valueEdited, setValueEdited] = useState(false)
  const [sortOrder, setSortOrder] = useState('')
  const [strategy, setStrategy] = useState('clone_master')
  const [sourceLayoutId, setSourceLayoutId] = useState('')
  const [existingLayoutId, setExistingLayoutId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const masterLayout = layouts.find(l => l.isDefault === 'Yes') || null
  // Layouts that can be moved = not already assigned (we infer from name for now;
  // listRecordTypesForObject doesn't expose record_type_id per layout. The move
  // strategy is edge-case and the builder UI phase will make this fully correct).
  const moveableLayouts = layouts // safe superset; builder UI lands the precise filter

  useEffect(() => {
    // Auto-focus the label on open
    const id = requestAnimationFrame(() => { firstInputRef.current?.focus() })
    return () => cancelAnimationFrame(id)
  }, [])

  // Auto-derive value from label as the user types, until they manually edit value.
  useEffect(() => {
    if (valueEdited) return
    const suggested = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    setValue(suggested)
  }, [label, valueEdited])

  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // If there's no master layout and the default strategy was clone_master,
  // fall back to 'none' so the user can still create the record type.
  useEffect(() => {
    if (strategy === 'clone_master' && !masterLayout) {
      setStrategy('none')
    }
  }, [strategy, masterLayout])

  function validate() {
    if (!label.trim()) return 'Label is required'
    if (!value.trim()) return 'Value is required'
    if (!/^[a-z0-9_]+$/.test(value)) return 'Value must be lowercase letters, numbers, and underscores only'
    if (existingValues.includes(value)) return `A record type with value "${value}" already exists on this object`
    if (strategy === 'clone_from' && !sourceLayoutId) return 'Select a layout to clone from'
    if (strategy === 'move_existing' && !existingLayoutId) return 'Select a layout to move'
    if (strategy === 'clone_master' && !masterLayout) return 'No default layout exists — pick a different strategy'
    return null
  }

  async function submit() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const result = await createRecordTypeWithLayout({
        object: objectName,
        value: value.trim(),
        label: label.trim(),
        sortOrder: parseInt(sortOrder, 10) || 0,
        layoutStrategy: strategy,
        sourceLayoutId: strategy === 'clone_from' ? sourceLayoutId : null,
        existingLayoutId: strategy === 'move_existing' ? existingLayoutId : null,
      })
      onCreated({ ...result, label: label.trim() })
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
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="New Record Type"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          padding: isMobile ? '22px 20px calc(20px + env(safe-area-inset-bottom))' : 26,
          width: isMobile ? '100%' : 560,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>
            New Record Type
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            on <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{objectName}</span>
          </div>
        </div>

        {/* Form */}
        <FormField label="Label" hint="Display name (e.g. Single Family)">
          <input
            ref={firstInputRef}
            value={label}
            onChange={e => setLabel(e.target.value)}
            disabled={busy}
            placeholder="Single Family"
            style={inputStyle}
          />
        </FormField>

        <FormField label="Value" hint="Lowercase code used internally. Auto-derived from the label.">
          <input
            value={value}
            onChange={e => { setValue(e.target.value); setValueEdited(true) }}
            disabled={busy}
            placeholder="single_family"
            style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
          />
        </FormField>

        <FormField label="Sort Order" hint="Optional — lower numbers appear first.">
          <input
            type="number"
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
            disabled={busy}
            placeholder="0"
            style={{ ...inputStyle, width: 100, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
          />
        </FormField>

        <FormField label="Page Layout" hint="Controls which layout records of this type will use.">
          <select
            value={strategy}
            onChange={e => setStrategy(e.target.value)}
            disabled={busy}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="clone_master" disabled={!masterLayout}>
              Clone the default layout for this record type {masterLayout ? '(recommended)' : '(no default exists)'}
            </option>
            <option value="none">
              Use the default layout — don't create a new one
            </option>
            <option value="clone_from">
              Clone from another layout…
            </option>
            <option value="move_existing">
              Assign an existing layout to this record type…
            </option>
          </select>
        </FormField>

        {strategy === 'clone_from' && (
          <FormField label="Source layout" hint="The new layout will be a copy of this one.">
            <select
              value={sourceLayoutId}
              onChange={e => setSourceLayoutId(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— Select a layout —</option>
              {layouts.map(l => (
                <option key={l._id} value={l._id}>
                  {l.name} {l.isDefault === 'Yes' ? '(default)' : ''}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {strategy === 'move_existing' && (
          <>
            <FormField label="Existing layout" hint="This layout will be reassigned to the new record type.">
              <select
                value={existingLayoutId}
                onChange={e => setExistingLayoutId(e.target.value)}
                disabled={busy}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value="">— Select a layout —</option>
                {moveableLayouts.map(l => (
                  <option key={l._id} value={l._id}>
                    {l.name} {l.isDefault === 'Yes' ? '(default)' : ''}
                  </option>
                ))}
              </select>
            </FormField>
            <div style={warningBoxStyle}>
              <strong>Heads up:</strong> moving the default layout will leave this object with
              no default layout until another is assigned. Records of other record types will
              fall back to raw field rendering.
            </div>
          </>
        )}

        {/* Strategy hint */}
        {strategy === 'clone_master' && masterLayout && (
          <div style={hintBoxStyle}>
            Will clone <strong>"{masterLayout.name}"</strong> and set the copy as the default
            layout for this new record type. The existing default stays unchanged.
          </div>
        )}
        {strategy === 'none' && (
          <div style={hintBoxStyle}>
            Only the record type will be created. Records of this type will use whatever
            default layout is currently configured for {objectLabel}.
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            background: '#fdecea', border: '1px solid #f3b9b1', color: '#8a2d20',
            padding: '9px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14,
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={buttonSecondaryStyle}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            style={buttonPrimaryStyle}
          >
            {busy ? 'Creating…' : 'Create Record Type'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reusable bits local to this file ──────────────────────────────────

function FormField({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: 'block', fontSize: 11.5, fontWeight: 600,
        color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em',
        marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono, type = 'text', width, center }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: width || '100%',
        padding: '5px 8px',
        fontSize: mono ? 11.5 : 12.5,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        color: C.textPrimary,
        background: C.card,
        border: `1px solid ${C.borderDark || C.border}`,
        borderRadius: 4,
        outline: 'none',
        textAlign: center ? 'center' : 'left',
      }}
    />
  )
}

// ─── Styles ────────────────────────────────────────────────────────────

const GRID_COLS = '1.2fr 1.6fr 70px 90px 1.6fr minmax(220px, auto)'

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
  transition: 'background 0.1s, opacity 0.2s',
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  color: C.textPrimary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: 6,
  outline: 'none',
  boxSizing: 'border-box',
}

const buttonPrimaryStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '7px 14px',
  fontSize: 12.5, fontWeight: 600,
  color: '#ffffff',
  background: C.emerald,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

const buttonSecondaryStyle = {
  padding: '7px 14px',
  fontSize: 12.5, fontWeight: 500,
  color: C.textSecondary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: 6,
  cursor: 'pointer',
}

const buttonSmPrimaryStyle = {
  padding: '4px 10px',
  fontSize: 11.5, fontWeight: 600,
  color: '#ffffff',
  background: C.emerald,
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
}

const buttonSmSecondaryStyle = {
  padding: '4px 10px',
  fontSize: 11.5, fontWeight: 500,
  color: C.textSecondary,
  background: C.card,
  border: `1px solid ${C.borderDark || C.border}`,
  borderRadius: 4,
  cursor: 'pointer',
}

const buttonSmDangerStyle = {
  padding: '4px 10px',
  fontSize: 11.5, fontWeight: 500,
  color: '#b03a2e',
  background: C.card,
  border: '1px solid #f3b9b1',
  borderRadius: 4,
  cursor: 'pointer',
}

const hintBoxStyle = {
  background: '#f7f9fc',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 11.5,
  color: C.textSecondary,
  lineHeight: 1.5,
  marginBottom: 14,
}

const warningBoxStyle = {
  background: '#fff8e6',
  border: '1px solid #f0d48a',
  borderRadius: 6,
  padding: '9px 12px',
  fontSize: 11.5,
  color: '#7a5a1c',
  lineHeight: 1.5,
  marginBottom: 14,
}
