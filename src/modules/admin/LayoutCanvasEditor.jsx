// =============================================================================
// src/modules/admin/LayoutCanvasEditor.jsx
//
// The new record page-layout builder. Three-pane (palette / canvas / inspector)
// on the SECTION model the live record renderer understands — Sections →
// COLUMNS → Fields (+ related lists / reports / etc.). A section's column count
// is shown for real: fields live in specific columns (left / center / right)
// and drag between/within them (dnd-kit multi-container). Each field carries a
// `column` (1-based); RecordDetail's FieldGroupWidget honors it.
//
// One shared DndContext drives three drag families, kept apart by id prefix
// and a family-filtered collision detection:
//   sec::<key>     — section cards (reorder sections; order persists as
//                    section_order, which also drives Related-tab card order)
//   wgt::<key>     — non-field-group widget tiles (related lists, galleries,
//                    reports…) draggable within and between sections;
//                    wzone::<sectionKey> is each section's widget drop zone
//   <field name>   — field tiles; <sectionKey>::col:N are column drop zones
//
// Related lists are first-class here: rename inline (widget_title is the card
// heading on the record's Related tab), reorder/move by drag, remove, and add
// new ones via RelatedListCanvasModal. Sections carry a Tab (Details/Related)
// select so field sections can be placed on either tab.
//
// Persists through the existing page-layout service (bulk soft-delete +
// recreate). No schema change.
// =============================================================================

