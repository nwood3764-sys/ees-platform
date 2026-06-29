// =============================================================================
// src/builder/Inspector.jsx
//
// The right rail of the LEAP Canvas. Two modes:
//   • a component is selected → a config form GENERATED from that component's
//     registry `configSchema` (no per-widget form code; add a field to the
//     schema and it appears here). Report-bound components also get a data
//     binding (report picker) and `field`-type pickers that read the chosen
//     report's columns.
//   • nothing selected → canvas-level info + a reorderable "Layers" list
//     (dnd-kit via SortableList) listing every placed component; click selects,
//     drag reorders document/tab order.
//
// Reports and report columns are fetched read-only (RLS-respecting) so the
// inspector feels real in the Phase-0 preview without writing anything.
// =============================================================================

import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { getComponent, fieldVisible } from './componentRegistry'
import SortableList from './SortableList'
import { fetchReports, getReportSelectedFields } from '../data/reportsService'

export default function Inspector({ components, selectedId, settingsPanel, onChange, onSelect, onRemove }) {
  const selected = components.find(c => c.id === selectedId) || null
  return (
    <div style={{
      width: 300, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
      background: C.card, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={paneHeader()}>{selected ? 'Widget' : 'Dashboard'}</div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
        {selected
          ? <ComponentInspector key={selected.id} component={selected}
              onChange={(patch) => onChange(selected.id, patch)} onRemove={() => onRemove(selected.id)} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {settingsPanel}
              <LayersPanel components={components} onSelect={onSelect}
                onReorder={(next) => onChange('__reorder__', next)} />
            </div>
          )}
      </div>
    </div>
  )
}

// ─── Selected-component config form ───────────────────────────────────────────
function ComponentInspector({ component, onChange, onRemove }) {
  const entry = getComponent(component.type)
  const [reports, setReports]   = useState([])
  const [columns, setColumns]   = useState([])
  const needsReport = entry?.dataSource === 'report'

  // Load saved reports once when this is a report-bound component.
  useEffect(() => {
    if (!needsReport) return
    let cancelled = false
    fetchReports().then(r => { if (!cancelled) setReports(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [needsReport])

  // Load the selected report's columns so `field` pickers populate.
  useEffect(() => {
    if (!needsReport || !component.dataSourceId) { setColumns([]); return }
    let cancelled = false
    getReportSelectedFields(component.dataSourceId)
      .then(f => { if (!cancelled) setColumns(f) })
      .catch(() => { if (!cancelled) setColumns([]) })
    return () => { cancelled = true }
  }, [needsReport, component.dataSourceId])

  const cfg = component.config || {}
  const setConfig = (key, value) => onChange({ config: { ...cfg, [key]: value } })

  if (!entry) return <div style={{ fontSize: 12, color: C.textMuted }}>Unknown component.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>{entry.category}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{entry.label}</div>
      </div>

      {/* Salesforce dashboard-component chrome: Title / Subtitle / Footer. */}
      <Field label="Title">
        <input type="text" value={component.title || ''} placeholder={entry.label}
          onChange={e => onChange({ title: e.target.value })} style={input()} />
      </Field>

      <Field label="Subtitle">
        <input type="text" value={component.subtitle || ''} placeholder="Optional subtitle"
          onChange={e => onChange({ subtitle: e.target.value })} style={input()} />
      </Field>

      <Field label="Footer">
        <input type="text" value={component.footer || ''} placeholder="Optional footer"
          onChange={e => onChange({ footer: e.target.value })} style={input()} />
      </Field>

      {needsReport && (
        <Field label="Report" help="The saved report that supplies this widget's data.">
          <select value={component.dataSourceId || ''} onChange={e => onChange({ dataSourceId: e.target.value || null })} style={input()}>
            <option value="">— Select a report —</option>
            {reports.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </Field>
      )}

      {entry.configSchema
        .filter(d => fieldVisible(d, cfg))
        .map(d => (
          <Field key={d.key} label={d.label} help={d.help}>
            <FieldControl descriptor={d} value={cfg[d.key]} columns={columns}
              onChange={v => setConfig(d.key, v)} />
          </Field>
        ))}

      <button onClick={onRemove} style={{
        marginTop: 6, padding: '8px 12px', fontSize: 12, fontWeight: 500,
        background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`,
        borderRadius: 6, cursor: 'pointer',
      }}>Remove component</button>
    </div>
  )
}

// One control per field descriptor type. `columns` are the selected report's
// selectable fields, used by the `field` picker.
function FieldControl({ descriptor, value, onChange, columns }) {
  switch (descriptor.type) {
    case 'textarea':
      return <textarea rows={4} value={value ?? ''} placeholder={descriptor.placeholder || ''}
        onChange={e => onChange(e.target.value)} style={{ ...input(), resize: 'vertical' }} />
    case 'number':
      return <input type="number" value={value ?? ''} min={descriptor.min} max={descriptor.max}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} style={input()} />
    case 'boolean':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
          <input type="checkbox" checked={value !== false} onChange={e => onChange(e.target.checked)} />
          {descriptor.help ? '' : 'Enabled'}
        </label>
      )
    case 'select':
      return (
        <select value={value ?? descriptor.options?.[0]?.value ?? ''} onChange={e => onChange(e.target.value)} style={input()}>
          {(descriptor.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'field':
      return (
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} style={input()}>
          <option value="">{columns.length ? '— Select a field —' : '— Choose a report first —'}</option>
          {columns.map((f, i) => (
            <option key={`${f.name}-${i}`} value={f.name}>
              {f.label || f.name}{f.via_path?.length ? ` (${f.via_path.join('.')})` : ''}
            </option>
          ))}
        </select>
      )
    case 'color':
      return <input type="color" value={value || C.emerald} onChange={e => onChange(e.target.value)}
        style={{ width: 48, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer' }} />
    case 'text':
    default:
      return <input type="text" value={value ?? ''} placeholder={descriptor.placeholder || ''}
        onChange={e => onChange(e.target.value)} style={input()} />
  }
}

// ─── Empty-state layer list (dnd-kit sortable) ────────────────────────────────
function LayersPanel({ components, onSelect, onReorder }) {
  if (components.length === 0) {
    return (
      <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
        Drag a component from the left palette onto the canvas to begin. Select
        a placed component to configure it here.
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Components on this canvas
      </div>
      <SortableList
        items={components}
        onReorder={onReorder}
        renderItem={(item, { setNodeRef, style, dragHandleProps }) => {
          const entry = getComponent(item.type)
          return (
            <div ref={setNodeRef} style={{ ...style, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span {...dragHandleProps} title="Drag to reorder" style={{
                cursor: 'grab', color: C.textMuted, fontSize: 14, lineHeight: 1, padding: '0 2px', touchAction: 'none',
              }}>⠿</span>
              <button onClick={() => onSelect(item.id)} style={{
                flex: 1, textAlign: 'left', padding: '7px 10px', fontSize: 13,
                background: C.cardSecondary, color: C.textPrimary,
                border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.title || entry?.label || item.type}
              </button>
            </div>
          )
        }}
      />
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function Field({ label, help, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
        {label}
      </label>
      {children}
      {help && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{help}</div>}
    </div>
  )
}
function input() {
  return {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: C.card, color: C.textPrimary,
    border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit', boxSizing: 'border-box',
  }
}
function paneHeader() {
  return {
    padding: '12px 14px', fontSize: 13, fontWeight: 600, color: C.textPrimary,
    borderBottom: `1px solid ${C.border}`, background: C.cardSecondary, flexShrink: 0,
  }
}
