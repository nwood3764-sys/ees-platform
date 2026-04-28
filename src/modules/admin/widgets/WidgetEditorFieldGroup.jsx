import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { C } from '../../../data/constants'
import { Icon } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { describeObject } from '../../../data/adminService'
import { updateWidget } from '../../../data/pageLayoutBuilderService'
import { deriveEesFieldType, buildFieldEntryFromColumn } from './eesFieldTypes'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonSmDangerStyle,
  dangerBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// WidgetEditorFieldGroup — modal for editing a field_group widget's contents.
// Two panes: left is the object's columns (those not already in the widget),
// right is the selected fields in display order. Click-to-add, click-X to
// remove, drag-to-reorder within the right pane. Each selected field has an
// editable label, required toggle, read-only toggle.
//
// On save, writes widget_config = { fields: [...] } via updateWidget. The
// widget_title is also editable from this modal (top field) since it's the
// user-facing label.
// ---------------------------------------------------------------------------

// Columns we never include in a field_group — system plumbing, not data
// users would want to see or edit on the record page.
const NEVER_INCLUDE = new Set([
  'id',
  'created_at', 'updated_at',
  'created_by', 'updated_by',
  'is_deleted', 'deletion_reason',
])

export default function WidgetEditorFieldGroup({
  widget, objectName, onClose, onSaved,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()

  const [title, setTitle] = useState(widget.widget_title || '')
  const [columns, setColumns] = useState([])
  const [loadingCols, setLoadingCols] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(
    Array.isArray(widget.widget_config?.fields) ? widget.widget_config.fields : [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Load column metadata for the object once on mount
  useEffect(() => {
    let cancelled = false
    setLoadingCols(true)
    describeObject(objectName)
      .then(cols => { if (!cancelled) setColumns(cols || []) })
      .catch(err => { if (!cancelled) setLoadError(err) })
      .finally(() => { if (!cancelled) setLoadingCols(false) })
    return () => { cancelled = true }
  }, [objectName])

  // ESC → cancel
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Columns that haven't been added yet, filtered by search, excluding
  // system plumbing.
  const availableColumns = useMemo(() => {
    const selectedNames = new Set(selected.map(f => f.name))
    const q = search.trim().toLowerCase()
    return columns
      .filter(c =>
        !selectedNames.has(c.column_name) &&
        !NEVER_INCLUDE.has(c.column_name) &&
        !c.is_primary_key && // id is already excluded but this catches any other PKs
        (!q || c.column_name.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
  }, [columns, selected, search])

  // ─── Actions ──────────────────────────────────────────────────────
  const addColumn = useCallback((col) => {
    const entry = buildFieldEntryFromColumn(col)
    setSelected(prev => [...prev, entry])
  }, [])

  const removeField = useCallback((name) => {
    setSelected(prev => prev.filter(f => f.name !== name))
  }, [])

  const updateField = useCallback((name, patch) => {
    setSelected(prev => prev.map(f => f.name === name ? { ...f, ...patch } : f))
  }, [])

  // ─── Drag-to-reorder within the selected list ──────────────────────
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)

  const handleDragStart = (e, idx) => {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(idx)) } catch { /* Safari */ }
  }
  const handleDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== idx) setDragOverIndex(idx)
  }
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }
  const handleDrop = (e, dropIdx) => {
    e.preventDefault()
    const srcIdx = dragIndex
    setDragIndex(null); setDragOverIndex(null)
    if (srcIdx === null || srcIdx === dropIdx) return
    setSelected(prev => {
      const next = [...prev]
      const [moved] = next.splice(srcIdx, 1)
      next.splice(dropIdx, 0, moved)
      return next
    })
  }

  // ─── Save ─────────────────────────────────────────────────────────
  async function save() {
    if (!title.trim()) { setError('Widget title is required'); return }
    setBusy(true)
    setError(null)
    try {
      await updateWidget(widget.id, {
        title: title.trim(),
        config: { fields: selected },
      })
      toast.success('Widget saved')
      onSaved()
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Edit field group"
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          width: isMobile ? '100%' : 900,
          maxWidth: '100%',
          height: isMobile ? '92vh' : '82vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: C.card,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Edit Field Group</div>
            <span style={{
              background: '#e8f8f2', color: '#1a7a4e',
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>field_group</span>
            <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
              {widget.page_layout_widget_record_number}
            </span>
          </div>
          <FormField label="Widget Title" style={{ marginBottom: 0 }}>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
              placeholder="Basic Information"
              style={inputStyle}
            />
          </FormField>
        </div>

        {/* Two-pane body */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr',
          gridTemplateRows: isMobile ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: 0,
        }}>
          {/* Left — available columns */}
          <div style={{
            borderRight: isMobile ? 'none' : `1px solid ${C.border}`,
            borderBottom: isMobile ? `1px solid ${C.border}` : 'none',
            display: 'flex', flexDirection: 'column', minHeight: 0, background: '#fafbfd',
          }}>
            <div style={{ padding: '12px 16px 8px', borderBottom: `1px solid ${C.border}`, background: '#fafbfd' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                Available Columns ({availableColumns.length})
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter columns…"
                style={{ ...inputStyle, padding: '6px 10px', fontSize: 12 }}
                disabled={busy}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {loadingCols ? (
                <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>Loading columns…</div>
              ) : loadError ? (
                <div style={{ padding: 16, color: '#b03a2e', fontSize: 12 }}>
                  Could not load columns: {String(loadError.message || loadError)}
                </div>
              ) : availableColumns.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                  {search ? 'No columns match your search.' : 'Every column has been added.'}
                </div>
              ) : (
                availableColumns.map(c => (
                  <ColumnPickRow key={c.column_name} column={c} onAdd={() => addColumn(c)} />
                ))
              )}
            </div>
          </div>

          {/* Right — selected fields */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 16px 8px', borderBottom: `1px solid ${C.border}`, background: C.card }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Selected Fields ({selected.length}) · drag to reorder
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {selected.length === 0 ? (
                <div style={{ padding: '30px 16px', textAlign: 'center', color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                  No fields yet. Click a column on the left to add it.
                </div>
              ) : (
                selected.map((f, idx) => (
                  <SelectedFieldRow
                    key={f.name}
                    field={f}
                    idx={idx}
                    isDragging={dragIndex === idx}
                    isDropTarget={dragOverIndex === idx && dragIndex !== null && dragIndex !== idx}
                    onDragStart={e => handleDragStart(e, idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    onDrop={e => handleDrop(e, idx)}
                    onUpdate={patch => updateField(f.name, patch)}
                    onRemove={() => removeField(f.name)}
                    disabled={busy}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${C.border}`,
          background: '#fafbfd',
          display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>
            {selected.length} field{selected.length === 1 ? '' : 's'} selected.
            Changes apply when you save.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
            <button onClick={save} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? 'Saving…' : 'Save Widget'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 20px 12px' }}>
            <div style={dangerBoxStyle}>{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Left-pane row: an available column ────────────────────────────

function ColumnPickRow({ column, onAdd }) {
  const [hover, setHover] = useState(false)
  const type = deriveEesFieldType(column)
  return (
    <div
      onClick={onAdd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '7px 10px',
        marginBottom: 4,
        background: hover ? '#f0f9f5' : C.card,
        border: `1px solid ${hover ? C.emerald : C.border}`,
        borderRadius: 5,
        cursor: 'pointer',
        transition: 'background 0.08s, border 0.08s',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: C.textPrimary,
          fontFamily: 'JetBrains Mono, monospace',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {column.column_name}
        </div>
        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 1 }}>
          {column.data_type}
          {column.is_nullable === 'NO' && <span style={{ color: '#c04040', marginLeft: 6 }}>required</span>}
          {column.references_table && <span style={{ marginLeft: 6 }}>→ {column.references_table}</span>}
        </div>
      </div>
      <span style={{
        background: C.page, color: C.textSecondary, fontSize: 9.5, fontWeight: 600,
        padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
        flexShrink: 0,
      }}>{type}</span>
      <Icon path="M12 5v14M5 12h14" size={13} color={hover ? C.emerald : C.textMuted} />
    </div>
  )
}

// ─── Right-pane row: a selected field ──────────────────────────────

function SelectedFieldRow({
  field, idx, isDragging, isDropTarget,
  onDragStart, onDragOver, onDragEnd, onDrop,
  onUpdate, onRemove, disabled,
}) {
  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      style={{
        background: '#fafbfd',
        border: isDropTarget ? `2px solid ${C.emerald}` : `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '9px 11px',
        marginBottom: 6,
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s, border 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ color: C.textMuted, cursor: disabled ? 'default' : 'grab', padding: 2, flexShrink: 0 }} title="Drag to reorder">
          <Icon path="M4 6h16M4 12h16M4 18h16" size={13} color="currentColor" />
        </div>
        <div style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
          #{idx + 1}
        </div>
        <div style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11.5, color: C.textSecondary,
          flex: 1, minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {field.name}
        </div>
        <span style={{
          background: C.card, color: C.textSecondary, fontSize: 9.5, fontWeight: 600,
          padding: '2px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
          border: `1px solid ${C.border}`, flexShrink: 0,
        }}>
          {field.type}
        </span>
        <button
          onClick={onRemove}
          disabled={disabled}
          style={{ ...buttonSmDangerStyle, padding: '3px 8px' }}
        >
          Remove
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: 10, alignItems: 'center',
      }}>
        <input
          value={field.label || ''}
          onChange={e => onUpdate({ label: e.target.value })}
          disabled={disabled}
          placeholder="Display label"
          style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textSecondary, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(field.required)}
            onChange={e => onUpdate({ required: e.target.checked })}
            disabled={disabled}
          />
          Required
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textSecondary, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={Boolean(field.read_only)}
            onChange={e => onUpdate({ read_only: e.target.checked })}
            disabled={disabled}
          />
          Read-only
        </label>
      </div>
    </div>
  )
}