import { useState, useEffect, useCallback, memo } from 'react'
import {
  DndContext, closestCorners, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { inputStyle } from '../../builder/inspectorControls'
import { loadLayoutForCanvas, saveLayoutFromCanvas } from '../../builder/adapters/pageLayoutAdapter'
import RelatedListCanvasModal from './widgets/RelatedListCanvasModal'

const WIDGET_LABELS = {
  field_group: 'Field Group', related_list: 'Related List', report: 'Report',
  file_gallery: 'File Gallery', conversation_panel: 'Conversation', status_path: 'Status Path',
  prtsn_history: 'Publish History', map: 'Map',
}

// The two standard tabs a section can live on. RecordDetail renders custom
// tab names too, so an unrecognized existing value is preserved as-is.
const SECTION_TABS = ['Details', 'Related']

function humanize(col, object) {
  let c = col
  if (object && c.startsWith(object.replace(/s$/, '') + '_')) c = c.slice(object.replace(/s$/, '').length + 1)
  c = c.replace(/_id$/, '').replace(/_/g, ' ').trim()
  return c.replace(/\b\w/g, m => m.toUpperCase())
}

// Ensure every field in a field group has a valid `column` (1..cols). Fields
// loaded without one are distributed round-robin so they don't pile into col 1.
function normalizeColumns(sections) {
  return sections.map(s => ({
    ...s,
    widgets: (s.widgets || []).map(w => {
      if (w.type !== 'field_group') return w
      const cols = s.columns || 2
      const fields = (w.config?.fields || []).map((f, i) => ({
        ...f,
        column: f.column && f.column >= 1 && f.column <= cols ? f.column : (i % cols) + 1,
      }))
      return { ...w, config: { ...w.config, fields } }
    }),
  }))
}

// Which drag family an id belongs to. Field ids are raw column names and
// column-zone ids ("<sectionKey>::col:N") — neither can collide with the
// "sec::" / "wgt::" / "wzone::" prefixes since section keys never contain "::".
function dragFamily(id) {
  const s = String(id)
  if (s.startsWith('sec::')) return 'section'
  if (s.startsWith('wgt::') || s.startsWith('wzone::')) return 'widget'
  return 'field'
}

export default function LayoutCanvasEditor({ layoutId, objectLabel, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [meta, setMeta]       = useState(null)
  const [columns, setColumns] = useState([])
  const [sections, setSections] = useState([])
  const [activeSection, setActiveSection] = useState(null)
  const [fieldSearch, setFieldSearch] = useState('')
  const [saving, setSaving]   = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [saveError, setSaveError] = useState(null)
  // { sectionKey, widgetKey|null } — related-list config modal target.
  const [relatedModal, setRelatedModal] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loadLayoutForCanvas(layoutId)
      .then(data => {
        if (cancelled) return
        if (!data) { setError(new Error('Layout not found.')); setLoading(false); return }
        setMeta(data.layout); setColumns(data.columns || [])
        setSections(normalizeColumns(data.sections))
        setActiveSection(data.sections[0]?.key || null)
        setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [layoutId])

  // ── Stable section/field ops (so memoized SectionCards don't re-render all) ─
  const patchSection = useCallback((key, patch) => {
    setSections(s => s.map(x => {
      if (x.key !== key) return x
      const next = { ...x, ...patch }
      // Re-clamp field columns if the column count shrank.
      if (patch.columns) {
        next.widgets = next.widgets.map(w => w.type !== 'field_group' ? w : {
          ...w, config: { ...w.config, fields: (w.config?.fields || []).map(f => ({ ...f, column: Math.min(f.column || 1, patch.columns) })) },
        })
      }
      return next
    }))
  }, [])
  const removeSection = useCallback((key) => setSections(s => s.filter(x => x.key !== key)), [])
  const setFieldGroupFields = useCallback((sectionKey, widgetKey, nextFields) => {
    setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
      ...sec, widgets: sec.widgets.map(w => w.key !== widgetKey ? w : { ...w, config: { ...w.config, fields: nextFields } }),
    }))
  }, [])
  const patchWidget = useCallback((sectionKey, widgetKey, patch) => {
    setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
      ...sec, widgets: (sec.widgets || []).map(w => w.key !== widgetKey ? w : { ...w, ...patch }),
    }))
  }, [])
  const removeWidget = useCallback((sectionKey, widgetKey) => {
    setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
      ...sec, widgets: (sec.widgets || []).filter(w => w.key !== widgetKey),
    }))
  }, [])
  const activate = useCallback((key) => setActiveSection(key), [])
  const openRelatedModal = useCallback((sectionKey, widgetKey = null) => {
    setRelatedModal({ sectionKey, widgetKey })
  }, [])

  // One shared drag context for the whole canvas. active.id decides the
  // family (section card / widget tile / field), and collision detection is
  // filtered to same-family droppables so a section drag never lands "inside"
  // a field column and vice versa.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const collisionDetection = useCallback((args) => {
    const family = dragFamily(args.active.id)
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(c => dragFamily(c.id) === family),
    })
  }, [])

  const onSectionDragEnd = (activeId, overId) => {
    setSections(prev => {
      const from = prev.findIndex(s => `sec::${s.key}` === activeId)
      const to   = prev.findIndex(s => `sec::${s.key}` === overId)
      if (from < 0 || to < 0) return prev
      return arrayMove(prev, from, to)
    })
  }

  const onWidgetDragEnd = (activeId, overId) => {
    const movedKey = activeId.slice('wgt::'.length)
    setSections(prev => {
      let moving = null
      for (const sec of prev) {
        const w = (sec.widgets || []).find(x => x.key === movedKey)
        if (w) { moving = w; break }
      }
      if (!moving || moving.type === 'field_group') return prev
      // Resolve the target section (+ the tile to insert before, if any).
      let tgtSecKey = null, overWidgetKey = null
      if (overId.startsWith('wzone::')) {
        tgtSecKey = overId.slice('wzone::'.length)
      } else {
        overWidgetKey = overId.slice('wgt::'.length)
        for (const sec of prev) {
          if ((sec.widgets || []).some(x => x.key === overWidgetKey)) { tgtSecKey = sec.key; break }
        }
      }
      if (!tgtSecKey) return prev
      return prev.map(sec => {
        let widgets = (sec.widgets || []).filter(x => x.key !== movedKey)
        if (sec.key === tgtSecKey) {
          let insertAt = widgets.length
          if (overWidgetKey) {
            const i = widgets.findIndex(x => x.key === overWidgetKey)
            if (i >= 0) insertAt = i
          }
          widgets = [...widgets.slice(0, insertAt), moving, ...widgets.slice(insertAt)]
        }
        return { ...sec, widgets }
      })
    })
  }

  const onFieldDragEnd = (activeName, overId) => {
    setSections(prev => {
      // Locate the field being moved (it lives in exactly one section).
      let srcField = null
      for (const sec of prev) {
        const fg = (sec.widgets || []).find(w => w.type === 'field_group')
        const f = fg?.config?.fields?.find(x => x.name === activeName)
        if (f) { srcField = f; break }
      }
      if (!srcField) return prev
      // Resolve the drop target's section + column.
      let tgtSecKey = null, tgtCol = 1, overName = null
      if (overId.includes('::col:')) {
        const [secKey, colPart] = overId.split('::col:')
        tgtSecKey = secKey; tgtCol = Number(colPart) || 1
      } else {
        overName = overId
        for (const sec of prev) {
          const fg = (sec.widgets || []).find(w => w.type === 'field_group')
          const f = fg?.config?.fields?.find(x => x.name === overName)
          if (f) { tgtSecKey = sec.key; tgtCol = f.column || 1; break }
        }
      }
      if (!tgtSecKey) return prev
      const moved = { ...srcField, column: tgtCol }
      return prev.map(sec => {
        const fg = (sec.widgets || []).find(w => w.type === 'field_group')
        if (!fg) return sec
        // Remove the field from wherever it currently is...
        let fields = (fg.config?.fields || []).filter(f => f.name !== activeName)
        // ...and insert it into the target section at the right spot.
        if (sec.key === tgtSecKey) {
          let insertAt
          if (overName) {
            insertAt = fields.findIndex(f => f.name === overName)
            if (insertAt < 0) insertAt = fields.length
          } else {
            let last = -1
            fields.forEach((f, i) => { if ((f.column || 1) === tgtCol) last = i })
            insertAt = last + 1
          }
          fields = [...fields.slice(0, insertAt), moved, ...fields.slice(insertAt)]
        }
        return { ...sec, widgets: sec.widgets.map(w => w === fg ? { ...w, config: { ...w.config, fields } } : w) }
      })
    })
  }

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const family = dragFamily(activeId)
    if (family === 'section')      onSectionDragEnd(activeId, overId)
    else if (family === 'widget')  onWidgetDragEnd(activeId, overId)
    else                           onFieldDragEnd(activeId, overId)
  }

  // position 'start' inserts the new section at the top of the layout (the
  // top button), 'end' appends it after the last section (the bottom button).
  const addSection = (position = 'end') => {
    const key = `sec-new-${Date.now()}`
    const section = { key, label: 'New Section', columns: 2, tab: 'Details', isCollapsible: false, isCollapsedByDefault: false, placement: 'main',
      widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [] } }] }
    setSections(s => position === 'start' ? [section, ...s] : [...s, section])
    setActiveSection(key)
  }

  const addField = (sectionKey, col) => {
    setSections(s => s.map(sec => {
      if (sec.key !== sectionKey) return sec
      const widgets = sec.widgets || []
      const fg = widgets.find(w => w.type === 'field_group')
      const field = { name: col.name, label: humanize(col.name, meta.object), column: 1 }
      if (!fg) {
        return { ...sec, widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [field] } }, ...widgets] }
      }
      return { ...sec, widgets: widgets.map(w => w === fg ? { ...w, config: { ...w.config, fields: [...(w.config?.fields || []), field] } } : w) }
    }))
  }

  const applyRelatedModal = ({ title, config }) => {
    const { sectionKey, widgetKey } = relatedModal
    if (widgetKey) {
      patchWidget(sectionKey, widgetKey, { title, config })
    } else {
      setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
        ...sec,
        widgets: [...(sec.widgets || []), {
          key: `w-new-${Date.now()}`, type: 'related_list', title,
          column: 1, size: 'medium', isRequired: false, config,
        }],
      }))
    }
    setRelatedModal(null)
  }

  const handleSave = async () => {
    setSaving(true); setSaveError(null)
    try { await saveLayoutFromCanvas({ layoutId, sections }); setSavedAt(new Date()) }
    catch (err) { setSaveError(err) }
    finally { setSaving(false) }
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onBack} />

  const placedFieldNames = new Set(
    sections.flatMap(s => (s.widgets || []).filter(w => w.type === 'field_group').flatMap(w => (w.config?.fields || []).map(f => f.name)))
  )
  const unplaced = columns.filter(c => !placedFieldNames.has(c.name))
  // Filter the palette by the search box — match on both the humanized label
  // and the raw API name so a user can find a field either way without
  // scrolling the (often long) field list.
  const fieldQuery = fieldSearch.trim().toLowerCase()
  const available = fieldQuery
    ? unplaced.filter(c =>
        humanize(c.name, meta.object).toLowerCase().includes(fieldQuery) ||
        c.name.toLowerCase().includes(fieldQuery))
    : unplaced

  const modalWidget = relatedModal?.widgetKey
    ? sections.find(s => s.key === relatedModal.sectionKey)?.widgets?.find(w => w.key === relatedModal.widgetKey)
    : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
      <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div onClick={onBack} style={{ fontSize: 11, color: C.textMuted, cursor: 'pointer' }}>‹ {objectLabel} layouts</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary }}>{meta.name}</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>{meta.object}{meta.recordTypeLabel ? ` · ${meta.recordTypeLabel}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saveError && <span style={{ fontSize: 11, color: C.sky, maxWidth: 320, textAlign: 'right' }}>{saveError.message}</span>}
          {savedAt && !saveError && <span style={{ fontSize: 11, color: C.textMuted }}>Saved {savedAt.toLocaleTimeString()}</span>}
          <button onClick={onBack} style={btnSecondary()}>Close</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary(saving)}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Fields</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Click to add to the selected section (column 1; drag to place).</div>
            <input
              value={fieldSearch}
              onChange={e => setFieldSearch(e.target.value)}
              placeholder="Search fields…"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '6px 9px', fontSize: 12,
                border: `1px solid ${C.border}`, borderRadius: 5, background: C.card, color: C.textPrimary, outline: 'none' }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {available.length === 0 ? <div style={{ fontSize: 12, color: C.textMuted, padding: 6 }}>{fieldQuery ? 'No fields match your search.' : 'All fields placed.'}</div>
              : available.map(c => (
                <button key={c.name} onClick={() => activeSection && addField(activeSection, c)} disabled={!activeSection}
                  title={activeSection ? `Add ${c.name}` : 'Select a section first'}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px', marginBottom: 5, fontSize: 12.5,
                    background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, cursor: activeSection ? 'pointer' : 'default', color: C.textPrimary }}>
                  {humanize(c.name, meta.object)}
                  <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6, fontFamily: 'JetBrains Mono, monospace' }}>{c.name}</span>
                </button>
              ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <button onClick={() => addSection('start')} style={{ ...addSectionBtn(), marginBottom: 14 }}>
            + Add Section
          </button>
          <DndContext sensors={dndSensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
            <SortableContext items={sections.map(s => `sec::${s.key}`)} strategy={verticalListSortingStrategy}>
              {sections.map(sec => (
                <SectionCard key={sec.key} section={sec} object={meta.object} active={activeSection === sec.key}
                  onActivate={activate} onPatch={patchSection} onRemove={removeSection} onSetFields={setFieldGroupFields}
                  onPatchWidget={patchWidget} onRemoveWidget={removeWidget} onOpenRelatedModal={openRelatedModal} />
              ))}
            </SortableContext>
          </DndContext>
          <button onClick={() => addSection('end')} style={addSectionBtn()}>
            + Add Section
          </button>
        </div>
      </div>

      {relatedModal && (
        <RelatedListCanvasModal
          objectName={meta.object}
          initial={modalWidget ? { title: modalWidget.title, config: modalWidget.config || {} } : null}
          onClose={() => setRelatedModal(null)}
          onApply={applyRelatedModal}
        />
      )}
    </div>
  )
}

// memo: only the edited section (or the two whose `active` flips) re-renders —
// keeps the drag contexts from re-mounting on every keystroke (the sluggishness).
const SectionCard = memo(function SectionCard({
  section, object, active,
  onActivate, onPatch, onRemove, onSetFields,
  onPatchWidget, onRemoveWidget, onOpenRelatedModal,
}) {
  const fg = (section.widgets || []).find(w => w.type === 'field_group')
  const others = (section.widgets || []).filter(w => w.type !== 'field_group')
  const cols = section.columns || 2
  const tab = section.tab || 'Details'
  const tabOptions = SECTION_TABS.includes(tab) ? SECTION_TABS : [...SECTION_TABS, tab]

  // The whole card is sortable; only the ⠿ handle activates the drag so the
  // label input / selects / nested field drags keep working normally.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `sec::${section.key}` })

  return (
    <div ref={setNodeRef} onMouseDown={() => onActivate(section.key)} style={{
      transform: CSS.Transform.toString(transform), transition,
      opacity: isDragging ? 0.55 : 1,
      background: C.card, border: `1px solid ${active ? C.emerald : C.border}`, borderRadius: 8,
      marginBottom: 14, overflow: 'hidden', boxShadow: active ? `0 0 0 1px ${C.emerald}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
        <span {...attributes} {...listeners} title="Drag to reorder sections"
          style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>⠿</span>
        <input value={section.label} onChange={e => onPatch(section.key, { label: e.target.value })}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary, border: 'none', background: 'transparent', outline: 'none' }} />
        <label style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
          Tab
          <select value={tab} onChange={e => onPatch(section.key, { tab: e.target.value })}
            title="Which record-page tab this section's fields render on"
            style={{ ...inputStyle(), width: 'auto', padding: '3px 6px', fontSize: 12 }}>
            {tabOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
          Columns
          <select value={cols} onChange={e => onPatch(section.key, { columns: Number(e.target.value) })}
            style={{ ...inputStyle(), width: 'auto', padding: '3px 6px', fontSize: 12 }}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <button onClick={() => onRemove(section.key)} title="Remove section" style={miniBtn()}>×</button>
      </div>
      <div style={{ padding: 12 }}>
        {fg ? (
          <MultiColumnFields
            cols={cols}
            fields={fg.config?.fields || []}
            object={object}
            sectionKey={section.key}
            onChange={(next) => onSetFields(section.key, fg.key, next)}
          />
        ) : null}
        <WidgetZone
          sectionKey={section.key}
          widgets={others}
          onPatchWidget={onPatchWidget}
          onRemoveWidget={onRemoveWidget}
          onOpenRelatedModal={onOpenRelatedModal}
        />
      </div>
    </div>
  )
})

