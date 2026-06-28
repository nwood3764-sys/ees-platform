import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { describeObject } from '../../data/adminService'
import { buildFieldEntryFromColumn, humanizeColumnName } from './widgets/eesFieldTypes'
import {
  updateWidget,
  createWidget,
  softDeleteWidget,
  createSection,
  updateSection,
  softDeleteSection,
  reorderSections,
} from '../../data/pageLayoutBuilderService'

// ---------------------------------------------------------------------------
// LayoutCanvas — WYSIWYG (Option B1) page-layout editor.
//
// Direct-manipulation surface that mirrors what RecordDetail actually renders:
//   - Sections render as live cards in their real placement (main / right).
//   - field_group widgets render every field as a draggable tile in the same
//     auto-flow grid the record page uses (repeat(auto-fit, minmax)). No
//     "+N more" truncation — every field is visible and movable.
//   - A sticky field palette lists every unplaced column for the object;
//     drag a chip onto any field_group to add the field there.
//   - Drag a field tile within a widget to reorder, or across widgets/sections
//     to move it. Drop on the palette (or the tile's × ) to remove.
//   - Section add / rename / settings / delete inline.
//
// Persistence rides the existing pageLayoutBuilderService functions, so the
// DB contract and trg_validate_page_layout_widget_config trigger are
// untouched. The field model stays the flat ordered fields[] array — column
// placement is the auto-flow grid's job at render time, exactly as today.
//
// Non-field_group widgets (related_list, conversation_panel, file_gallery,
// report, status_path, prtsn_history) render as labeled placeholder tiles on
// the canvas — they're structurally present and reorderable/deletable, but
// their inner config is still edited via the existing modal editors in the
// list view (toggle back to List to reach those).
// ---------------------------------------------------------------------------

const NEVER_INCLUDE = new Set([
  'id', 'created_at', 'updated_at', 'created_by', 'updated_by',
  'is_deleted', 'deletion_reason',
])

// Drag payload kinds carried in dataTransfer as JSON.
//   { kind: 'palette', column }                       — new field from palette
//   { kind: 'field', widgetId, name }                 — existing field tile
//   { kind: 'section', sectionId }                    — section reorder
const DT_MIME = 'application/x-leap-canvas'

