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
// new ones via RelatedListCanvasModal.
//
// TABS ARE FIRST-CLASS (Nicholas, 2026-07-26): the editor shows the record
// page's tabs across the top of the canvas — Details, Related, any custom
// tabs — and the canvas shows ONLY the active tab's sections, exactly like
// the live record page. Right-sidebar (placement='right') sections render in
// a live always-visible rail beside the canvas (they show on every record
// tab, so the editor mirrors that in real time). Tabs can be created,
// renamed, and deleted (custom tabs only; Details/Related are standard).
// A section moves between tabs by dragging its card onto a tab in the bar,
// or into/out of the rail — there is no per-section Tab dropdown anymore.
// Tabs persist through their sections' `tab` value (no schema change), so a
// tab with no sections is editor-local until a section is added to it.
// Custom tabs sort alphabetically after Details/Related/Activity — same as
// the renderer (buildOrderedTabs in RecordDetail).
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
import { describeObject } from '../../data/adminService'
import RelatedListCanvasModal from './widgets/RelatedListCanvasModal'

const WIDGET_LABELS = {
  field_group: 'Field Group', related_list: 'Related List', report: 'Report',
  file_gallery: 'File Gallery', conversation_panel: 'Conversation', status_path: 'Status Path',
  prtsn_history: 'Publish History', map: 'Map',
}

// The two standard record-page tabs. Custom tab names are supported by the
// renderer and appear after these, alphabetically. 'Activity' is added
// automatically by the record page and can't hold layout sections here.
const STANDARD_TABS = ['Details', 'Related']
const RESERVED_TAB_NAMES = new Set(['details', 'related', 'activity'])

// Drop-target id for the Salesforce-style utility rail: sections with
// placement='right' render on EVERY tab, so the editor shows them in a live
// always-visible rail beside the canvas (WYSIWYG) — never inside a tab.
const RIGHT_TAB = '__right_sidebar__'

// Card widgets (related lists, galleries, conversation panels, reports,
// publish history). Since 2026-07-26 they render exactly where they're
// placed — inside their section, on that section's tab (or in the right
// rail) — so the only render hint a tile needs is the right-sidebar one.
const CARD_WIDGET_TYPES = new Set(['related_list', 'file_gallery', 'conversation_panel', 'report', 'prtsn_history'])

function humanize(col, object) {
  let c = col
  if (object && c.startsWith(object.replace(/s$/, '') + '_')) c = c.slice(object.replace(/s$/, '').length + 1)
  c = c.replace(/_id$/, '').replace(/_/g, ' ').trim()
  return c.replace(/\b\w/g, m => m.toUpperCase())
}

// Renderer-facing type for a parent-table column (cross-object fields).
// Mirrors RelatedListCanvasModal's relatedColumnType.
function relatedFieldColumnType(col) {
  const dt = col.data_type || ''
  if (col.is_foreign_key && dt === 'uuid') {
    return col.references_table === 'picklist_values' ? 'picklist' : 'lookup'
  }
  if (dt === 'date') return 'date'
  if (dt === 'timestamp with time zone' || dt === 'timestamp without time zone') return 'datetime'
  if (dt === 'boolean') return 'boolean'
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(dt)) return 'number'
  return 'text'
}