// ─── Widget tiles (related lists, galleries, reports…) ───────────────────────
// Each section's non-field-group widgets live in a shared-context drop zone
// ("wzone::<sectionKey>") so a related-list card can be dragged within its
// section or into another one — the resulting array order persists as
// widget_position, which is exactly the order the Related tab renders cards.
function WidgetZone({ sectionKey, widgets, onPatchWidget, onRemoveWidget, onOpenRelatedModal }) {
  const { setNodeRef, isOver } = useDroppable({ id: `wzone::${sectionKey}` })
  return (
    <div ref={setNodeRef} style={{
      marginTop: 8, padding: 6, borderRadius: 6,
      border: `1px dashed ${isOver ? C.emerald : 'transparent'}`,
      background: isOver ? '#f0faf5' : 'transparent',
    }}>
      <SortableContext items={widgets.map(w => `wgt::${w.key}`)} strategy={verticalListSortingStrategy}>
        {widgets.map(w => (
          <WidgetTile key={w.key} widget={w} sectionKey={sectionKey}
            onPatch={onPatchWidget} onRemove={onRemoveWidget} onOpenRelatedModal={onOpenRelatedModal} />
        ))}
      </SortableContext>
      <button onClick={() => onOpenRelatedModal(sectionKey, null)}
        style={{ width: '100%', padding: '7px', fontSize: 12, fontWeight: 500, background: 'transparent',
          color: C.emeraldMid, border: `1px dashed ${C.border}`, borderRadius: 6, cursor: 'pointer' }}>
        + Add Related List
      </button>
    </div>
  )
}