function readDrag(e) {
  try {
    const raw = e.dataTransfer.getData(DT_MIME) || e.dataTransfer.getData('text/plain')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeDrag(e, payload) {
  const json = JSON.stringify(payload)
  e.dataTransfer.effectAllowed = 'move'
  try { e.dataTransfer.setData(DT_MIME, json) } catch { /* noop */ }
  try { e.dataTransfer.setData('text/plain', json) } catch { /* Safari */ }
}

export default function LayoutCanvas({
  layout,
  sections: sectionsProp,
  objectName,
  onChanged,
  disabled,
}) {
  const toast = useToast()

  // Local working copy so drags feel instant; we reconcile from the parent on
  // every onChanged refresh.
  const [sections, setSections] = useState(sectionsProp)
  useEffect(() => { setSections(sectionsProp) }, [sectionsProp])

  // Object columns for the palette.
  const [columns, setColumns] = useState([])
  const [colsLoading, setColsLoading] = useState(true)
  const [colsError, setColsError] = useState(null)
  useEffect(() => {
    let cancelled = false
    setColsLoading(true)
    describeObject(objectName)
      .then(cols => { if (!cancelled) setColumns(cols || []) })
      .catch(err => { if (!cancelled) setColsError(err) })
      .finally(() => { if (!cancelled) setColsLoading(false) })
    return () => { cancelled = true }
  }, [objectName])

  const [busy, setBusy] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [paletteHover, setPaletteHover] = useState(false)

  // Every field name placed anywhere in any field_group across the layout.
  const placedNames = useMemo(() => {
    const s = new Set()
    for (const sec of sections) {
      for (const w of sec.widgets || []) {
        if (w.widget_type === 'field_group' && Array.isArray(w.widget_config?.fields)) {
          for (const f of w.widget_config.fields) if (f?.name) s.add(f.name)
        }
      }
    }
    return s
  }, [sections])

  const availableColumns = useMemo(() => {
    const q = paletteSearch.trim().toLowerCase()
    return columns
      .filter(c =>
        !placedNames.has(c.column_name) &&
        !NEVER_INCLUDE.has(c.column_name) &&
        !c.is_primary_key &&
        (!q || c.column_name.toLowerCase().includes(q) ||
          humanizeColumnName(c.column_name).toLowerCase().includes(q)),
      )
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
  }, [columns, placedNames, paletteSearch])

  // Resolve a column object by name (palette drop needs the full column to
  // build a field entry).
  const columnByName = useMemo(() => {
    const m = new Map()
    for (const c of columns) m.set(c.column_name, c)
    return m
  }, [columns])

  // ─── Field-group mutation helpers (optimistic + persist) ────────────────

  // The widget's full current config, so we don't drop sibling keys when we
  // write fields.
  const widgetConfigFor = useCallback((widgetId) => {
    for (const sec of sections) {
      for (const w of sec.widgets || []) {
        if (w.id === widgetId) return w.widget_config || {}
      }
    }
    return {}
  }, [sections])

  const writeFields = useCallback(async (widgetId, nextFields) => {
    const cfg = widgetConfigFor(widgetId)
    const nextConfig = { ...cfg, fields: nextFields }
    // optimistic
    setSections(prev => prev.map(sec => ({
      ...sec,
      widgets: (sec.widgets || []).map(w =>
        w.id === widgetId ? { ...w, widget_config: nextConfig } : w,
      ),
    })))
    setBusy(true)
    try {
      await updateWidget(widgetId, { config: nextConfig })
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not save field change')
      if (onChanged) await onChanged()
    } finally {
      setBusy(false)
    }
  }, [widgetConfigFor, onChanged, toast])

  // Drop a palette column onto a field_group widget at a given index.
  const addFieldToWidget = useCallback(async (widgetId, columnName, atIndex = null) => {
    const col = columnByName.get(columnName)
    if (!col) return
    const entry = buildFieldEntryFromColumn(col)
    const cfg = widgetConfigFor(widgetId)
    const cur = Array.isArray(cfg.fields) ? cfg.fields : []
    if (cur.some(f => f.name === columnName)) return // already there
    const next = [...cur]
    if (atIndex == null || atIndex >= next.length) next.push(entry)
    else next.splice(atIndex, 0, entry)
    await writeFields(widgetId, next)
  }, [columnByName, widgetConfigFor, writeFields])

  // Remove a field from a widget.
  const removeFieldFromWidget = useCallback(async (widgetId, name) => {
    const cfg = widgetConfigFor(widgetId)
    const cur = Array.isArray(cfg.fields) ? cfg.fields : []
    const next = cur.filter(f => f.name !== name)
    await writeFields(widgetId, next)
  }, [widgetConfigFor, writeFields])

  // Move/reorder a field. Handles same-widget reorder and cross-widget move
  // in one path. When source and target widgets differ, this is two writes
  // (remove from source, insert into target). We sequence them.
  const moveField = useCallback(async (srcWidgetId, name, dstWidgetId, atIndex) => {
    if (srcWidgetId === dstWidgetId) {
      const cfg = widgetConfigFor(srcWidgetId)
      const cur = Array.isArray(cfg.fields) ? cfg.fields : []
      const fromIdx = cur.findIndex(f => f.name === name)
      if (fromIdx === -1) return
      const next = [...cur]
      const [moved] = next.splice(fromIdx, 1)
      let insertAt = atIndex == null ? next.length : atIndex
      if (fromIdx < insertAt) insertAt -= 1 // account for the removed item
      next.splice(insertAt, 0, moved)
      await writeFields(srcWidgetId, next)
      return
    }
    // cross-widget: pull the entry from source, drop into dest
    const srcCfg = widgetConfigFor(srcWidgetId)
    const srcFields = Array.isArray(srcCfg.fields) ? srcCfg.fields : []
    const entry = srcFields.find(f => f.name === name)
    if (!entry) return
    const dstCfg = widgetConfigFor(dstWidgetId)
    const dstFields = Array.isArray(dstCfg.fields) ? dstCfg.fields : []
    if (dstFields.some(f => f.name === name)) {
      toast.error(`"${entry.label || name}" is already in the target widget`)
      return
    }
    const nextSrc = srcFields.filter(f => f.name !== name)
    const nextDst = [...dstFields]
    if (atIndex == null || atIndex >= nextDst.length) nextDst.push(entry)
    else nextDst.splice(atIndex, 0, entry)

    // Two sequential persists. Optimistic update both at once.
    const srcConfig = { ...srcCfg, fields: nextSrc }
    const dstConfig = { ...dstCfg, fields: nextDst }
    setSections(prev => prev.map(sec => ({
      ...sec,
      widgets: (sec.widgets || []).map(w => {
        if (w.id === srcWidgetId) return { ...w, widget_config: srcConfig }
        if (w.id === dstWidgetId) return { ...w, widget_config: dstConfig }
        return w
      }),
    })))
    setBusy(true)
    try {
      await updateWidget(srcWidgetId, { config: srcConfig })
      await updateWidget(dstWidgetId, { config: dstConfig })
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not move field')
      if (onChanged) await onChanged()
    } finally {
      setBusy(false)
    }
  }, [widgetConfigFor, writeFields, onChanged, toast])

  // Edit a field's label / required / read-only.
  const patchField = useCallback(async (widgetId, name, patch) => {
    const cfg = widgetConfigFor(widgetId)
    const cur = Array.isArray(cfg.fields) ? cfg.fields : []
    const next = cur.map(f => f.name === name ? { ...f, ...patch } : f)
    await writeFields(widgetId, next)
  }, [widgetConfigFor, writeFields])

  // ─── Section operations ─────────────────────────────────────────────────

  const handleAddSection = useCallback(async (placement) => {
    setBusy(true)
    try {
      const sec = await createSection(layout.id, {
        label: 'New Section',
        columns: 2,
        placement,
      })
      // Field-group widget so it's immediately usable as a drop target.
      await createWidget(sec.id, {
        type: 'field_group',
        title: 'New Section',
        config: { fields: [] },
      })
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not add section')
    } finally {
      setBusy(false)
    }
  }, [layout.id, onChanged, toast])

  const handleRenameSection = useCallback(async (sectionId, label) => {
    setBusy(true)
    try {
      await updateSection(sectionId, { label })
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not rename section')
    } finally {
      setBusy(false)
    }
  }, [onChanged, toast])

  const handleSectionSettings = useCallback(async (sectionId, patch) => {
    setBusy(true)
    try {
      await updateSection(sectionId, patch)
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not update section')
    } finally {
      setBusy(false)
    }
  }, [onChanged, toast])

  const handleDeleteSection = useCallback(async (sectionId, reason) => {
    setBusy(true)
    try {
      await softDeleteSection(sectionId, reason)
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not delete section')
    } finally {
      setBusy(false)
    }
  }, [onChanged, toast])

  // Section reorder via drag handle.
  const [dragSectionId, setDragSectionId] = useState(null)
  const [dragOverSectionId, setDragOverSectionId] = useState(null)

  const performSectionReorder = useCallback(async (targetPlacement, targetSectionId) => {
    const srcId = dragSectionId
    setDragSectionId(null); setDragOverSectionId(null)
    if (!srcId) return
    const src = sections.find(s => s.id === srcId)
    if (!src) return

    const main = sections.filter(s => (s.placement || 'main') === 'main')
    const right = sections.filter(s => s.placement === 'right')
    const srcPlacement = src.placement || 'main'

    // Remove from its current column
    const fromCol = srcPlacement === 'right' ? right : main
    const fromIdx = fromCol.findIndex(s => s.id === srcId)
    if (fromIdx > -1) fromCol.splice(fromIdx, 1)

    const intoCol = targetPlacement === 'right' ? right : main
    let insertAt = intoCol.length
    if (targetSectionId) {
      const ti = intoCol.findIndex(s => s.id === targetSectionId)
      if (ti > -1) insertAt = ti
    }
    intoCol.splice(insertAt, 0, src)

    // If placement changed, persist that on the moved section.
    setBusy(true)
    try {
      if (srcPlacement !== targetPlacement) {
        await updateSection(srcId, { placement: targetPlacement })
      }
      const orderedIds = [...main, ...right].map(s => s.id)
      await reorderSections(layout.id, orderedIds)
      if (onChanged) await onChanged()
    } catch (e) {
      toast.error(e.message || 'Could not reorder sections')
      if (onChanged) await onChanged()
    } finally {
      setBusy(false)
    }
  }, [dragSectionId, sections, layout.id, onChanged, toast])

  // Palette is a remove drop target: dropping a field tile here deletes it.
  const onPaletteDrop = useCallback((e) => {
    e.preventDefault()
    setPaletteHover(false)
    const d = readDrag(e)
    if (d?.kind === 'field' && d.widgetId && d.name) {
      removeFieldFromWidget(d.widgetId, d.name)
    }
  }, [removeFieldFromWidget])

  const mainSections = sections.filter(s => (s.placement || 'main') === 'main')
  const rightSections = sections.filter(s => s.placement === 'right')

  const sectionProps = {
    objectName,
    columnByName,
    onAddField: addFieldToWidget,
    onRemoveField: removeFieldFromWidget,
    onMoveField: moveField,
    onPatchField: patchField,
    onRename: handleRenameSection,
    onSettings: handleSectionSettings,
    onDelete: handleDeleteSection,
    dragSectionId, setDragSectionId,
    dragOverSectionId, setDragOverSectionId,
    onSectionDrop: performSectionReorder,
    disabled: disabled || busy,
  }

  return (
    <div style={{ marginTop: 18, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      {/* ── Canvas ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {busy && (
          <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', marginBottom: 8 }}>
            Saving…
          </div>
        )}

        {/* MAIN column */}
        <ColumnHeader
          label="Main Content"
          count={mainSections.length}
          onDropEnd={() => performSectionReorder('main', null)}
          isHint={dragSectionId && dragOverSectionId === null}
        />
        {mainSections.map(sec => (
          <CanvasSection key={sec.id} section={sec} placement="main" {...sectionProps} />
        ))}
        <AddSectionButton onClick={() => handleAddSection('main')} disabled={disabled || busy} />

        {/* RIGHT column */}
        <div style={{ marginTop: 26 }}>
          <ColumnHeader
            label="Right Sidebar"
            count={rightSections.length}
            onDropEnd={() => performSectionReorder('right', null)}
            isHint={dragSectionId && dragOverSectionId === null}
          />
          {rightSections.length === 0 && (
            <div
              onDragOver={e => { e.preventDefault() }}
              onDrop={() => performSectionReorder('right', null)}
              style={{
                padding: '18px 14px', textAlign: 'center',
                border: `1px dashed ${C.border}`, borderRadius: 8,
                color: C.textMuted, fontSize: 11.5, fontStyle: 'italic',
                background: '#fafbfd', marginBottom: 8,
              }}
            >
              No right-sidebar sections. Drag a section here, or add one below.
            </div>
          )}
          {rightSections.map(sec => (
            <CanvasSection key={sec.id} section={sec} placement="right" {...sectionProps} />
          ))}
          <AddSectionButton onClick={() => handleAddSection('right')} disabled={disabled || busy} />
        </div>
      </div>

      {/* ── Field palette ── */}
      <div
        style={{
          width: 248, flexShrink: 0, position: 'sticky', top: 12,
          background: C.card, border: `1px solid ${paletteHover ? C.emerald : C.border}`,
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(13,26,46,0.05)',
          transition: 'border-color 150ms ease',
        }}
        onDragOver={e => {
          // getData() is empty during dragover; detect our drag via types.
          if (e.dataTransfer.types.includes(DT_MIME)) { e.preventDefault(); setPaletteHover(true) }
        }}
        onDragLeave={() => setPaletteHover(false)}
        onDrop={onPaletteDrop}
      >
        <div style={{
          padding: '10px 12px', borderBottom: `1px solid ${C.border}`,
          background: '#f7f9fc',
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: C.textSecondary,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
          }}>
            Field Palette
          </div>
          <input
            value={paletteSearch}
            onChange={e => setPaletteSearch(e.target.value)}
            placeholder="Filter fields…"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '6px 9px',
              fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 5,
              background: C.card, color: C.textPrimary, outline: 'none',
            }}
          />
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: 8 }}>
          {colsLoading ? (
            <div style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 11.5 }}>
              Loading fields…
            </div>
          ) : colsError ? (
            <div style={{ padding: 14, color: '#1a5a8a', fontSize: 11.5 }}>
              {String(colsError.message || colsError)}
            </div>
          ) : availableColumns.length === 0 ? (
            <div style={{ padding: 14, textAlign: 'center', color: C.textMuted, fontSize: 11.5, fontStyle: 'italic' }}>
              {paletteSearch ? 'No matching fields.' : 'Every field is placed.'}
            </div>
          ) : (
            availableColumns.map(col => (
              <PaletteChip key={col.column_name} column={col} disabled={disabled || busy} />
            ))
          )}
        </div>

        <div style={{
          padding: '8px 12px', borderTop: `1px solid ${C.border}`,
          fontSize: 10.5, color: C.textMuted, lineHeight: 1.5,
          background: paletteHover ? '#eef7f2' : '#f7f9fc',
          transition: 'background 150ms ease',
        }}>
          {paletteHover
            ? 'Release to remove this field from the layout.'
            : 'Drag a field onto a section. Drag a placed field here to remove it.'}
        </div>
      </div>
    </div>
  )
}

