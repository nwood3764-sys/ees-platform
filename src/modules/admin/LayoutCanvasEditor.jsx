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
// Persists through the existing page-layout service (bulk soft-delete +
// recreate). No schema change.
// =============================================================================

import { useState, useEffect, useCallback, memo } from 'react'
import {
  DndContext, closestCorners, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import { inputStyle } from '../../builder/inspectorControls'
import { loadLayoutForCanvas, saveLayoutFromCanvas } from '../../builder/adapters/pageLayoutAdapter'
import { describeObject } from '../../data/adminService'
import { deriveEesFieldType, humanizeColumnName } from './widgets/eesFieldTypes'

// Display formats a related-list column can render as. Mirrors the type
// dispatch in RecordDetail's renderRelatedCell (text / phone / date / number /
// picklist badge / boolean), so what you pick here is exactly how the live
// record page renders the cell.
const RL_FORMATS = [
  { value: 'text',     label: 'Text' },
  { value: 'phone',    label: 'Phone' },
  { value: 'date',     label: 'Date' },
  { value: 'number',   label: 'Number' },
  { value: 'picklist', label: 'Status (badge)' },
  { value: 'boolean',  label: 'Yes / No' },
]

// System columns never worth offering in the related-list column picker.
const RL_HIDDEN_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deletion_reason'])

const WIDGET_LABELS = {
  field_group: 'Field Group', related_list: 'Related List', report: 'Report',
  file_gallery: 'File Gallery', conversation_panel: 'Conversation', status_path: 'Status Path',
  prtsn_history: 'Publish History',
}

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
  // Move a whole section up or down in the layout. Section order is simply the
  // array order — saveLayoutFromCanvas recreates sections in that order (its
  // section_order = index), so a swap here is all that's needed to persist the
  // new arrangement on Save. No separate reorder call.
  const moveSection = useCallback((key, dir) => {
    setSections(s => {
      const i = s.findIndex(x => x.key === key)
      if (i < 0) return s
      const j = dir === 'up' ? i - 1 : i + 1
      if (j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])
  const setFieldGroupFields = useCallback((sectionKey, widgetKey, nextFields) => {
    setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
      ...sec, widgets: sec.widgets.map(w => w.key !== widgetKey ? w : { ...w, config: { ...w.config, fields: nextFields } }),
    }))
  }, [])
  // Merge a patch into a widget's config (used by the related-list column
  // editor). Persists through the normal Save — saveLayoutFromCanvas recreates
  // each widget from its config, so an edited columns array round-trips.
  const patchWidgetConfig = useCallback((sectionKey, widgetKey, patch) => {
    setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
      ...sec, widgets: sec.widgets.map(w => w.key !== widgetKey ? w : { ...w, config: { ...w.config, ...patch } }),
    }))
  }, [])
  const activate = useCallback((key) => setActiveSection(key), [])

  // One shared drag context for the whole canvas so a placed field can be
  // dragged BETWEEN sections (not just reordered within its own). active.id is
  // the field name; over.id is either a column drop-zone ("<sectionKey>::col:N")
  // or another field's name.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onFieldDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const activeName = active.id
    const overId = String(over.id)
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

  const addSection = () => {
    const key = `sec-new-${Date.now()}`
    setSections(s => [...s, { key, label: 'New Section', columns: 2, tab: 'Details', isCollapsible: false, isCollapsedByDefault: false, placement: 'main',
      widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [] } }] }])
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
          <DndContext sensors={dndSensors} collisionDetection={closestCorners} onDragEnd={onFieldDragEnd}>
            {sections.map((sec, i) => (
              <SectionCard key={sec.key} section={sec} object={meta.object} active={activeSection === sec.key}
                onActivate={activate} onPatch={patchSection} onRemove={removeSection} onSetFields={setFieldGroupFields}
                onPatchWidgetConfig={patchWidgetConfig}
                onMove={moveSection} isFirst={i === 0} isLast={i === sections.length - 1} />
            ))}
          </DndContext>
          <button onClick={addSection} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 500, background: C.card, color: C.emeraldMid, border: `1px dashed ${C.borderDark}`, borderRadius: 8, cursor: 'pointer' }}>
            + Add Section
          </button>
        </div>
      </div>
    </div>
  )
}