function WidgetTile({ widget, sectionKey, onPatch, onRemove, onOpenRelatedModal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `wgt::${widget.key}` })
  return (
    <div ref={setNodeRef} style={{
      transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6,
      background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6,
    }}>
      <span {...attributes} {...listeners} title="Drag to reorder (within or across sections)"
        style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none', flexShrink: 0 }}>⠿</span>
      <input
        value={widget.title || ''}
        onChange={e => onPatch(sectionKey, widget.key, { title: e.target.value })}
        placeholder={WIDGET_LABELS[widget.type] || widget.type}
        title="Card title shown on the record page"
        style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, color: C.textPrimary,
          border: 'none', background: 'transparent', outline: 'none' }}
      />
      <span style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>
        {WIDGET_LABELS[widget.type] || widget.type}
      </span>
      {widget.type === 'related_list' && (
        <button onClick={() => onOpenRelatedModal(sectionKey, widget.key)} title="Configure table, FK, and columns"
          style={{ padding: '3px 8px', fontSize: 11, fontWeight: 500, background: C.card, color: C.textSecondary,
            border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }}>
          Configure
        </button>
      )}
      <button onClick={() => onRemove(sectionKey, widget.key)} title="Remove widget" style={miniBtn()}>×</button>
    </div>
  )
}