// ─── Palette chip ───────────────────────────────────────────────────────

function PaletteChip({ column, disabled }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      draggable={!disabled}
      onDragStart={e => writeDrag(e, { kind: 'palette', column: column.column_name })}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '7px 9px', marginBottom: 5, borderRadius: 5,
        border: `1px solid ${hover ? C.emerald : C.border}`,
        background: hover ? '#f3fbf7' : C.card,
        cursor: disabled ? 'default' : 'grab',
        display: 'flex', alignItems: 'center', gap: 7,
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
    >
      <Icon path="M4 8h16M4 16h16" size={12} color={C.textMuted} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: C.textPrimary, fontWeight: 500, lineHeight: 1.2 }}>
          {humanizeColumnName(column.column_name)}
        </div>
        <div style={{
          fontSize: 9.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace',
          marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {column.column_name}
        </div>
      </div>
    </div>
  )
}

// ─── Column header (drop zone footer for section reorder) ───────────────

function ColumnHeader({ label, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
      fontSize: 11, fontWeight: 700, color: C.textSecondary,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      <Icon path="M4 6h16M4 12h16M4 18h16" size={13} color={C.textMuted} />
      {label}
      <span style={{ color: C.textMuted, fontWeight: 600 }}>· {count}</span>
    </div>
  )
}

