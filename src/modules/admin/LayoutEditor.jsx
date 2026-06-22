import { useState, useEffect, useCallback, useRef } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { fetchRoles, fetchPicklistsFor } from '../../data/adminService'
import {
  fetchLayoutForEdit,
  updatePageLayoutMeta,
  softDeletePageLayout,
  createSection,
  updateSection,
  softDeleteSection,
  reorderSections,
  softDeleteWidget,
  reorderWidgets,
  fetchActionsForLayout,
  upsertActionOverride,
  clearActionOverride,
} from '../../data/pageLayoutBuilderService'
import {
  ALL_OBJECTS,
  buildLayoutActionConfig,
  actionColors,
} from '../../data/recordActions'
import {
  FormField,
  inputStyle, textareaStyle,
  buttonPrimaryStyle, buttonSecondaryStyle, buttonDangerStyle,
  buttonSmPrimaryStyle, buttonSmSecondaryStyle, buttonSmDangerStyle,
  hintBoxStyle, dangerBoxStyle,
} from './adminStyles'
import LayoutCanvas from './LayoutCanvas'
import AddWidgetModal from './widgets/AddWidgetModal'
import WidgetEditorFieldGroup from './widgets/WidgetEditorFieldGroup'
import WidgetEditorRelatedList from './widgets/WidgetEditorRelatedList'
import WidgetEditorConversationPanel from './widgets/WidgetEditorConversationPanel'

// ---------------------------------------------------------------------------
// LayoutEditor — the replacement for LayoutStructureViewer. Fully editable:
//   - Metadata card with inline Edit/Save/Cancel (name, description, role,
//     record type, is_default)
//   - Section list with drag-to-reorder, inline label editing, settings
//     popover (columns / collapsible / tab), soft delete
//   - Widget list within each section with drag-to-reorder and soft delete
//   - Danger zone with layout soft-delete
//
// Not yet in this iteration (Turn B):
//   - Adding new widgets (needs the widget editor modals)
//   - Editing widget contents (field picker for field_group, target picker
//     for related_list) — "Edit contents" button is rendered disabled
//     with a "coming next" tooltip
// ---------------------------------------------------------------------------