// ─── Multi-column field placement (dnd-kit multi-container) ──────────────────
// No DndContext here — the whole canvas shares ONE context (in LayoutCanvasEditor)
// so a field can be dragged across sections, not just within this one. This just
// lays out the columns as section-scoped drop zones. `removeField` (the × button)
// still edits this section's fields directly via onChange.
function MultiColumnFields({ cols, fields, object, onChange, sectionKey }) {
  const colFields = (c) => fields.filter(f => (f.column || 1) === c)
  const removeField = (name) => onChange(fields.filter(f => f.name !== name))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {Array.from({ length: cols }, (_, i) => i + 1).map(c => (
        <ColumnZone key={c} sectionKey={sectionKey} col={c} fields={colFields(c)} object={object} onRemoveField={removeField} />
      ))}
    </div>
  )
}

function ColumnZone({ sectionKey, col, fields, object, onRemoveField }) {
  // Section-scoped id so the shared drag handler knows which section + column a
  // field was dropped into ("<sectionKey>::col:<n>").
  const { setNodeRef, isOver } = useDroppable({ id: `${sectionKey}::col:${col}` })
  return (
    <div ref={setNodeRef} style={{
      minHeight: 56, padding: 6, borderRadius: 6,
      border: `1px dashed ${isOver ? C.emerald : C.border}`, background: isOver ? '#f0faf5' : C.cardSecondary,
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, paddingLeft: 2 }}>
        {col === 1 ? 'Left' : col === 2 ? 'Center' : col === 3 ? 'Right' : `Col ${col}`}
      </div>
      <SortableContext items={fields.map(f => f.name)} strategy={verticalListSortingStrategy}>
        {fields.length === 0 && <div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', padding: '6px 2px' }}>Drop fields here</div>}
        {fields.map(f => <FieldTile key={f.name} field={f} object={object} onRemove={() => onRemoveField(f.name)} />)}
      </SortableContext>
    </div>
  )
}

function FieldTile({ field, object, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.name })
  return (
    <div ref={setNodeRef} style={{
      transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1,
      display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', marginBottom: 5,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
    }}>
      <span {...attributes} {...listeners} title="Drag" style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none' }}>⠿</span>
      <span style={{ flex: 1, fontSize: 12, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{field.label || humanize(field.name, object)}</span>
      <button onClick={onRemove} style={miniBtn()}>×</button>
    </div>
  )
}

function addSectionBtn() {
  return { width: '100%', padding: '10px', fontSize: 13, fontWeight: 500, background: C.card, color: C.emeraldMid, border: `1px dashed ${C.borderDark}`, borderRadius: 8, cursor: 'pointer' }
}

function btnPrimary(disabled) {
  return { padding: '8px 16px', fontSize: 13, fontWeight: 500, background: disabled ? C.borderDark : C.emerald, color: '#fff', border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer' }
}
function btnSecondary() {
  return { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: C.card, color: C.textPrimary, border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer' }
}
function miniBtn() {
  return { width: 22, height: 22, fontSize: 13, fontWeight: 600, background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }
}