function AddSectionButton({ onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '9px 12px', marginTop: 4, marginBottom: 4,
        border: `1px dashed ${C.borderDark || C.border}`, borderRadius: 7,
        background: C.card, color: C.textSecondary, fontSize: 12, fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" />
      Add Section
    </button>
  )
}

// ─── Canvas section ─────────────────────────────────────────────────────

function CanvasSection({
  section, placement, objectName, columnByName,
  onAddField, onRemoveField, onMoveField, onPatchField,
  onRename, onSettings, onDelete,
  dragSectionId, setDragSectionId, dragOverSectionId, setDragOverSectionId,
  onSectionDrop, disabled,
}) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(section.label || '')
  const [showSettings, setShowSettings] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { setLabelDraft(section.label || '') }, [section.label])

  const isDragging = dragSectionId === section.id
  const isDropTarget = dragOverSectionId === section.id && dragSectionId && dragSectionId !== section.id

  const fieldGroups = (section.widgets || []).filter(w => w.widget_type === 'field_group')
  const otherWidgets = (section.widgets || []).filter(w => w.widget_type !== 'field_group')

  function commitLabel() {
    setEditingLabel(false)
    const v = labelDraft.trim()
    if (v && v !== section.label) onRename(section.id, v)
    else setLabelDraft(section.label || '')
  }

  return (
    <div
      onDragOver={e => {
        if (dragSectionId && dragSectionId !== section.id) {
          e.preventDefault()
          if (dragOverSectionId !== section.id) setDragOverSectionId(section.id)
        }
      }}
      onDrop={e => {
        if (dragSectionId && dragSectionId !== section.id) {
          e.preventDefault()
          onSectionDrop(placement, section.id)
        }
      }}
      style={{
        border: `1px solid ${isDropTarget ? C.emerald : C.border}`,
        borderRadius: 8, marginBottom: 12, background: C.card,
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDropTarget ? `0 0 0 2px ${C.emerald}33` : '0 1px 2px rgba(13,26,46,0.04)',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: `1px solid ${C.border}`, background: '#f7f9fc',
        borderRadius: '8px 8px 0 0',
      }}>
        <span
          draggable={!disabled}
          onDragStart={e => { setDragSectionId(section.id); writeDrag(e, { kind: 'section', sectionId: section.id }) }}
          onDragEnd={() => { setDragSectionId(null); setDragOverSectionId(null) }}
          title="Drag to reorder section"
          style={{ cursor: disabled ? 'default' : 'grab', display: 'inline-flex' }}
        >
          <Icon path="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" size={15} color={C.textMuted} />
        </span>

        {editingLabel ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setEditingLabel(false); setLabelDraft(section.label || '') } }}
            style={{
              flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary,
              padding: '3px 6px', border: `1px solid ${C.emerald}`, borderRadius: 4, outline: 'none',
            }}
          />
        ) : (
          <div
            onClick={() => !disabled && setEditingLabel(true)}
            style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary, cursor: disabled ? 'default' : 'text' }}
            title="Click to rename"
          >
            {section.label || <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Untitled section</span>}
          </div>
        )}

        <span style={{
          fontSize: 9.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace',
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {placement === 'right' ? 'Right' : 'Main'} · {section.columns}col
        </span>

        <button
          onClick={() => setShowSettings(s => !s)}
          disabled={disabled}
          title="Section settings"
          style={iconBtnStyle}
        >
          <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" size={14} color={C.textMuted} />
        </button>
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={disabled}
          title="Delete section"
          style={iconBtnStyle}
        >
          <Icon path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" size={14} color={C.danger} />
        </button>
      </div>

      {/* Settings popover */}
      {showSettings && (
        <SectionSettings
          section={section}
          onApply={patch => { onSettings(section.id, patch); setShowSettings(false) }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Field-group widgets render as live field grids */}
      <div style={{ padding: 12 }}>
        {fieldGroups.length === 0 && otherWidgets.length === 0 && (
          <FieldGridDropZone
            widgetId={null}
            empty
            onAddField={() => {}}
            onMoveField={() => {}}
            disabled
          />
        )}

        {fieldGroups.map(w => (
          <FieldGroupCanvas
            key={w.id}
            widget={w}
            columnByName={columnByName}
            onAddField={onAddField}
            onRemoveField={onRemoveField}
            onMoveField={onMoveField}
            onPatchField={onPatchField}
            disabled={disabled}
          />
        ))}

        {otherWidgets.map(w => (
          <NonFieldWidgetTile key={w.id} widget={w} />
        ))}
      </div>

      {confirmDelete && (
        <DeleteSectionConfirm
          section={section}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={reason => { onDelete(section.id, reason); setConfirmDelete(false) }}
        />
      )}
    </div>
  )
}

// ─── Field-group canvas: live, draggable field tiles ────────────────────

function FieldGroupCanvas({ widget, onAddField, onRemoveField, onMoveField, onPatchField, disabled }) {
  const fields = Array.isArray(widget.widget_config?.fields) ? widget.widget_config.fields : []
  const [dragOverIdx, setDragOverIdx] = useState(null)
  const [activePopover, setActivePopover] = useState(null) // field name

  function handleTileDrop(e, idx) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverIdx(null)
    const d = readDrag(e)
    if (!d) return
    if (d.kind === 'palette') {
      onAddField(widget.id, d.column, idx)
    } else if (d.kind === 'field') {
      onMoveField(d.widgetId, d.name, widget.id, idx)
    }
  }

  function handleContainerDrop(e) {
    // Drop on the grid background (not a tile) → append to end.
    e.preventDefault()
    setDragOverIdx(null)
    const d = readDrag(e)
    if (!d) return
    if (d.kind === 'palette') onAddField(widget.id, d.column, null)
    else if (d.kind === 'field') onMoveField(d.widgetId, d.name, widget.id, null)
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        fontSize: 10.5, fontWeight: 600, color: C.textSecondary,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        <Icon path="M4 6h16M4 10h16M4 14h16M4 18h16" size={12} color={C.textMuted} />
        {widget.widget_title || 'Field Group'}
        <span style={{ color: C.textMuted, fontWeight: 500 }}>· {fields.length} field{fields.length === 1 ? '' : 's'}</span>
      </div>

      <div
        onDragOver={e => {
          if (e.dataTransfer.types.includes(DT_MIME)) e.preventDefault()
        }}
        onDrop={handleContainerDrop}
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 6, padding: 8, borderRadius: 6,
          background: '#fafbfd', border: `1px dashed ${C.border}`,
          minHeight: fields.length === 0 ? 56 : undefined,
        }}
      >
        {fields.length === 0 && (
          <div style={{
            gridColumn: '1 / -1', textAlign: 'center', color: C.textMuted,
            fontSize: 11.5, fontStyle: 'italic', padding: '12px 0',
          }}>
            Drag fields here from the palette →
          </div>
        )}
        {fields.map((f, idx) => (
          <FieldTile
            key={f.name}
            field={f}
            widgetId={widget.id}
            isDropTarget={dragOverIdx === idx}
            popoverOpen={activePopover === f.name}
            onOpenPopover={() => setActivePopover(p => p === f.name ? null : f.name)}
            onClosePopover={() => setActivePopover(null)}
            onDragStart={e => writeDrag(e, { kind: 'field', widgetId: widget.id, name: f.name })}
            onDragOverTile={e => {
              if (e.dataTransfer.types.includes(DT_MIME)) { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx) }
            }}
            onDragLeaveTile={() => setDragOverIdx(null)}
            onDropTile={e => handleTileDrop(e, idx)}
            onRemove={() => onRemoveField(widget.id, f.name)}
            onPatch={patch => onPatchField(widget.id, f.name, patch)}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}

function FieldGridDropZone({ empty }) {
  return (
    <div style={{
      padding: '14px', textAlign: 'center', color: C.textMuted,
      fontSize: 11.5, fontStyle: 'italic', border: `1px dashed ${C.border}`,
      borderRadius: 6, background: '#fafbfd',
    }}>
      {empty ? 'This section has no field-group widget. Switch to List view to add other widget types.' : ''}
    </div>
  )
}

// ─── Field tile ──────────────────────────────────────────────────────────

function FieldTile({
  field, isDropTarget, popoverOpen, onOpenPopover, onClosePopover,
  onDragStart, onDragOverTile, onDragLeaveTile, onDropTile, onRemove, onPatch, disabled,
}) {
  const [hover, setHover] = useState(false)
  const typeColor = field.required ? C.emerald : C.textMuted

  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOverTile}
      onDragLeave={onDragLeaveTile}
      onDrop={onDropTile}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        border: `1px solid ${isDropTarget ? C.emerald : (hover ? C.borderDark : C.border)}`,
        borderLeft: `3px solid ${field.required ? C.emerald : (field.read_only ? C.sky : C.border)}`,
        borderRadius: 5, background: C.card, padding: '7px 9px',
        cursor: disabled ? 'default' : 'grab',
        boxShadow: isDropTarget ? `0 0 0 2px ${C.emerald}33` : 'none',
        transition: 'border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon path="M4 8h16M4 16h16" size={11} color={C.textMuted} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 11.5, color: C.textPrimary, fontWeight: 500, lineHeight: 1.2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {field.label || humanizeColumnName(field.name)}
            {field.required && <span style={{ color: C.emerald, marginLeft: 3 }}>*</span>}
          </div>
          <div style={{
            fontSize: 9, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace',
            marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {field.name} · {field.type || 'text'}
          </div>
        </div>
        {(hover || popoverOpen) && !disabled && (
          <>
            <button onClick={onOpenPopover} title="Field options" style={miniBtnStyle}>
              <Icon path="M12 6v.01M12 12v.01M12 18v.01" size={13} color={C.textSecondary} />
            </button>
            <button onClick={onRemove} title="Remove field" style={miniBtnStyle}>
              <Icon path="M6 18L18 6M6 6l12 12" size={12} color={C.danger} />
            </button>
          </>
        )}
      </div>

      {popoverOpen && (
        <FieldOptionsPopover field={field} onPatch={onPatch} onClose={onClosePopover} />
      )}
    </div>
  )
}

function FieldOptionsPopover({ field, onPatch, onClose }) {
  const [label, setLabel] = useState(field.label || humanizeColumnName(field.name))
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30,
        width: 220, background: C.card, border: `1px solid ${C.borderDark}`,
        borderRadius: 7, boxShadow: '0 6px 20px rgba(13,26,46,0.15)', padding: 10,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        Field Label
      </div>
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => { const v = label.trim(); if (v && v !== field.label) onPatch({ label: v }) }}
        onKeyDown={e => { if (e.key === 'Enter') { const v = label.trim(); if (v) onPatch({ label: v }); onClose() } }}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12,
          border: `1px solid ${C.border}`, borderRadius: 4, outline: 'none', marginBottom: 10,
        }}
      />
      <label style={toggleRowStyle}>
        <input
          type="checkbox"
          checked={field.required === true}
          onChange={e => onPatch({ required: e.target.checked })}
        />
        <span>Required</span>
      </label>
      <label style={toggleRowStyle}>
        <input
          type="checkbox"
          checked={field.read_only === true}
          onChange={e => onPatch({ read_only: e.target.checked })}
        />
        <span>Read-only</span>
      </label>
    </div>
  )
}