export default function LayoutEditor({
  layoutId,
  objectLabel,
  onBack,
  onLayoutsChanged,
}) {
  const toast = useToast()
  const [struct, setStruct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [roles, setRoles] = useState([])
  const [recordTypes, setRecordTypes] = useState([])
  const [busy, setBusy] = useState(false)
  const [viewMode, setViewMode] = useState('canvas') // 'canvas' | 'list'

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const s = await fetchLayoutForEdit(layoutId)
      setStruct(s)
      if (s) {
        // Fetch roles + record types for the metadata dropdowns (only if we
        // haven't loaded them yet for this editor).
        if (roles.length === 0) {
          const [roleRows, picklistRows] = await Promise.all([
            fetchRoles(),
            fetchPicklistsFor(s.layout.object),
          ])
          setRoles(roleRows)
          setRecordTypes(picklistRows.filter(p => p.field === 'record_type' && p.status === 'Active'))
        }
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutId])

  useEffect(() => { refresh() }, [refresh])

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>Loading layout…</div>
  }
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: '#b03a2e', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Could not load layout</div>
        <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{String(error.message || error)}</div>
      </div>
    )
  }
  if (!struct) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>Layout not found.</div>
  }

  const { layout, sections } = struct

  async function handleDeleteLayout(reason) {
    setBusy(true)
    try {
      await softDeletePageLayout(layoutId, reason)
      toast.success(`Deleted "${layout.name}"`)
      if (onLayoutsChanged) await onLayoutsChanged()
      onBack()
    } catch (err) {
      toast.error(`Delete failed: ${err.message || err}`)
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '16px 24px 48px' }}>
      {/* Back link */}
      <div
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 11.5, color: C.textMuted, cursor: 'pointer', marginBottom: 12,
        }}
        onMouseEnter={e => e.currentTarget.style.color = C.emerald}
        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
      >
        <Icon path="M15 19l-7-7 7-7" size={12} color="currentColor" /> Back to Page Layouts
      </div>

      {/* Title row */}
      <div style={{
        display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 12,
        marginBottom: 4,
      }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: C.textPrimary }}>{layout.name}</div>
        <div style={{ fontSize: 12, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
          {layout.recordNumber}
        </div>
        {layout.isDefault && (
          <span style={{
            background: '#e8f8f2', color: '#1a7a4e',
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>Default</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
        {objectLabel || layout.object} · {layout.type}
        {layout.recordTypeLabel && <> · Record Type: <strong>{layout.recordTypeLabel}</strong></>}
        {layout.roleName && <> · Role: <strong>{layout.roleName}</strong></>}
      </div>

      {/* View toggle: WYSIWYG canvas vs. structured list */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
        {[
          { key: 'canvas', label: 'Canvas', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v4H4V5zM4 11h7v8H5a1 1 0 01-1-1v-7zM13 11h7v7a1 1 0 01-1 1h-6v-8z' },
          { key: 'list', label: 'List', icon: 'M4 6h16M4 12h16M4 18h16' },
        ].map((m, i) => {
          const active = viewMode === m.key
          return (
            <button
              key={m.key}
              onClick={() => setViewMode(m.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? C.emerald : C.border}`,
                background: active ? C.emerald : C.card,
                color: active ? '#fff' : C.textSecondary,
                borderRadius: i === 0 ? '6px 0 0 6px' : '0 6px 6px 0',
                borderLeftWidth: i === 0 ? 1 : 0,
              }}
            >
              <Icon path={m.icon} size={13} color="currentColor" />
              {m.label}
            </button>
          )
        })}
        <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 12 }}>
          {viewMode === 'canvas'
            ? 'Drag fields from the palette onto sections. Every field is shown.'
            : 'Structured editor — add other widget types and edit their contents.'}
        </span>
      </div>

      {/* Metadata card */}
      <MetadataCard
        layout={layout}
        roles={roles}
        recordTypes={recordTypes}
        sections={sections}
        onSaved={async () => {
          await refresh()
          if (onLayoutsChanged) await onLayoutsChanged()
        }}
        disabled={busy}
      />

      {/* Body: WYSIWYG canvas or structured list */}
      {viewMode === 'canvas' ? (
        <LayoutCanvas
          layout={layout}
          sections={sections}
          objectName={layout.object}
          onChanged={async () => { await refresh(); if (onLayoutsChanged) await onLayoutsChanged() }}
          disabled={busy}
        />
      ) : (
        <SectionsList
          sections={sections}
          layoutId={layoutId}
          objectName={layout.object}
          onChanged={async () => { await refresh(); if (onLayoutsChanged) await onLayoutsChanged() }}
          disabled={busy}
        />
      )}

      {/* Actions — per-layout topbar action tier overrides */}
      <ActionsSection
        layoutId={layoutId}
        objectName={layout.object}
        disabled={busy}
      />

      {/* Danger zone */}
      <DangerZone
        layout={layout}
        onDelete={handleDeleteLayout}
        busy={busy}
      />
    </div>
  )
}

// ─── Metadata Card ─────────────────────────────────────────────────────

function MetadataCard({ layout, roles, recordTypes, sections, onSaved, disabled }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(layout.name)
  const [description, setDescription] = useState(layout.description || '')
  const [roleId, setRoleId] = useState(layout.roleId || '')
  const [recordTypeId, setRecordTypeId] = useState(layout.recordTypeId || '')
  const [isDefault, setIsDefault] = useState(layout.isDefault)

  // Re-sync local form state when the parent layout changes (e.g. after save).
  useEffect(() => {
    if (!editing) {
      setName(layout.name)
      setDescription(layout.description || '')
      setRoleId(layout.roleId || '')
      setRecordTypeId(layout.recordTypeId || '')
      setIsDefault(layout.isDefault)
    }
  }, [editing, layout])

  async function save() {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      await updatePageLayoutMeta(layout.id, {
        name: name.trim(),
        description: description.trim() || null,
        roleId: roleId || null,
        recordTypeId: recordTypeId || null,
        isDefault,
      })
      toast.success('Layout updated')
      setEditing(false)
      await onSaved()
    } catch (err) {
      toast.error(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  const widgetCount = sections.reduce((sum, s) => sum + s.widgets.length, 0)

  return (
    <div style={cardStyle}>
      <div style={cardHeaderStyle}>
        <span>Metadata</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {editing ? (
            <>
              <button style={buttonSmSecondaryStyle} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              <button style={buttonSmPrimaryStyle} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <button style={buttonSmSecondaryStyle} onClick={() => setEditing(true)} disabled={disabled}>Edit</button>
          )}
        </div>
      </div>
      <div style={cardBodyStyle}>
        {editing ? (
          <>
            <FormField label="Name" required>
              <input value={name} onChange={e => setName(e.target.value)} disabled={saving} style={inputStyle} />
            </FormField>
            <FormField label="Description">
              <textarea value={description} onChange={e => setDescription(e.target.value)} disabled={saving} style={textareaStyle} />
            </FormField>
            <FormField label="Role" hint="Blank = all roles.">
              <select value={roleId} onChange={e => setRoleId(e.target.value)} disabled={saving} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">All roles</option>
                {roles.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
              </select>
            </FormField>
            <FormField label="Record Type" hint="Blank = the master/default layout.">
              <select value={recordTypeId} onChange={e => setRecordTypeId(e.target.value)} disabled={saving} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Master (no specific record type)</option>
                {recordTypes.map(rt => <option key={rt._id} value={rt._id}>{rt.label}</option>)}
              </select>
            </FormField>
            <FormField label="Default">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
                <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} disabled={saving} />
                Use this layout by default for its (record type, role) combination
              </label>
            </FormField>
          </>
        ) : (
          <>
            <KV label="Name"         value={layout.name} />
            <KV label="Description"  value={layout.description || <em style={{ color: C.textMuted }}>No description</em>} />
            <KV label="Object"       value={layout.object} mono />
            <KV label="Type"         value={layout.type} mono />
            <KV label="Role"         value={layout.roleName || <em style={{ color: C.textMuted }}>All roles</em>} />
            <KV label="Record Type"  value={layout.recordTypeLabel || <em style={{ color: C.textMuted }}>Master (no specific record type)</em>} />
            <KV label="Default"      value={layout.isDefault ? 'Yes' : 'No'} />
            <KV label="Sections"     value={sections.length} mono />
            <KV label="Widgets"      value={widgetCount} mono />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sections List ─────────────────────────────────────────────────────

function SectionsList({ sections, layoutId, objectName, onChanged, disabled }) {
  const toast = useToast()
  const [addingSection, setAddingSection] = useState(false)
  // Reordering state — follows the HTML5 DnD pattern used in RecordDetail.
  const [localSections, setLocalSections] = useState(sections)
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  // dropColumnHint = 'main' | 'right' | null. Tracks which column the user
  // is hovering when they're over the empty area of a column (no specific
  // target section). Used by the cross-column drag path to know what
  // placement to assign when the drop hits the column footer.
  const [dropColumnHint, setDropColumnHint] = useState(null)
  const [savingOrder, setSavingOrder] = useState(false)

  // Keep localSections in sync when the parent refetches
  useEffect(() => { setLocalSections(sections) }, [sections])

  // Split sections into the two columns. Within each column they render in
  // the global section_order — that's the same field used for both columns,
  // since RecordDetail filters by placement before rendering.
  const mainSections = localSections.filter(s => (s.placement || 'main') === 'main')
  const rightSections = localSections.filter(s => s.placement === 'right')

  function handleDragStart(e, id) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(id)) } catch { /* Safari */ }
  }
  function handleDragOverSection(e, id) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) setDragOverId(id)
  }
  function handleDragOverColumn(e, col) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropColumnHint !== col) setDropColumnHint(col)
  }
  function handleDragEnd() {
    setDragId(null)
    setDragOverId(null)
    setDropColumnHint(null)
  }

  /**
   * Perform a drop: either reorder within a column or move across columns.
   * targetColumn = 'main' | 'right'. targetId = section id we dropped on,
   * or null if dropping in the column footer (append to end).
   */
  async function performDrop(targetColumn, targetId) {
    const srcId = dragId
    setDragId(null); setDragOverId(null); setDropColumnHint(null)
    if (!srcId) return

    const src = localSections.find(s => s.id === srcId)
    if (!src) return

    // Build the new ordering: pull src out, insert it at the target position
    // in the target column. Other column stays untouched.
    const srcPlacement = src.placement || 'main'
    const otherColumn = targetColumn === 'main' ? rightSections : mainSections
    let intoColumn = (targetColumn === 'main' ? mainSections : rightSections)
      .filter(s => s.id !== srcId)
    let insertAt
    if (!targetId) {
      insertAt = intoColumn.length // append
    } else {
      const idx = intoColumn.findIndex(s => s.id === targetId)
      insertAt = idx >= 0 ? idx : intoColumn.length
    }
    intoColumn = [
      ...intoColumn.slice(0, insertAt),
      { ...src, placement: targetColumn },
      ...intoColumn.slice(insertAt),
    ]

    // Final full ordering: main column first, then right column. Both arrays
    // already have any moved section inserted; the placement field on the
    // moved row reflects its new home.
    const newMain = targetColumn === 'main' ? intoColumn : otherColumn
    const newRight = targetColumn === 'right' ? intoColumn : otherColumn
    const next = [...newMain, ...newRight]

    // No-op guard: if src is already in the target column and at the same
    // position, don't save.
    const wasSamePos = srcPlacement === targetColumn
      && (targetColumn === 'main' ? mainSections : rightSections)
        .findIndex(s => s.id === srcId) === insertAt
    if (wasSamePos) return

    const before = localSections
    setLocalSections(next)
    setSavingOrder(true)
    try {
      if (srcPlacement !== targetColumn) {
        await updateSection(srcId, { placement: targetColumn })
      }
      await reorderSections(layoutId, next.map(s => s.id))
      await onChanged()
    } catch (err) {
      toast.error(`Move failed: ${err.message || err}`)
      setLocalSections(before)
    } finally {
      setSavingOrder(false)
    }
  }

  async function handleAddSection(label, opts = {}) {
    if (!label.trim()) return
    try {
      await createSection(layoutId, {
        label: label.trim(),
        placement: opts.placement === 'right' ? 'right' : 'main',
      })
      toast.success('Section added')
      setAddingSection(false)
      await onChanged()
    } catch (err) {
      toast.error(`Add failed: ${err.message || err}`)
    }
  }

  function renderColumn(col, cards, headerLabel, helperText) {
    const isActiveDropZone = dropColumnHint === col && dragId
    return (
      <div
        key={col}
        onDragOver={e => handleDragOverColumn(e, col)}
        onDrop={e => { e.preventDefault(); performDrop(col, null) }}
        style={{
          background: isActiveDropZone ? '#f0fdf4' : 'transparent',
          border: isActiveDropZone ? `1px dashed ${C.emerald}` : '1px dashed transparent',
          borderRadius: 8,
          padding: 8,
          marginBottom: 8,
          transition: 'background 0.12s, border-color 0.12s',
        }}
      >
        <div style={{
          fontSize: 11.5, fontWeight: 600, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: 0.4,
          padding: '4px 4px 8px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon
            path={col === 'right'
              ? 'M9 4v16M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z'
              : 'M15 4v16M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z'}
            size={12}
            color="currentColor"
          />
          {headerLabel} · {cards.length}
        </div>
        {cards.length === 0 ? (
          <div style={{
            padding: '24px 16px', textAlign: 'center',
            background: C.card, border: `1px dashed ${C.borderDark || C.border}`, borderRadius: 8,
            color: C.textMuted, fontSize: 12, fontStyle: 'italic',
          }}>
            {helperText}
          </div>
        ) : (
          cards.map(section => (
            <SectionCard
              key={section.id}
              section={section}
              idx={localSections.findIndex(s => s.id === section.id)}
              objectName={objectName}
              isDragging={dragId === section.id}
              isDropTarget={dragOverId === section.id && dragId && dragId !== section.id}
              onDragStart={e => handleDragStart(e, section.id)}
              onDragOver={e => handleDragOverSection(e, section.id)}
              onDragEnd={handleDragEnd}
              onDrop={e => { e.preventDefault(); performDrop(col, section.id) }}
              onChanged={onChanged}
              disabled={disabled || savingOrder}
            />
          ))
        )}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, padding: '0 2px',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
          Sections · {localSections.length}
          <span style={{ fontSize: 11, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}>
            Drag between Main and Right Sidebar to change placement
          </span>
        </div>
        {savingOrder && (
          <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>Saving order…</div>
        )}
      </div>

      {localSections.length === 0 && !addingSection && (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: C.card, border: `1px dashed ${C.borderDark || C.border}`, borderRadius: 8,
          color: C.textMuted, fontSize: 12.5, marginBottom: 10,
        }}>
          This layout has no sections yet.
        </div>
      )}

      {renderColumn('main', mainSections, 'Main content', 'Drag a section here to put it on the main page tabs.')}
      {renderColumn('right', rightSections, 'Right sidebar', 'Drag a section here to put it in the always-visible right rail.')}

      {addingSection ? (
        <AddSectionInline onSave={handleAddSection} onCancel={() => setAddingSection(false)} />
      ) : (
        <button
          onClick={() => setAddingSection(true)}
          disabled={disabled}
          style={{
            ...buttonSecondaryStyle,
            marginTop: 8,
            borderStyle: 'dashed',
            borderColor: C.borderDark || C.border,
            width: '100%',
            justifyContent: 'center',
            padding: '12px',
          }}
        >
          <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" />
          Add Section
        </button>
      )}
    </div>
  )
}

function AddSectionInline({ onSave, onCancel }) {
  const [label, setLabel] = useState('')
  const [placement, setPlacement] = useState('main')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  async function save() {
    setBusy(true)
    await onSave(label, { placement })
    setBusy(false)
  }

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderDark || C.border}`, borderRadius: 8,
      padding: 12, marginTop: 8,
      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <input
        ref={inputRef}
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && label.trim()) save()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Section name (e.g. Basic Information)"
        disabled={busy}
        style={{ ...inputStyle, flex: 1, minWidth: 200 }}
      />
      <select
        value={placement}
        onChange={e => setPlacement(e.target.value)}
        disabled={busy}
        title="Placement"
        style={{ ...inputStyle, cursor: 'pointer', width: 150 }}
      >
        <option value="main">Main content</option>
        <option value="right">Right sidebar</option>
      </select>
      <button style={buttonSmSecondaryStyle} onClick={onCancel} disabled={busy}>Cancel</button>
      <button style={buttonSmPrimaryStyle} onClick={save} disabled={busy || !label.trim()}>
        {busy ? 'Adding…' : 'Add Section'}
      </button>
    </div>
  )
}

// ─── Section Card ──────────────────────────────────────────────────────

function SectionCard({
  section, idx, objectName, isDragging, isDropTarget,
  onDragStart, onDragOver, onDragEnd, onDrop,
  onChanged, disabled,
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [label, setLabel] = useState(section.label || '')
  const [columns, setColumns] = useState(section.columns || 3)
  const [collapsible, setCollapsible] = useState(section.isCollapsible)
  const [collapsedByDefault, setCollapsedByDefault] = useState(section.isCollapsedByDefault)
  const [tab, setTab] = useState(section.tab || 'Details')
  const [placement, setPlacement] = useState(section.placement || 'main')

  useEffect(() => {
    if (!editing) {
      setLabel(section.label || '')
      setColumns(section.columns || 3)
      setCollapsible(section.isCollapsible)
      setCollapsedByDefault(section.isCollapsedByDefault)
      setTab(section.tab || 'Details')
      setPlacement(section.placement || 'main')
    }
  }, [editing, section])

  async function save() {
    if (!label.trim()) {
      toast.error('Section label is required')
      return
    }
    setSaving(true)
    try {
      await updateSection(section.id, {
        label: label.trim(),
        columns: parseInt(columns, 10) || 3,
        isCollapsible: collapsible,
        isCollapsedByDefault: collapsedByDefault,
        tab: tab.trim() || 'Details',
        placement: placement === 'right' ? 'right' : 'main',
      })
      toast.success('Section updated')
      setEditing(false)
      await onChanged()
    } catch (err) {
      toast.error(`Save failed: ${err.message || err}`)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete(reason) {
    setDeleting(true)
    try {
      await softDeleteSection(section.id, reason)
      toast.success(`Deleted section "${section.label}"`)
      setShowDeleteConfirm(false)
      await onChanged()
    } catch (err) {
      toast.error(`Delete failed: ${err.message || err}`)
      setDeleting(false)
    }
  }

  return (
    <div
      draggable={!editing && !disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      style={{
        ...cardStyle,
        opacity: isDragging ? 0.4 : 1,
        borderTop: isDropTarget ? `3px solid ${C.emerald}` : `1px solid ${C.border}`,
        transition: 'opacity 0.15s, border-top 0.1s',
      }}
    >
      <div style={{ ...cardHeaderStyle, gap: 10 }}>
        {/* Drag handle */}
        <div
          title="Drag to reorder"
          style={{
            color: C.textMuted, cursor: editing ? 'default' : 'grab', padding: '2px 4px',
            display: 'flex', alignItems: 'center',
          }}
        >
          <Icon path="M4 6h16M4 12h16M4 18h16" size={14} color="currentColor" />
        </div>

        {editing ? (
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            disabled={saving}
            style={{ ...inputStyle, flex: 1, padding: '5px 8px', fontSize: 13 }}
          />
        ) : (
          <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Section {idx + 1} · {section.label || <em style={{ color: C.textMuted, fontWeight: 400 }}>Untitled</em>}
          </span>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {editing ? (
            <>
              <button style={buttonSmSecondaryStyle} onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              <button style={buttonSmPrimaryStyle} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </>
          ) : (
            <>
              <button style={buttonSmSecondaryStyle} onClick={() => setEditing(true)} disabled={disabled}>Edit</button>
              <button
                style={buttonSmDangerStyle}
                onClick={() => setShowDeleteConfirm(true)}
                disabled={disabled}
                title="Soft-delete this section"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div style={cardBodyStyle}>
        {/* Section metadata — editable view */}
        {editing ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14, marginBottom: 4,
          }}>
            <FormField label="Columns" hint="How many columns the field grid uses.">
              <select value={columns} onChange={e => setColumns(e.target.value)} disabled={saving} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </FormField>
            <FormField label="Tab" hint="Which record detail tab this section appears on.">
              <input value={tab} onChange={e => setTab(e.target.value)} disabled={saving || placement === 'right'} style={inputStyle} />
            </FormField>
            <FormField label="Placement" hint="Main = inside the active tab. Right = persistent right sidebar (always visible regardless of tab).">
              <select value={placement} onChange={e => setPlacement(e.target.value)} disabled={saving} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="main">Main content</option>
                <option value="right">Right sidebar</option>
              </select>
            </FormField>
            <FormField label="Collapsible">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer' }}>
                <input type="checkbox" checked={collapsible} onChange={e => setCollapsible(e.target.checked)} disabled={saving} />
                User can collapse this section
              </label>
            </FormField>
            {collapsible && (
              <FormField label="Collapsed by default">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer' }}>
                  <input type="checkbox" checked={collapsedByDefault} onChange={e => setCollapsedByDefault(e.target.checked)} disabled={saving} />
                  Start collapsed
                </label>
              </FormField>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 10 }}>
            {(section.placement || 'main') === 'right' ? (
              <>Placement: <strong style={{ color: C.emerald }}>Right sidebar</strong> · </>
            ) : (
              <>Tab: <strong style={{ color: C.textSecondary }}>{section.tab}</strong> · </>
            )}
            Columns: <strong style={{ color: C.textSecondary }}>{section.columns}</strong>
            {section.isCollapsible && <> · <span style={{ color: C.textSecondary }}>Collapsible{section.isCollapsedByDefault ? ' (collapsed)' : ''}</span></>}
            {' '}· {section.widgets.length} widget{section.widgets.length === 1 ? '' : 's'}
          </div>
        )}

        {/* Widgets */}
        <WidgetsList
          sectionId={section.id}
          sectionLabel={section.label}
          objectName={objectName}
          widgets={section.widgets}
          onChanged={onChanged}
          disabled={disabled || editing}
        />
      </div>

      {showDeleteConfirm && (
        <DeleteSectionModal
          section={section}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </div>
  )
}

// ─── Widgets List ──────────────────────────────────────────────────────

function WidgetsList({ sectionId, sectionLabel, objectName, widgets, onChanged, disabled }) {
  const toast = useToast()
  const [localWidgets, setLocalWidgets] = useState(widgets)
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [savingOrder, setSavingOrder] = useState(false)

  // Modal state
  const [addingWidget, setAddingWidget] = useState(false)
  const [editingWidget, setEditingWidget] = useState(null) // the widget object being edited

  useEffect(() => { setLocalWidgets(widgets) }, [widgets])

  function handleDragStart(e, idx) {
    setDragIndex(idx)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', String(idx)) } catch { /* Safari */ }
    e.stopPropagation() // don't trigger section drag
  }
  function handleDragOver(e, idx) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== idx) setDragOverIndex(idx)
  }
  function handleDragEnd(e) { e?.stopPropagation(); setDragIndex(null); setDragOverIndex(null) }

  async function handleDrop(e, dropIdx) {
    e.preventDefault()
    e.stopPropagation()
    const srcIdx = dragIndex
    setDragIndex(null); setDragOverIndex(null)
    if (srcIdx === null || srcIdx === dropIdx) return

    const before = localWidgets
    const next = [...localWidgets]
    const [moved] = next.splice(srcIdx, 1)
    next.splice(dropIdx, 0, moved)
    setLocalWidgets(next)
    setSavingOrder(true)
    try {
      await reorderWidgets(sectionId, next.map(w => w.id))
      await onChanged()
    } catch (err) {
      toast.error(`Reorder failed: ${err.message || err}`)
      setLocalWidgets(before)
    } finally {
      setSavingOrder(false)
    }
  }

  async function handleRemove(widget) {
    if (!window.confirm(`Remove widget "${widget.widget_title || widget.widget_type}"?`)) return
    try {
      await softDeleteWidget(widget.id, 'Removed via Page Layout Builder')
      toast.success('Widget removed')
      await onChanged()
    } catch (err) {
      toast.error(`Remove failed: ${err.message || err}`)
    }
  }

  // After AddWidgetModal creates a new widget, refresh the parent layout so
  // the new widget appears in section.widgets, then immediately open the
  // appropriate editor for that widget — the user configures its contents
  // without an extra click.
  async function handleWidgetCreated(widget) {
    setAddingWidget(false)
    await onChanged()
    setEditingWidget(widget)
  }

  async function handleWidgetSaved() {
    setEditingWidget(null)
    await onChanged()
  }

  return (
    <div>
      {savingOrder && (
        <div style={{ fontSize: 10.5, color: C.textMuted, fontStyle: 'italic', marginBottom: 4, textAlign: 'right' }}>
          Saving order…
        </div>
      )}
      {localWidgets.length === 0 ? (
        <div style={{
          padding: '22px 16px', textAlign: 'center',
          background: '#fafbfd', border: `1px dashed ${C.border}`, borderRadius: 6,
          color: C.textMuted, fontSize: 11.5, fontStyle: 'italic',
          marginBottom: 8,
        }}>
          No widgets in this section yet.
        </div>
      ) : (
        localWidgets.map((w, idx) => (
          <WidgetRow
            key={w.id}
            widget={w}
            isDragging={dragIndex === idx}
            isDropTarget={dragOverIndex === idx && dragIndex !== null && dragIndex !== idx}
            onDragStart={e => handleDragStart(e, idx)}
            onDragOver={e => handleDragOver(e, idx)}
            onDragEnd={handleDragEnd}
            onDrop={e => handleDrop(e, idx)}
            onEdit={() => setEditingWidget(w)}
            onRemove={() => handleRemove(w)}
            disabled={disabled || savingOrder}
          />
        ))
      )}

      {/* Add Widget button — always present, even in empty sections */}
      <button
        onClick={() => setAddingWidget(true)}
        disabled={disabled}
        style={{
          ...buttonSmSecondaryStyle,
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '7px 10px',
          marginTop: 4,
          borderStyle: 'dashed',
          borderColor: C.borderDark || C.border,
          width: '100%',
          justifyContent: 'center',
        }}
      >
        <Icon path="M12 5v14M5 12h14" size={12} color="currentColor" />
        Add Widget
      </button>

      {addingWidget && (
        <AddWidgetModal
          sectionId={sectionId}
          sectionLabel={sectionLabel}
          onClose={() => setAddingWidget(false)}
          onCreated={handleWidgetCreated}
        />
      )}

      {editingWidget && editingWidget.widget_type === 'field_group' && (
        <WidgetEditorFieldGroup
          widget={editingWidget}
          objectName={objectName}
          onClose={() => setEditingWidget(null)}
          onSaved={handleWidgetSaved}
        />
      )}
      {editingWidget && editingWidget.widget_type === 'related_list' && (
        <WidgetEditorRelatedList
          widget={editingWidget}
          objectName={objectName}
          onClose={() => setEditingWidget(null)}
          onSaved={handleWidgetSaved}
        />
      )}
      {editingWidget && editingWidget.widget_type === 'conversation_panel' && (
        <WidgetEditorConversationPanel
          widget={editingWidget}
          objectName={objectName}
          onClose={() => setEditingWidget(null)}
          onSaved={handleWidgetSaved}
        />
      )}
      {editingWidget && !['field_group', 'related_list', 'conversation_panel'].includes(editingWidget.widget_type) && (
        // Unknown widget type — fall back to a placeholder so the user sees
        // something instead of a silent no-op. Clicking Cancel closes it.
        <UnknownWidgetTypeModal
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
        />
      )}
    </div>
  )
}

function UnknownWidgetTypeModal({ widget, onClose }) {
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: C.card, borderRadius: 10, padding: 24,
        width: 420, maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
          No editor for this widget type
        </div>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          Widget type <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{widget.widget_type}</code> doesn't
          have a dedicated contents editor yet. The widget is still in the layout and can be
          reordered or removed as normal.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={buttonSecondaryStyle}>Close</button>
        </div>
      </div>
    </div>
  )
}

function WidgetRow({
  widget, isDragging, isDropTarget,
  onDragStart, onDragOver, onDragEnd, onDrop,
  onEdit, onRemove, disabled,
}) {
  const cfg = widget.widget_config || {}
  const fields = Array.isArray(cfg.fields) ? cfg.fields : []

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
        padding: '10px 12px',
        marginBottom: 6,
        opacity: isDragging ? 0.4 : 1,
        transition: 'opacity 0.15s, border 0.1s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: fields.length > 0 || widget.widget_type === 'related_list' ? 8 : 0 }}>
        <div style={{ color: C.textMuted, cursor: disabled ? 'default' : 'grab', padding: 2 }} title="Drag to reorder">
          <Icon path="M4 6h16M4 12h16M4 18h16" size={13} color="currentColor" />
        </div>
        <span style={{
          background: widget.widget_type === 'related_list' ? '#e8f3fb' : '#e8f8f2',
          color: widget.widget_type === 'related_list' ? '#1a5a8a' : '#1a7a4e',
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {widget.widget_type}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: C.textPrimary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {widget.widget_title || widget.widget_type}
        </span>
        <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
          {widget.page_layout_widget_record_number}
        </span>
        <button
          style={buttonSmSecondaryStyle}
          onClick={onEdit}
          disabled={disabled}
        >
          Edit contents
        </button>
        <button style={buttonSmDangerStyle} onClick={onRemove} disabled={disabled}>Remove</button>
      </div>

      {/* Inline preview — same as read-only viewer */}
      {widget.widget_type === 'field_group' && fields.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 5,
        }}>
          {fields.slice(0, 6).map((f, fi) => (
            <div key={fi} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 4,
              padding: '5px 9px', fontSize: 11,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: C.textSecondary,
            }}>
              <span style={{ color: C.textPrimary }}>{f.label || f.name}</span>
              <span style={{ color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, marginLeft: 5 }}>
                · {f.type}
              </span>
            </div>
          ))}
          {fields.length > 6 && (
            <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', alignSelf: 'center' }}>
              +{fields.length - 6} more
            </div>
          )}
        </div>
      )}
      {widget.widget_type === 'related_list' && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 4,
          padding: '5px 9px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          color: C.textSecondary,
        }}>
          Table: {cfg.table || '—'}
          {cfg.fk && <> · FK: {cfg.fk}</>}
          {Array.isArray(cfg.columns) && cfg.columns.length > 0 && <> · {cfg.columns.length} columns</>}
        </div>
      )}
    </div>
  )
}

// ─── Delete Section confirm ────────────────────────────────────────────

function DeleteSectionModal({ section, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('')
  const reasonRef = useRef(null)
  useEffect(() => { reasonRef.current?.focus() }, [])

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div role="dialog" aria-modal="true" style={{
        background: C.card, borderRadius: 10, padding: 24,
        width: 420, maxWidth: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>Delete this section?</div>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14, lineHeight: 1.5 }}>
          <strong>{section.label}</strong> and its {section.widgets.length} widget{section.widgets.length === 1 ? '' : 's'} will
          be hidden. You can recover it from the recycle bin.
        </div>
        <FormField label="Reason" required>
          <input
            ref={reasonRef}
            value={reason}
            onChange={e => setReason(e.target.value)}
            disabled={busy}
            placeholder="e.g. Consolidated with Basic Information"
            style={inputStyle}
          />
        </FormField>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={buttonSecondaryStyle} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            style={{ ...buttonPrimaryStyle, background: '#b03a2e' }}
            onClick={() => onConfirm(reason)}
            disabled={busy || !reason.trim()}
          >
            {busy ? 'Deleting…' : 'Delete Section'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Danger Zone ───────────────────────────────────────────────────────

function DangerZone({ layout, onDelete, busy }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const reasonRef = useRef(null)
  useEffect(() => {
    if (showConfirm) {
      const id = requestAnimationFrame(() => reasonRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [showConfirm])

  return (
    <div style={{
      marginTop: 24,
      border: '1px solid #f3b9b1',
      borderRadius: 8,
      background: '#fdf5f3',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '11px 14px',
        fontSize: 12.5, fontWeight: 700, color: '#8a2d20',
        borderBottom: '1px solid #f3b9b1',
        background: '#fdecea',
      }}>
        Danger Zone
      </div>
      <div style={{ padding: '14px' }}>
        {!showConfirm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary, marginBottom: 2 }}>Delete this layout</div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, lineHeight: 1.5 }}>
                Soft-deletes the layout and all its sections and widgets. Records that use this layout will fall back to the master layout.
              </div>
            </div>
            <button style={buttonDangerStyle} onClick={() => setShowConfirm(true)} disabled={busy}>
              Delete Layout
            </button>
          </div>
        ) : (
          <div>
            <FormField label="Reason" required>
              <input
                ref={reasonRef}
                value={reason}
                onChange={e => setReason(e.target.value)}
                disabled={busy}
                placeholder="Why are you deleting this layout?"
                style={inputStyle}
              />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={buttonSecondaryStyle} onClick={() => setShowConfirm(false)} disabled={busy}>Cancel</button>
              <button
                style={{ ...buttonPrimaryStyle, background: '#b03a2e' }}
                onClick={() => onDelete(reason.trim())}
                disabled={busy || !reason.trim()}
              >
                {busy ? 'Deleting…' : 'Permanently Hide This Layout'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────

function KV({ label, value, mono }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
      padding: '7px 0',
      borderBottom: `1px dashed ${C.border}`,
      fontSize: 12.5,
    }}>
      <div style={{ color: C.textMuted, fontWeight: 500 }}>{label}</div>
      <div style={{
        color: C.textPrimary,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        fontSize: mono ? 11.5 : 12.5,
      }}>{value ?? '—'}</div>
    </div>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────

const cardStyle = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  marginBottom: 12,
  overflow: 'hidden',
}

const cardHeaderStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 14px',
  fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
  borderBottom: `1px solid ${C.border}`, background: '#fafbfd',
}

const cardBodyStyle = {
  padding: '10px 14px 12px',
}

// ─── Actions Section ──────────────────────────────────────────────────────
//
// Per-layout configuration of the RecordDetail topbar's action tier
// assignment. Lists every action from the registry that's applicable to
// this layout's object. For each action:
//   - Tier dropdown (Primary / Menu / Hidden)
//   - Sort order numeric input
//   - Reset-to-default button (clears the override row)
//
// Overrides persist in page_layout_actions. Absence of an override row
// means the action takes its registry default. "Hidden" is recorded as
// an absent row plus a UI-only convention: applicability is determined
// by registry + runtime predicate, so the only way to "hide" an
// applicable action today is to delete it from the registry. The Hidden
// option exists in the dropdown for forward-compat — when we add a
// `pla_display_tier='hidden'` option to the CHECK constraint, the UI
// will support it without change. Until then, picking Hidden falls back
// to Menu with a toast.
// ──────────────────────────────────────────────────────────────────────────

function ActionsSection({ layoutId, objectName, disabled }) {
  const toast = useToast()
  const [overrides, setOverrides] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchActionsForLayout(layoutId)
      setOverrides(rows || [])
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [layoutId])

  useEffect(() => { refresh() }, [refresh])

  const rows = buildLayoutActionConfig({ objectName, overrides })

  // ── Per-row mutations ──
  async function setTier(actionKey, nextTier, currentRow) {
    if (busy || disabled) return
    setBusy(true)
    try {
      await upsertActionOverride({
        layoutId,
        actionKey,
        displayTier: nextTier,
        sortOrder:    currentRow.effectiveSortOrder,
        labelOverride: currentRow.override?.pla_label_override ?? null,
      })
      await refresh()
    } catch (e) {
      toast.error(`Update failed: ${e.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function setSortOrder(actionKey, nextOrder, currentRow) {
    if (busy || disabled) return
    if (!Number.isFinite(nextOrder)) return
    setBusy(true)
    try {
      await upsertActionOverride({
        layoutId,
        actionKey,
        displayTier:  currentRow.effectiveTier,
        sortOrder:     nextOrder,
        labelOverride: currentRow.override?.pla_label_override ?? null,
      })
      await refresh()
    } catch (e) {
      toast.error(`Update failed: ${e.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function resetRow(actionKey) {
    if (busy || disabled) return
    setBusy(true)
    try {
      await clearActionOverride({ layoutId, actionKey, reason: 'Reset to default via Layout Editor' })
      toast.success('Reset to default')
      await refresh()
    } catch (e) {
      toast.error(`Reset failed: ${e.message || String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 0', cursor: 'pointer', userSelect: 'none',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon
            path={collapsed ? 'M9 5l7 7-7 7' : 'M5 9l7 7 7-7'}
            size={12}
            color={C.textSecondary}
          />
          <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
            Actions · {rows.length}
            <span style={{ fontSize: 11, fontWeight: 400, color: C.textMuted, marginLeft: 8 }}>
              Promote or demote which buttons appear in the topbar of this layout
            </span>
          </div>
        </div>
        {(loading || busy) && (
          <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>
            {loading ? 'Loading…' : 'Saving…'}
          </div>
        )}
      </div>

      {!collapsed && (
        <div style={{ marginTop: 10 }}>
          {error && (
            <div style={{ ...dangerBoxStyle, marginBottom: 10 }}>
              Could not load action config: {String(error.message || error)}
            </div>
          )}
          {rows.length === 0 ? (
            <div style={{
              padding: '32px 16px', textAlign: 'center',
              background: C.card, border: `1px dashed ${C.borderDark || C.border}`,
              borderRadius: 8, color: C.textMuted, fontSize: 12,
            }}>
              No actions are applicable to this object.
            </div>
          ) : (
            <div style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              {/* Header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '32px 1fr 130px 90px 90px',
                gap: 12, padding: '8px 12px',
                background: '#fafbfd',
                borderBottom: `1px solid ${C.border}`,
                fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.4,
                color: C.textMuted,
              }}>
                <div></div>
                <div>Action</div>
                <div>Tier</div>
                <div style={{ textAlign: 'center' }}>Order</div>
                <div style={{ textAlign: 'right' }}>Reset</div>
              </div>
              {rows.map(r => <ActionRow
                key={r.definition.key}
                row={r}
                onSetTier={(t)   => setTier(r.definition.key, t, r)}
                onSetSort={(n)   => setSortOrder(r.definition.key, n, r)}
                onReset={()      => resetRow(r.definition.key)}
                disabled={busy || disabled}
              />)}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
            <strong>Primary</strong> actions render as buttons in the topbar.{' '}
            <strong>Menu</strong> actions collapse into the "Actions" overflow menu.{' '}
            Defaults come from the registry — only changed rows persist.
            Runtime gating (e.g. Schedule appears only when a work order is "To Be Scheduled")
            is enforced by the registry's availability predicate and is not overridable here.
          </div>
        </div>
      )}
    </div>
  )
}

function ActionRow({ row, onSetTier, onSetSort, onReset, disabled }) {
  const { definition, override, effectiveTier, effectiveSortOrder } = row
  const palette = actionColors(C, definition.color)
  const isOverridden = !!override
  const [localSort, setLocalSort] = useState(String(effectiveSortOrder))
  useEffect(() => { setLocalSort(String(effectiveSortOrder)) }, [effectiveSortOrder])

  const tierStyle = {
    width: '100%',
    padding: '5px 8px',
    fontSize: 12, fontFamily: 'inherit',
    border: `1px solid ${C.border}`, borderRadius: 4,
    background: C.card, color: C.textPrimary,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
  const numStyle = {
    width: 64,
    padding: '5px 6px',
    fontSize: 12, fontFamily: 'JetBrains Mono, monospace',
    border: `1px solid ${C.border}`, borderRadius: 4,
    background: C.card, color: C.textPrimary,
    textAlign: 'center',
    cursor: disabled ? 'not-allowed' : 'text',
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '32px 1fr 130px 90px 90px',
      gap: 12, padding: '8px 12px',
      borderBottom: `1px solid ${C.border}`,
      alignItems: 'center',
      background: isOverridden ? '#eef5fc' : 'transparent',
    }}>
      {/* icon */}
      <div style={{
        width: 28, height: 28, borderRadius: 5,
        background: palette.hoverBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon path={definition.icon} size={14} color={palette.fg} />
      </div>

      {/* label + key + applicability + override badge */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}>
          {definition.label}
          {isOverridden && (
            <span style={{
              fontSize: 9, fontWeight: 700,
              padding: '1px 5px', borderRadius: 3,
              background: '#fef3c7', color: '#1e466b',
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              Override
            </span>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
          {definition.key}
          {definition.applicableObjects === ALL_OBJECTS
            ? ' · all objects'
            : ` · ${(definition.applicableObjects || []).join(', ')}`}
        </div>
      </div>

      {/* tier */}
      <div>
        <select
          value={effectiveTier}
          onChange={e => onSetTier(e.target.value)}
          disabled={disabled}
          style={tierStyle}
        >
          <option value="primary">Primary</option>
          <option value="menu">Menu</option>
        </select>
      </div>

      {/* sort order */}
      <div style={{ textAlign: 'center' }}>
        <input
          type="number"
          value={localSort}
          onChange={e => setLocalSort(e.target.value)}
          onBlur={() => {
            const n = parseInt(localSort, 10)
            if (Number.isFinite(n) && n !== effectiveSortOrder) onSetSort(n)
            else setLocalSort(String(effectiveSortOrder))
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          disabled={disabled}
          style={numStyle}
        />
      </div>

      {/* reset */}
      <div style={{ textAlign: 'right' }}>
        <button
          onClick={onReset}
          disabled={disabled || !isOverridden}
          title={isOverridden ? 'Clear the override and revert to registry default' : 'No override to reset'}
          style={{
            ...buttonSmSecondaryStyle,
            opacity: (disabled || !isOverridden) ? 0.4 : 1,
            cursor: (disabled || !isOverridden) ? 'not-allowed' : 'pointer',
          }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
