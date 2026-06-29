// =============================================================================
// src/builder/registries/dashboardRegistry.jsx
//
// The dashboard surface's registry: the widget entries (from componentRegistry)
// bundled with the two surface-specific pieces the canvas needs —
//   • ComponentInspector — the per-widget config form (report binding,
//     measure/group-by, gauge target, …), generated from each entry's
//     configSchema.
//   • LivePreview        — the canvas tile body: real report data via
//     LiveWidgetPreview when bound, the registry placeholder otherwise.
//
// The LEAP Canvas shell consumes this object and knows nothing dashboard-
// specific; swapping in homeRegistry retargets the same shell at home pages.
// =============================================================================

import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { fetchReports, getReportSelectedFields } from '../../data/reportsService'
import {
  COMPONENT_REGISTRY, getComponent, getPaletteCategories, defaultConfigFor, fieldVisible,
} from '../componentRegistry'
import { Field, inputStyle, FieldControl } from '../inspectorControls'
import LiveWidgetPreview from '../LiveWidgetPreview'

// ─── Per-widget config form ───────────────────────────────────────────────────
function DashboardComponentInspector({ component, onChange, onRemove }) {
  const entry = getComponent(component.type)
  const [reports, setReports] = useState([])
  const [columns, setColumns] = useState([])
  const needsReport = entry?.dataSource === 'report'

  useEffect(() => {
    if (!needsReport) return
    let cancelled = false
    fetchReports().then(r => { if (!cancelled) setReports(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [needsReport])

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

      <Field label="Title"><input type="text" value={component.title || ''} placeholder={entry.label}
        onChange={e => onChange({ title: e.target.value })} style={inputStyle()} /></Field>
      <Field label="Subtitle"><input type="text" value={component.subtitle || ''} placeholder="Optional subtitle"
        onChange={e => onChange({ subtitle: e.target.value })} style={inputStyle()} /></Field>
      <Field label="Footer"><input type="text" value={component.footer || ''} placeholder="Optional footer"
        onChange={e => onChange({ footer: e.target.value })} style={inputStyle()} /></Field>

      {needsReport && (
        <Field label="Report" help="The saved report that supplies this widget's data.">
          <select value={component.dataSourceId || ''} onChange={e => onChange({ dataSourceId: e.target.value || null })} style={inputStyle()}>
            <option value="">— Select a report —</option>
            {reports.map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
          </select>
        </Field>
      )}

      {entry.configSchema.filter(d => fieldVisible(d, cfg)).map(d => (
        <Field key={d.key} label={d.label} help={d.help}>
          <FieldControl descriptor={d} value={cfg[d.key]} columns={columns} onChange={v => setConfig(d.key, v)} />
        </Field>
      ))}

      <button onClick={onRemove} style={{
        marginTop: 6, padding: '8px 12px', fontSize: 12, fontWeight: 500,
        background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
      }}>Remove component</button>
    </div>
  )
}

// ─── Canvas tile body ─────────────────────────────────────────────────────────
function DashboardLivePreview({ component }) {
  const entry = getComponent(component.type)
  if (!entry) return null
  const reportBound = entry.dataSource === 'report'
  if (reportBound && component.dataSourceId) return <LiveWidgetPreview component={component} />
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {entry.Preview ? <entry.Preview config={component.config || {}} /> : null}
      {reportBound && !component.dataSourceId && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          fontSize: 11, color: C.sky, background: '#e8f1fb',
          border: `1px solid ${C.border}`, borderRadius: 5, padding: '4px 8px', textAlign: 'center',
        }}>Pick a report in the inspector →</div>
      )}
    </div>
  )
}

export const dashboardRegistry = {
  id: 'dashboard',
  entries: COMPONENT_REGISTRY,
  getComponent,
  getPaletteCategories,
  defaultConfigFor,
  ComponentInspector: DashboardComponentInspector,
  LivePreview: DashboardLivePreview,
}