// ─── Non-field widget tile (related list, conversation, etc.) ───────────

const WIDGET_TYPE_LABELS = {
  related_list: 'Related List',
  conversation_panel: 'Conversation',
  file_gallery: 'Files',
  report: 'Report',
  status_path: 'Status Path',
  prtsn_history: 'History',
  activity_timeline: 'Activity Timeline',
}

function NonFieldWidgetTile({ widget }) {
  const label = WIDGET_TYPE_LABELS[widget.widget_type] || widget.widget_type
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px',
      marginBottom: 8, border: `1px solid ${C.border}`, borderRadius: 6,
      background: '#f7f9fc',
    }}>
      <Icon path="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z M4 9h16" size={14} color={C.sky} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textPrimary }}>{widget.widget_title || label}</div>
        <div style={{ fontSize: 10, color: C.textMuted }}>{label} · edit contents in List view</div>
      </div>
      <span style={{ fontSize: 9.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
        {widget.page_layout_widget_record_number}
      </span>
    </div>
  )
}

// ─── Section settings popover ────────────────────────────────────────────

function SectionSettings({ section, onApply, onClose }) {
  const [columns, setColumns] = useState(section.columns || 2)
  const [collapsible, setCollapsible] = useState(section.isCollapsible === true)
  const [collapsedDefault, setCollapsedDefault] = useState(section.isCollapsedByDefault === true)
  const [tab, setTab] = useState(section.tab || '')
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  return (
    <div ref={ref} style={{
      borderBottom: `1px solid ${C.border}`, background: '#fbfcfe', padding: 12,
    }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={settingsLabelStyle}>Columns</div>
          <div style={{ display: 'flex', gap: 0 }}>
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => setColumns(n)}
                style={{
                  padding: '5px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${columns === n ? C.emerald : C.border}`,
                  background: columns === n ? C.emerald : C.card,
                  color: columns === n ? '#fff' : C.textPrimary,
                  borderRadius: n === 1 ? '5px 0 0 5px' : n === 3 ? '0 5px 5px 0' : 0,
                  borderLeftWidth: n === 1 ? 1 : 0,
                }}
              >{n}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={settingsLabelStyle}>Tab</div>
          <input
            value={tab}
            onChange={e => setTab(e.target.value)}
            placeholder="Details"
            style={{
              padding: '5px 8px', fontSize: 12, border: `1px solid ${C.border}`,
              borderRadius: 5, outline: 'none', width: 120,
            }}
          />
        </div>
        <div style={{ paddingTop: 18 }}>
          <label style={toggleRowStyle}>
            <input type="checkbox" checked={collapsible} onChange={e => setCollapsible(e.target.checked)} />
            <span>Collapsible</span>
          </label>
          <label style={{ ...toggleRowStyle, opacity: collapsible ? 1 : 0.5 }}>
            <input type="checkbox" disabled={!collapsible} checked={collapsedDefault} onChange={e => setCollapsedDefault(e.target.checked)} />
            <span>Collapsed by default</span>
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={settingsBtnSecondary}>Cancel</button>
        <button
          onClick={() => onApply({
            columns,
            isCollapsible: collapsible,
            isCollapsedByDefault: collapsible ? collapsedDefault : false,
            tab: tab.trim() || null,
          })}
          style={settingsBtnPrimary}
        >Apply</button>
      </div>
    </div>
  )
}

