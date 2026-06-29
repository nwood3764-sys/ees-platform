// =============================================================================
// src/modules/admin/LayoutCanvasEditor.jsx
//
// The new record page-layout builder. Three-pane (palette / canvas / inspector)
// consistent with the dashboard/home/report builders, but on the SECTION model
// the live record renderer already understands — Sections → field groups (with
// drag-reorderable field tiles) + related lists / reports / etc. Persists
// through the existing page-layout service (no renderer or schema change).
//
// v1 scope: full section + field-group editing (add/remove/reorder fields via
// dnd-kit, section add/rename/delete/columns). Complex widgets (related_list,
// report, file_gallery, conversation_panel, status_path) loaded from the layout
// are preserved through save and titled here; their deep config editing is the
// next increment.
// =============================================================================

import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { LoadingState, ErrorState } from '../../components/UI'
import SortableList from '../../builder/SortableList'
import { inputStyle } from '../../builder/inspectorControls'
import { loadLayoutForCanvas, saveLayoutFromCanvas } from '../../builder/adapters/pageLayoutAdapter'

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

export default function LayoutCanvasEditor({ layoutId, objectLabel, onBack }) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [meta, setMeta]       = useState(null)
  const [columns, setColumns] = useState([])
  const [sections, setSections] = useState([])
  const [activeSection, setActiveSection] = useState(null)
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
        setMeta(data.layout); setColumns(data.columns || []); setSections(data.sections)
        setActiveSection(data.sections[0]?.key || null)
        setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [layoutId])

  // ── Section ops ────────────────────────────────────────────────────────
  const patchSection = (key, patch) => setSections(s => s.map(x => x.key === key ? { ...x, ...patch } : x))
  const addSection = () => {
    const key = `sec-new-${Date.now()}`
    setSections(s => [...s, { key, label: 'New Section', columns: 2, tab: 'Details', isCollapsible: false, isCollapsedByDefault: false, placement: 'main', widgets: [{ key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [] } }] }])
    setActiveSection(key)
  }
  const removeSection = (key) => setSections(s => s.filter(x => x.key !== key))

  // ── Field ops (within a section's first field_group) ─────────────────────
  const fieldGroupOf = (section) => (section.widgets || []).find(w => w.type === 'field_group')
  const placedFieldNames = new Set(
    sections.flatMap(s => (s.widgets || []).filter(w => w.type === 'field_group').flatMap(w => (w.config?.fields || []).map(f => f.name)))
  )
  const addField = (sectionKey, col) => {
    setSections(s => s.map(sec => {
      if (sec.key !== sectionKey) return sec
      let widgets = sec.widgets || []
      let fg = widgets.find(w => w.type === 'field_group')
      const field = { name: col.name, label: humanize(col.name, meta.object) }
      if (!fg) {
        fg = { key: `w-new-${Date.now()}`, type: 'field_group', title: 'Fields', column: 1, size: 'medium', isRequired: false, config: { fields: [field] } }
        return { ...sec, widgets: [fg, ...widgets] }
      }
      return { ...sec, widgets: widgets.map(w => w === fg ? { ...w, config: { ...w.config, fields: [...(w.config?.fields || []), field] } } : w) }
    }))
  }
  const removeField = (sectionKey, widgetKey, name) => setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
    ...sec, widgets: sec.widgets.map(w => w.key !== widgetKey ? w : { ...w, config: { ...w.config, fields: (w.config?.fields || []).filter(f => f.name !== name) } }),
  }))
  const reorderFields = (sectionKey, widgetKey, nextFields) => setSections(s => s.map(sec => sec.key !== sectionKey ? sec : {
    ...sec, widgets: sec.widgets.map(w => w.key !== widgetKey ? w : { ...w, config: { ...w.config, fields: nextFields } }),
  }))

  const handleSave = async () => {
    setSaving(true); setSaveError(null)
    try {
      await saveLayoutFromCanvas({ layoutId, sections })
      setSavedAt(new Date())
    } catch (err) {
      setSaveError(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onBack} />

  const available = columns.filter(c => !placedFieldNames.has(c.name))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.page }}>
      {/* Header */}
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
        {/* Palette: available fields */}
        <div style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.border}`, background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Fields</div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>Click to add to the selected section.</div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
            {available.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textMuted, padding: 6 }}>All fields placed.</div>
            ) : available.map(c => (
              <button key={c.name} onClick={() => activeSection && addField(activeSection, c)}
                disabled={!activeSection}
                title={activeSection ? `Add ${c.name}` : 'Select a section first'}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 9px', marginBottom: 5, fontSize: 12.5,
                  background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, cursor: activeSection ? 'pointer' : 'default', color: C.textPrimary }}>
                {humanize(c.name, meta.object)}
                <span style={{ fontSize: 10, color: C.textMuted, marginLeft: 6, fontFamily: 'JetBrains Mono, monospace' }}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Canvas: sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {sections.map(sec => (
            <SectionCard
              key={sec.key}
              section={sec}
              object={meta.object}
              active={activeSection === sec.key}
              onActivate={() => setActiveSection(sec.key)}
              onPatch={(patch) => patchSection(sec.key, patch)}
              onRemove={() => removeSection(sec.key)}
              onRemoveField={(wKey, name) => removeField(sec.key, wKey, name)}
              onReorderFields={(wKey, next) => reorderFields(sec.key, wKey, next)}
            />
          ))}
          <button onClick={addSection} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 500, background: C.card, color: C.emeraldMid, border: `1px dashed ${C.borderDark}`, borderRadius: 8, cursor: 'pointer' }}>
            + Add Section
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionCard({ section, object, active, onActivate, onPatch, onRemove, onRemoveField, onReorderFields }) {
  const fg = (section.widgets || []).find(w => w.type === 'field_group')
  const others = (section.widgets || []).filter(w => w.type !== 'field_group')
  const fields = fg?.config?.fields || []

  return (
    <div onMouseDown={onActivate} style={{
      background: C.card, border: `1px solid ${active ? C.emerald : C.border}`, borderRadius: 8,
      marginBottom: 14, overflow: 'hidden', boxShadow: active ? `0 0 0 1px ${C.emerald}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
        <input value={section.label} onChange={e => onPatch({ label: e.target.value })}
          style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.textPrimary, border: 'none', background: 'transparent', outline: 'none' }} />
        <label style={{ fontSize: 11, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}>
          Columns
          <select value={section.columns} onChange={e => onPatch({ columns: Number(e.target.value) })}
            style={{ ...inputStyle(), width: 'auto', padding: '3px 6px', fontSize: 12 }}>
            <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
          </select>
        </label>
        <button onClick={onRemove} title="Remove section" style={miniBtn()}>×</button>
      </div>
      <div style={{ padding: 12 }}>
        {fields.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic', padding: '8px 0' }}>
            No fields. Click fields in the left palette to add them here.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${section.columns || 2}, 1fr)`, gap: 8 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <SortableList
                items={fields.map(f => ({ id: `${fg.key}:${f.name}`, f }))}
                onReorder={(next) => onReorderFields(fg.key, next.map(x => x.f))}
                renderItem={(item, { setNodeRef, style, dragHandleProps }) => (
                  <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', marginBottom: 6, background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                    <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none' }}>⠿</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: C.textPrimary }}>{item.f.label || humanize(item.f.name, object)}</span>
                    <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{item.f.name}</span>
                    <button onClick={() => onRemoveField(fg.key, item.f.name)} style={miniBtn()}>×</button>
                  </div>
                )}
              />
            </div>
          </div>
        )}
        {others.map(w => (
          <div key={w.key} style={{ marginTop: 8, padding: '10px 12px', background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: C.textPrimary, fontWeight: 500 }}>{w.title || WIDGET_LABELS[w.type] || w.type}</span>
            <span style={{ fontSize: 10.5, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>{WIDGET_LABELS[w.type] || w.type}</span>
          </div>
        ))}
      </div>
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
  return { width: 24, height: 24, fontSize: 14, fontWeight: 600, background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }
}