// memo: only the edited section (or the two whose `active` flips) re-renders —
// keeps the drag contexts from re-mounting on every keystroke (the sluggishness).
const SectionCard = memo(function SectionCard({ section, object, active, onActivate, onPatch, onRemove, onSetFields, onPatchWidgetConfig, onMove, isFirst, isLast }) {
  const fg = (section.widgets || []).find(w => w.type === 'field_group')
  const others = (section.widgets || []).filter(w => w.type !== 'field_group')
  const cols = section.columns || 2

  return (
    <div onMouseDown={() => onActivate(section.key)} style={{
      background: C.card, border: `1px solid ${active ? C.emerald : C.border}`, borderRadius: 8,
      marginBottom: 14, overflow: 'hidden', boxShadow: active ? `0 0 0 1px ${C.emerald}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
        {/* Move the whole section up / down in the layout. Disabled at the ends. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          <button onClick={() => onMove(section.key, 'up')} disabled={isFirst} title="Move section up" style={moveBtn(isFirst)}>▲</button>
          <button onClick={() => onMove(section.key, 'down')} disabled={isLast} title="Move section down" style={moveBtn(isLast)}>▼</button>
        </div>
        <input value={section.label} onChange={e => onPatch(section.key, { label: e.target.value })}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary, border: 'none', background: 'transparent', outline: 'none' }} />
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
        {others.map(w => (
          w.type === 'related_list'
            ? <RelatedListEditor key={w.key} widget={w} onPatchConfig={(patch) => onPatchWidgetConfig(section.key, w.key, patch)} />
            : (
              <div key={w.key} style={{ marginTop: 8, padding: '10px 12px', background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5, color: C.textPrimary, fontWeight: 500 }}>{w.title || WIDGET_LABELS[w.type] || w.type}</span>
                <span style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{WIDGET_LABELS[w.type] || w.type}</span>
              </div>
            )
        ))}
      </div>
    </div>
  )
})

// ─── Related-list column editor ──────────────────────────────────────────────
// Inline builder for a related_list widget: add / remove / reorder columns,
// rename their labels, and set each column's display format (which is exactly
// how RecordDetail's renderRelatedCell renders it — text / phone / date /
// number / status badge / yes-no). Edits merge into the widget's config via
// onPatchConfig and persist with the canvas Save. The available-column list is
// the target table's live schema, fetched lazily the first time you expand it.
function RelatedListEditor({ widget, onPatchConfig }) {
  const cfg = widget.config || {}
  const columns = Array.isArray(cfg.columns) ? cfg.columns : []
  const [open, setOpen] = useState(false)
  const [avail, setAvail] = useState(null)
  const [loadingAvail, setLoadingAvail] = useState(false)

  useEffect(() => {
    if (!open || avail || !cfg.table) return
    let cancelled = false
    setLoadingAvail(true)
    describeObject(cfg.table)
      .then(cols => { if (!cancelled) setAvail(cols || []) })
      .catch(() => { if (!cancelled) setAvail([]) })
      .finally(() => { if (!cancelled) setLoadingAvail(false) })
    return () => { cancelled = true }
  }, [open, avail, cfg.table])

  const setColumns = (next) => onPatchConfig({ columns: next })
  const move = (i, dir) => {
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= columns.length) return
    const next = [...columns]
    ;[next[i], next[j]] = [next[j], next[i]]
    setColumns(next)
  }
  const patchCol = (i, patch) => setColumns(columns.map((c, x) => x === i ? { ...c, ...patch } : c))
  const removeCol = (i) => setColumns(columns.filter((_, x) => x !== i))
  const addCol = (name) => {
    if (!name || columns.some(c => c.name === name)) return
    const m = (avail || []).find(a => a.column_name === name)
    const derived = m ? deriveEesFieldType(m) : 'text'
    const type = RL_FORMATS.some(f => f.value === derived) ? derived : 'text'
    setColumns([...columns, { name, type, label: humanizeColumnName(name) }])
  }

  const present = new Set(columns.map(c => c.name))
  // Offer only columns that render cleanly as a cell: skip system plumbing,
  // the primary key, and lookup (FK) columns — those need lookup config the
  // simple editor doesn't set, so they'd otherwise show a raw UUID.
  const addable = (avail || []).filter(a =>
    !present.has(a.column_name) &&
    !RL_HIDDEN_COLUMNS.has(a.column_name) &&
    !a.is_primary_key &&
    deriveEesFieldType(a) !== 'lookup')

  return (
    <div style={{ marginTop: 8, background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer' }}>
        <span style={{ fontSize: 12.5, color: C.textPrimary, fontWeight: 500 }}>
          {widget.title || cfg.title || 'Related List'}
          <span style={{ fontSize: 10.5, color: C.textMuted, marginLeft: 8, fontFamily: 'JetBrains Mono, monospace' }}>{cfg.table || '—'}</span>
        </span>
        <span style={{ fontSize: 11, color: C.textSecondary }}>{columns.length} column{columns.length === 1 ? '' : 's'} {open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${C.border}` }}>
          {columns.length === 0 && <div style={{ fontSize: 11.5, color: C.textMuted, padding: '8px 0' }}>No columns yet — add one below.</div>}
          {columns.map((c, i) => (
            <div key={c.name || i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button onClick={() => move(i, 'up')} disabled={i === 0} title="Move column up" style={moveBtn(i === 0)}>▲</button>
                <button onClick={() => move(i, 'down')} disabled={i === columns.length - 1} title="Move column down" style={moveBtn(i === columns.length - 1)}>▼</button>
              </div>
              <input value={c.label || ''} onChange={e => patchCol(i, { label: e.target.value })} placeholder={humanizeColumnName(c.name)}
                style={{ ...inputStyle(), flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12 }} />
              <span title={c.name} style={{ fontSize: 10, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.name}</span>
              <select value={RL_FORMATS.some(f => f.value === c.type) ? c.type : 'text'} onChange={e => patchCol(i, { type: e.target.value })}
                style={{ ...inputStyle(), width: 'auto', padding: '5px 6px', fontSize: 12, flexShrink: 0 }}>
                {RL_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <button onClick={() => removeCol(i)} title="Remove column" style={miniBtn()}>×</button>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <select value="" onChange={e => addCol(e.target.value)} disabled={loadingAvail}
              style={{ ...inputStyle(), width: '100%', padding: '6px 8px', fontSize: 12 }}>
              <option value="">{loadingAvail ? 'Loading fields…' : `+ Add column from ${cfg.table || 'target'}…`}</option>
              {addable.map(a => <option key={a.column_name} value={a.column_name}>{humanizeColumnName(a.column_name)} — {a.column_name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 8 }}>
            First column is the record link. Changes save with the layout.
          </div>
        </div>
      )}
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

function btnPrimary(disabled) {
  return { padding: '8px 16px', fontSize: 13, fontWeight: 500, background: disabled ? C.borderDark : C.emerald, color: '#fff', border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer' }
}
function btnSecondary() {
  return { padding: '8px 14px', fontSize: 13, fontWeight: 500, background: C.card, color: C.textPrimary, border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer' }
}
function miniBtn() {
  return { width: 22, height: 22, fontSize: 13, fontWeight: 600, background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }
}
function moveBtn(disabled) {
  return {
    width: 20, height: 15, fontSize: 8, lineHeight: '13px', padding: 0,
    background: disabled ? C.cardSecondary : C.card, color: disabled ? C.borderDark : C.textSecondary,
    border: `1px solid ${C.border}`, borderRadius: 3, cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}