function DeleteSectionConfirm({ section, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.55)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{ width: 420, background: C.card, borderRadius: 10, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>
          Delete section "{section.label}"?
        </div>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          This soft-deletes the section and its {(section.widgets || []).length} widget{(section.widgets || []).length === 1 ? '' : 's'}. Recoverable from the Recycle Bin.
        </div>
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Reason for deletion (required)"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 5, outline: 'none', marginBottom: 14 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={settingsBtnSecondary}>Cancel</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
            style={{ ...settingsBtnPrimary, background: reason.trim() ? C.danger : C.border, borderColor: reason.trim() ? C.danger : C.border, opacity: reason.trim() ? 1 : 0.7 }}
          >Delete Section</button>
        </div>
      </div>
    </div>
  )
}

// ─── Shared styles ───────────────────────────────────────────────────────

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, border: `1px solid ${C.border}`, borderRadius: 5,
  background: C.card, cursor: 'pointer', padding: 0,
}
const miniBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, border: 'none', borderRadius: 4,
  background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0,
}
const toggleRowStyle = {
  display: 'flex', alignItems: 'center', gap: 7, fontSize: 12,
  color: C.textPrimary, marginBottom: 6, cursor: 'pointer',
}
const settingsLabelStyle = {
  fontSize: 10, fontWeight: 700, color: C.textSecondary,
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5,
}
const settingsBtnSecondary = {
  padding: '6px 14px', fontSize: 12, fontWeight: 500, border: `1px solid ${C.border}`,
  borderRadius: 5, background: C.card, color: C.textSecondary, cursor: 'pointer',
}
const settingsBtnPrimary = {
  padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${C.emerald}`,
  borderRadius: 5, background: C.emerald, color: '#fff', cursor: 'pointer',
}