// System plumbing columns hidden from the related-fields drill-down.
const RELATED_HIDDEN_COLUMNS = /(^id$|^created_at$|^updated_at$|_created_at$|_updated_at$|_created_by$|_updated_by$|is_deleted|_deleted_at$|_deleted_by$|deletion_reason|^auth_user_id$)/

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
// "sec::" / "wgt::" / "wzone::" / "tabdrop::" prefixes since section keys
// never contain "::". Tab pills ("tabdrop::<tab>") are drop targets for the
// SECTION family: dropping a section card on a pill moves it to that tab.
function dragFamily(id) {
  const s = String(id)
  if (s.startsWith('sec::') || s.startsWith('tabdrop::')) return 'section'
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
  // Active canvas tab ('Details' | 'Related' | custom name | RIGHT_TAB).
  const [activeTab, setActiveTab] = useState('Details')
  // Custom tab names known to the editor. Tabs persist through their
  // sections' `tab` value, so this list keeps a tab visible while it's
  // empty (freshly created, or its last section was moved/removed).
  const [customTabs, setCustomTabs] = useState([])
  // Custom tab name pending delete confirmation, or null.
  const [deleteTab, setDeleteTab] = useState(null)
  const [fieldSearch, setFieldSearch] = useState('')
  const [saving, setSaving]   = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [saveError, setSaveError] = useState(null)
  // { sectionKey, widgetKey|null } — related-list config modal target.
  const [relatedModal, setRelatedModal] = useState(null)
  // Cross-object field drill-down (Salesforce-style): every FK on this
  // object is a group the admin can expand to place READ-ONLY fields from
  // the referenced record (e.g. property HUD fields on an opportunity).
  // relatedFkGroups: [{ fk, table, label }]; parentCols: fk -> 'loading' |
  // column rows; expandedFks: Set of expanded fk names.
  const [relatedFkGroups, setRelatedFkGroups] = useState([])
  const [parentCols, setParentCols] = useState({})
  const [expandedFks, setExpandedFks] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loadLayoutForCanvas(layoutId)
      .then(data => {
        if (cancelled) return
        if (!data) { setError(new Error('Layout not found.')); setLoading(false); return }
        setMeta(data.layout); setColumns(data.columns || [])
        const normalized = normalizeColumns(data.sections)
        setSections(normalized)
        setCustomTabs([...new Set(normalized.map(s => s.tab || 'Details'))]
          .filter(t => !RESERVED_TAB_NAMES.has(t.toLowerCase())))
        setActiveTab('Details')
        setActiveSection(normalized.find(s => (s.placement || 'main') !== 'right' && (s.tab || 'Details') === 'Details')?.key || null)
        setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [layoutId])

  // Outgoing FKs → the related-object groups in the palette. Picklist-value
  // FKs are excluded (those are picklist fields, not drill-down parents).
  useEffect(() => {
    if (!meta?.object) return
    let cancelled = false
    describeObject(meta.object)
      .then(cols => {
        if (cancelled) return
        setRelatedFkGroups((cols || [])
          .filter(c => c.is_foreign_key && c.references_table && c.references_table !== 'picklist_values')
          .filter(c => !/(_created_by|_updated_by|_deleted_by)$/.test(c.column_name))
          .map(c => ({ fk: c.column_name, table: c.references_table, label: humanize(c.column_name, meta.object) }))
          .sort((a, b) => a.label.localeCompare(b.label)))
      })
      .catch(() => { /* palette group just doesn't appear */ })
    return () => { cancelled = true }
  }, [meta?.object])

  const toggleFkGroup = (fk, table) => {
    setExpandedFks(prev => {
      const next = new Set(prev)
      if (next.has(fk)) { next.delete(fk); return next }
      next.add(fk)
      return next
    })
    if (!parentCols[fk]) {
      setParentCols(prev => ({ ...prev, [fk]: 'loading' }))
      describeObject(table)
        .then(cols => setParentCols(prev => ({ ...prev, [fk]: cols || [] })))
        .catch(() => setParentCols(prev => ({ ...prev, [fk]: [] })))
    }
  }

  // Place a cross-object field: '<fk>.<column>', type related_field, always
  // read-only on the record page. Lookup-typed parent columns get display
  // wiring (lookup_table + its first *_name column) so cells show names,
  // not UUIDs.
  const addRelatedField = async (group, col) => {
    if (!activeSection) return
    const name = `${group.fk}.${col.column_name}`
    const columnType = relatedFieldColumnType(col)
    const related = { fk_column: group.fk, table: group.table, column: col.column_name, column_type: columnType }
    if (columnType === 'lookup') {
      const refCols = await describeObject(col.references_table).catch(() => [])
      const displayField = (refCols || []).find(c => /_name$/.test(c.column_name))?.column_name
        || (refCols || []).find(c => c.column_name === 'name')?.column_name
      if (displayField) {
        related.lookup_table = col.references_table
        related.lookup_field = displayField
      } else {
        related.column_type = 'text'
      }
    }
    const field = { name, type: 'related_field', label: `${group.label} · ${humanize(col.column_name, group.table)}`, column: 1, related }
    setSections(s => s.map(sec => {
      if (sec.key !== activeSection) return sec
      const widgets = sec.widgets || []
      const fg = widgets.find(w => w.type === 'field_group')
      if (!fg) {
        return { ...sec, widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [field] } }, ...widgets] }
      }
      return { ...sec, widgets: widgets.map(w => w === fg ? { ...w, config: { ...w.config, fields: [...(w.config?.fields || []), field] } } : w) }
    }))
  }

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

  // ── Tab model ──────────────────────────────────────────────────────────────
  // Does a section belong on tab `t`? Right-rail sections never belong to a
  // tab — they render in the always-visible rail beside the canvas.
  const sectionInTab = (s, t) => t === RIGHT_TAB
    ? (s.placement || 'main') === 'right'
    : (s.placement || 'main') !== 'right' && (s.tab || 'Details') === t

  // Custom tabs = every tab named by a section plus editor-created empties,
  // alphabetical after the standard two — the renderer's exact order.
  const customTabNames = [...new Set([
    ...sections.map(s => s.tab || 'Details'),
    ...customTabs,
  ])].filter(t => !RESERVED_TAB_NAMES.has(t.toLowerCase())).sort((a, b) => a.localeCompare(b))
  const tabList = [...STANDARD_TABS, ...customTabNames]
  const tabSectionCount = (t) => sections.filter(s => sectionInTab(s, t)).length

  const selectTab = (t) => {
    setActiveTab(t)
    setActiveSection(sections.find(s => sectionInTab(s, t))?.key || null)
  }

  // Validate a new/renamed tab name against reserved + existing names.
  const isTabNameFree = (name) => {
    const n = name.trim().toLowerCase()
    if (!n || RESERVED_TAB_NAMES.has(n)) return false
    return !tabList.some(t => t.toLowerCase() === n)
  }

  const addTab = (rawName) => {
    const name = rawName.trim()
    if (!isTabNameFree(name)) return false
    setCustomTabs(prev => [...prev, name])
    setActiveTab(name)
    setActiveSection(null)
    return true
  }

  const renameTab = (from, rawName) => {
    const name = rawName.trim()
    if (name === from) return true
    if (!isTabNameFree(name)) return false
    setSections(prev => prev.map(s => (s.tab || 'Details') === from ? { ...s, tab: name } : s))
    setCustomTabs(prev => [...prev.filter(t => t !== from), name])
    setActiveTab(prev => prev === from ? name : prev)
    return true
  }

  // Delete a custom tab: its sections (any placement) move to Details.
  const confirmDeleteTab = (name) => {
    setSections(prev => prev.map(s => (s.tab || 'Details') === name ? { ...s, tab: 'Details' } : s))
    setCustomTabs(prev => prev.filter(t => t !== name))
    setActiveTab(prev => prev === name ? 'Details' : prev)
    setDeleteTab(null)
  }

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
    // Dropped on a tab pill → move the section to that tab (or the right rail).
    if (overId.startsWith('tabdrop::')) {
      const target = overId.slice('tabdrop::'.length)
      const key = activeId.slice('sec::'.length)
      setSections(prev => prev.map(s => s.key !== key ? s : (
        target === RIGHT_TAB
          ? { ...s, placement: 'right' }
          : { ...s, placement: 'main', tab: target }
      )))
      return
    }
    // Dropped on another section card — reorder, or move across containers
    // (canvas ↔ rail). Only the active tab's sections + the rail are visible,
    // so positions map straight onto the FULL array by global index — global
    // array order is what persists as section_order (and drives Related-tab
    // card order), so other tabs' sections keep their slots. A cross-container
    // drop adopts the target's placement (and tab, when landing in the main
    // canvas) before the move.
    setSections(prev => {
      const srcIdx = prev.findIndex(s => `sec::${s.key}` === activeId)
      const tgtIdx = prev.findIndex(s => `sec::${s.key}` === overId)
      if (srcIdx < 0 || tgtIdx < 0) return prev
      const src = prev[srcIdx], tgt = prev[tgtIdx]
      const srcRight = (src.placement || 'main') === 'right'
      const tgtRight = (tgt.placement || 'main') === 'right'
      let arr = prev
      if (srcRight !== tgtRight) {
        const patched = tgtRight
          ? { ...src, placement: 'right' }
          : { ...src, placement: 'main', tab: tgt.tab || 'Details' }
        arr = prev.map((s, i) => i === srcIdx ? patched : s)
      }
      return arrayMove(arr, srcIdx, tgtIdx)
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

  // New sections land on the ACTIVE tab — 'start' before its first section,
  // 'end' after its last — or in the right rail ('rail'). Insert positions
  // are container-local but resolved against the full array so other tabs'
  // section_order is untouched.
  const addSection = (position = 'end') => {
    const key = `sec-new-${Date.now()}`
    const onRail = position === 'rail'
    const container = onRail ? RIGHT_TAB : activeTab
    const section = { key, label: 'New Section', columns: onRail ? 1 : 2, tab: onRail ? 'Details' : activeTab,
      isCollapsible: false, isCollapsedByDefault: false, placement: onRail ? 'right' : 'main',
      widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [] } }] }
    setSections(prev => {
      const idxs = prev.map((s, i) => sectionInTab(s, container) ? i : -1).filter(i => i >= 0)
      const insertAt = position === 'start'
        ? (idxs.length ? idxs[0] : prev.length)
        : (idxs.length ? idxs[idxs.length - 1] + 1 : prev.length)
      return [...prev.slice(0, insertAt), section, ...prev.slice(insertAt)]
    })
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

  // The canvas shows ONLY the active tab's sections — the whole point of the
  // tab bar: what you see is exactly what that tab renders on the record page.
  // Right-rail sections render in the always-visible rail beside the canvas.
  const visibleSections = sections.filter(s => sectionInTab(s, activeTab))
  const railSections = sections.filter(s => (s.placement || 'main') === 'right')
  const deleteTabSectionCount = deleteTab ? sections.filter(s => (s.tab || 'Details') === deleteTab).length : 0

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

            {/* Related-object drill-down — Salesforce-style cross-object
                fields. Expand a lookup to place read-only fields from the
                record it points at. */}
            {relatedFkGroups.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 2px 6px' }}>
                  Related Object Fields
                </div>
                <div style={{ fontSize: 10.5, color: C.textMuted, padding: '0 2px 8px', lineHeight: 1.45 }}>
                  Read-only fields from records this object looks up to.
                </div>
                {relatedFkGroups.map(g => {
                  const open = expandedFks.has(g.fk)
                  const cols = parentCols[g.fk]
                  const list = Array.isArray(cols)
                    ? cols.filter(c =>
                        !RELATED_HIDDEN_COLUMNS.test(c.column_name) && !c.is_primary_key &&
                        !placedFieldNames.has(`${g.fk}.${c.column_name}`) &&
                        (!fieldQuery ||
                          c.column_name.toLowerCase().includes(fieldQuery) ||
                          humanize(c.column_name, g.table).toLowerCase().includes(fieldQuery)))
                    : null
                  return (
                    <div key={g.fk} style={{ marginBottom: 6 }}>
                      <button onClick={() => toggleFkGroup(g.fk, g.table)}
                        title={`Fields from the ${g.table} record referenced by ${g.fk}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '7px 9px',
                          fontSize: 12.5, fontWeight: 600, background: C.cardSecondary, border: `1px solid ${C.borderDark}`,
                          borderRadius: 6, cursor: 'pointer', color: C.textPrimary }}>
                        <span style={{ fontSize: 10, color: C.textMuted, width: 10, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                        <span style={{ fontSize: 9.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>{g.table}</span>
                      </button>
                      {open && (
                        <div style={{ padding: '5px 0 2px 14px' }}>
                          {cols === 'loading' && <div style={{ fontSize: 11.5, color: C.textMuted, padding: 4 }}>Loading fields…</div>}
                          {Array.isArray(cols) && list.length === 0 && (
                            <div style={{ fontSize: 11.5, color: C.textMuted, padding: 4 }}>
                              {fieldQuery ? 'No fields match your search.' : 'All fields placed.'}
                            </div>
                          )}
                          {Array.isArray(cols) && list.map(c => (
                            <button key={c.column_name} onClick={() => addRelatedField(g, c)} disabled={!activeSection}
                              title={activeSection ? `Add ${g.fk}.${c.column_name} (read-only)` : 'Select a section first'}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', marginBottom: 4, fontSize: 12,
                                background: C.card, border: `1px dashed ${C.border}`, borderRadius: 6,
                                cursor: activeSection ? 'pointer' : 'default', color: C.textPrimary }}>
                              {humanize(c.column_name, g.table)}
                              <span style={{ fontSize: 9.5, color: C.textMuted, marginLeft: 5, fontFamily: 'JetBrains Mono, monospace' }}>{c.column_name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DndContext sensors={dndSensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
            <TabBar
              tabList={tabList}
              activeTab={activeTab}
              tabSectionCount={tabSectionCount}
              onSelect={selectTab}
              onAdd={addTab}
              onRename={renameTab}
              onRequestDelete={setDeleteTab}
            />
            {/* Main canvas (active tab) + the live right-sidebar rail. The rail
                mirrors the record page: always visible, whatever tab is active. */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {visibleSections.length === 0 ? (
                  <div style={{ background: C.card, border: `1px dashed ${C.borderDark}`, borderRadius: 8, padding: '28px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>
                      No sections on the {activeTab} tab yet.
                    </div>
                    <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 14 }}>
                      Add a section here, or drag a section card from another tab onto this tab. A tab with no sections is not saved to the record page.
                    </div>
                    <button onClick={() => addSection('end')} style={{ ...addSectionBtn(), width: 'auto', padding: '10px 22px' }}>
                      + Add Section
                    </button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => addSection('start')} style={{ ...addSectionBtn(), marginBottom: 14 }}>
                      + Add Section
                    </button>
                    <SortableContext items={visibleSections.map(s => `sec::${s.key}`)} strategy={verticalListSortingStrategy}>
                      {visibleSections.map(sec => (
                        <SectionCard key={sec.key} section={sec} object={meta.object} active={activeSection === sec.key}
                          onActivate={activate} onPatch={patchSection} onRemove={removeSection} onSetFields={setFieldGroupFields}
                          onPatchWidget={patchWidget} onRemoveWidget={removeWidget} onOpenRelatedModal={openRelatedModal} />
                      ))}
                    </SortableContext>
                    <button onClick={() => addSection('end')} style={addSectionBtn()}>
                      + Add Section
                    </button>
                  </>
                )}
              </div>
              <RightRail count={railSections.length} onAdd={() => addSection('rail')}>
                <SortableContext items={railSections.map(s => `sec::${s.key}`)} strategy={verticalListSortingStrategy}>
                  {railSections.map(sec => (
                    <SectionCard key={sec.key} section={sec} object={meta.object} active={activeSection === sec.key}
                      onActivate={activate} onPatch={patchSection} onRemove={removeSection} onSetFields={setFieldGroupFields}
                      onPatchWidget={patchWidget} onRemoveWidget={removeWidget} onOpenRelatedModal={openRelatedModal} />
                  ))}
                </SortableContext>
              </RightRail>
            </div>
          </DndContext>
        </div>
      </div>

      {deleteTab && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(13,26,46,0.4)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: C.card, borderRadius: 10, padding: 24, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>Delete tab "{deleteTab}"?</div>
            <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 18, lineHeight: 1.5 }}>
              {deleteTabSectionCount > 0
                ? `Its ${deleteTabSectionCount} section${deleteTabSectionCount === 1 ? '' : 's'} will move to the Details tab. Nothing is removed from the layout.`
                : 'The tab is empty — nothing else changes.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDeleteTab(null)} style={btnSecondary()}>Cancel</button>
              <button onClick={() => confirmDeleteTab(deleteTab)}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 500, background: C.sky, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                Delete Tab
              </button>
            </div>
          </div>
        </div>
      )}

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

// ─── Tab bar ─────────────────────────────────────────────────────────────────
// The record page's tabs, editable in place: Details and Related are standard
// (always present, not renamable); custom tabs rename (pencil) and delete (×)
// while active; "+ New Tab" creates one. The Right Sidebar rail gets its own
// pill on the far right — its sections render beside the record on EVERY tab,
// so they never belong to any one tab. Every pill is a drop target for a
// section card's drag, which is how sections move between tabs. The muted
// Activity note reminds that the record page adds that tab automatically.
// File-folder tab styling. Hover needs a pseudo-class, so the tab shapes get
// a small scoped stylesheet (lce- prefix) instead of pure inline styles —
// colors are the design-system constants interpolated once at module load.
const TAB_CSS = `
.lce-tab { display:flex; align-items:center; gap:7px; padding:9px 14px 8px; white-space:nowrap; cursor:pointer;
  position:relative; font-family:inherit; font-size:12.5px; font-weight:500; color:${C.textSecondary};
  background:${C.border}; border:1px solid ${C.borderDark}; border-bottom:none;
  border-radius:9px 9px 0 0; transition:background 200ms ease, color 200ms ease; }
.lce-tab:hover:not(.lce-active) { background:#eef2f8; color:${C.textPrimary}; }
.lce-tab.lce-active { background:${C.card}; color:${C.textPrimary}; font-weight:600;
  border-top:3px solid ${C.emerald}; padding-top:7px; padding-bottom:9px; margin-bottom:-1px;
  box-shadow:0 -2px 6px rgba(13,26,46,0.07); z-index:1; }
.lce-tab.lce-drop { background:#f0faf5; box-shadow:inset 0 0 0 1px ${C.emerald}; color:${C.textPrimary}; }
.lce-tab-ghost { display:flex; align-items:center; padding:9px 12px 8px; white-space:nowrap; cursor:default;
  font-size:11.5px; color:${C.textMuted}; background:transparent;
  border:1px dashed ${C.borderDark}; border-bottom:none; border-radius:9px 9px 0 0; }
.lce-tab-new { display:flex; align-items:center; padding:9px 13px 8px; white-space:nowrap; cursor:pointer;
  font-family:inherit; font-size:12.5px; font-weight:500; color:${C.emeraldMid}; background:transparent;
  border:1px dashed ${C.borderDark}; border-bottom:none; border-radius:9px 9px 0 0;
  transition:background 200ms ease; }
.lce-tab-new:hover { background:#f0faf5; border-color:${C.emeraldMid}; }
`

function TabBar({ tabList, activeTab, tabSectionCount, onSelect, onAdd, onRename, onRequestDelete }) {
  const [adding, setAdding] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, padding: '10px 16px 0', background: C.page, borderBottom: `1px solid ${C.borderDark}`, flexShrink: 0, overflowX: 'auto' }}>
      <style>{TAB_CSS}</style>
      {tabList.map(t => (
        <TabPill key={t} name={t} label={t} count={tabSectionCount(t)} active={activeTab === t}
          standard={STANDARD_TABS.includes(t)}
          onSelect={onSelect} onRename={onRename} onRequestDelete={onRequestDelete} />
      ))}
      {adding
        ? <NewTabInput onCommit={(name) => { setAdding(false); if (name.trim()) onAdd(name) }} />
        : <button onClick={() => setAdding(true)} title="Create a new record-page tab" className="lce-tab-new">
            + New Tab
          </button>}
      <span title="The record page adds the Activity tab automatically — it can't hold layout sections."
        className="lce-tab-ghost">
        Activity · automatic
      </span>
    </div>
  )
}

// ─── Right-sidebar rail ──────────────────────────────────────────────────────
// Live WYSIWYG stand-in for the record page's utility rail: always visible
// beside the canvas (the record page shows these sections on every tab), and
// a drop target for section drags — dropping a section card anywhere on the
// rail moves it to placement='right'. Sections inside are the same editable
// cards as the main canvas.
function RightRail({ count, onAdd, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `tabdrop::${RIGHT_TAB}` })
  return (
    <div ref={setNodeRef} style={{
      // Matches the record page's rail width (480px) so the editor shows the
      // real proportions — WYSIWYG.
      width: 480, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      borderLeft: `1px solid ${C.borderDark}`,
      background: isOver ? '#f0faf5' : '#eaeef6',
      boxShadow: isOver ? `inset 0 0 0 1px ${C.emerald}` : 'none',
      transition: 'background 200ms ease',
    }}>
      <div style={{ padding: '11px 14px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>Right Sidebar</div>
        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>Shows beside the record on every tab</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
        {children}
        {count === 0 && (
          <div style={{ fontSize: 11.5, color: C.textMuted, textAlign: 'center', lineHeight: 1.5, padding: '18px 10px', marginBottom: 10,
            border: `1px dashed ${C.borderDark}`, borderRadius: 8, background: 'rgba(255,255,255,0.55)' }}>
            Drag a section here to pin it to the always-visible right sidebar.
          </div>
        )}
        <button onClick={onAdd} style={{ ...addSectionBtn(), padding: '8px', fontSize: 12 }}>+ Add Section</button>
      </div>
    </div>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  )
}

function TabPill({ name, label, count, active, standard, onSelect, onRename, onRequestDelete, hint }) {
  // Drop target for section-card drags — dropping a section here moves it to
  // this tab (dragFamily maps "tabdrop::" into the section family).
  const { setNodeRef, isOver } = useDroppable({ id: `tabdrop::${name}` })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== label && !onRename(label, draft)) setDraft(label)
  }
  if (editing) return (
    <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(label); setEditing(false) } }}
      style={{ width: 130, margin: '7px 4px', padding: '5px 9px', fontSize: 12.5, border: `1px solid ${C.emerald}`, borderRadius: 5, outline: 'none', color: C.textPrimary, background: C.card }} />
  )
  return (
    <div ref={setNodeRef} onClick={() => onSelect(name)}
      title={hint || (standard ? undefined : 'Rename or delete this tab with the controls shown while it is active. Drop a section card here to move the section onto this tab.')}
      className={`lce-tab${active ? ' lce-active' : ''}${isOver ? ' lce-drop' : ''}`}>
      {label}
      <span style={{ fontSize: 10.5, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace',
        color: active ? C.emeraldMid : C.textMuted,
        background: active ? '#e9f9f1' : C.cardSecondary,
        border: `1px solid ${active ? '#bfe9d6' : C.border}`, borderRadius: 9, padding: '1px 7px' }}>{count}</span>
      {!standard && active && (
        <>
          <span onClick={e => { e.stopPropagation(); setDraft(label); setEditing(true) }} title="Rename tab"
            style={{ display: 'inline-flex', color: C.textMuted, padding: '2px' }}><PencilIcon /></span>
          <span onClick={e => { e.stopPropagation(); onRequestDelete(name) }} title="Delete tab (its sections move to Details)"
            style={{ fontSize: 13, fontWeight: 600, color: C.sky, padding: '0 2px', lineHeight: 1 }}>×</span>
        </>
      )}
    </div>
  )
}

function NewTabInput({ onCommit }) {
  const [value, setValue] = useState('')
  return (
    <input autoFocus value={value} placeholder="Tab name…"
      onChange={e => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(value); if (e.key === 'Escape') onCommit('') }}
      style={{ width: 130, margin: '7px 4px', padding: '5px 9px', fontSize: 12.5, border: `1px solid ${C.borderDark}`, borderRadius: 5, outline: 'none', color: C.textPrimary, background: C.card }} />
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
  const placement = section.placement || 'main'

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
        <span title="Move this section by dragging its ⠿ handle onto a tab above or into the right-sidebar rail"
          style={{ fontSize: 10.5, color: C.textMuted, flexShrink: 0 }}>drag ⠿ to a tab or the sidebar</span>
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
          placement={placement}
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
function WidgetZone({ sectionKey, placement, widgets, onPatchWidget, onRemoveWidget, onOpenRelatedModal }) {
  const { setNodeRef, isOver } = useDroppable({ id: `wzone::${sectionKey}` })
  return (
    <div ref={setNodeRef} style={{
      marginTop: 8, padding: 6, borderRadius: 6,
      border: `1px dashed ${isOver ? C.emerald : 'transparent'}`,
      background: isOver ? '#f0faf5' : 'transparent',
    }}>
      <SortableContext items={widgets.map(w => `wgt::${w.key}`)} strategy={verticalListSortingStrategy}>
        {widgets.map(w => (
          <WidgetTile key={w.key} widget={w} sectionKey={sectionKey} placement={placement}
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

function WidgetTile({ widget, sectionKey, placement, onPatch, onRemove, onOpenRelatedModal }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `wgt::${widget.key}` })
  // Cards render exactly where they're placed — inside their section on its
  // tab. The one placement worth calling out is the right rail.
  const isCard = CARD_WIDGET_TYPES.has(widget.type)
  const renderHint = isCard && placement === 'right' ? 'Right sidebar' : null
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
      <span
        title={renderHint ? "This card renders in the record page's always-visible right sidebar." : undefined}
        style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 0 }}>
        {WIDGET_LABELS[widget.type] || widget.type}
        {renderHint && <span style={{ color: C.sky }}> · {renderHint}</span>}
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
