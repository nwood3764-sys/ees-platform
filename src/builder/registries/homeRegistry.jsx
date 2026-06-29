// =============================================================================
// src/builder/registries/homeRegistry.jsx
//
// The home-page surface's registry. Same shape the LEAP Canvas shell consumes
// as the dashboard registry, but its components are home-page components
// (embeds + cards) and they render through the existing HomeComponentRenderer.
//
// Home components are self-contained cards (HomeComponentRenderer wraps each in
// its own card chrome), so `selfChrome: true` tells the canvas to skip its
// header chrome and just provide a selection wrapper + drag grip — no double
// card. Heavy embeds (dashboard/report) show a labeled placeholder in the
// builder (like Salesforce App Builder); the lighter cards/list render live.
// =============================================================================

import { C } from '../../data/constants'
import { makeHelpers, fieldVisible } from './registryHelpers'
import { Field, inputStyle, FieldControl } from '../inspectorControls'
import HomeComponentRenderer from '../../modules/admin/HomeComponentRenderer'

// dataSource: 'dashboard' | 'report' | 'list_view' bind to a saved source;
// 'none' components are self-driven (cards / task list).
const HOME_ENTRIES = [
  { id: 'dashboard', label: 'Dashboard', category: 'Embeds', dataSource: 'dashboard',
    icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
    defaultSize: { w: 12, h: 6 }, minSize: { w: 4, h: 3 }, defaultConfig: {}, configSchema: [] },
  { id: 'report_chart', label: 'Report Chart', category: 'Embeds', dataSource: 'report',
    icon: 'M3 3v18h18M9 17V9m4 8V5m4 12v-6',
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 }, defaultConfig: {}, configSchema: [] },
  { id: 'list_view', label: 'List View', category: 'Embeds', dataSource: 'list_view',
    icon: 'M4 6h16M4 12h16M4 18h16',
    defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 2 }, defaultConfig: {}, configSchema: [] },
  { id: 'task_list', label: 'Task List', category: 'Operational', dataSource: 'none',
    icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 2 }, defaultConfig: {}, configSchema: [] },
  { id: 'metric_card', label: 'Metric Card', category: 'Metrics & KPIs', dataSource: 'none',
    icon: 'M3 3h18v18H3zM9 9h6v6H9z',
    defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 }, defaultConfig: { value: '', subtitle: '' },
    configSchema: [
      { key: 'value', label: 'Value', type: 'text', placeholder: 'e.g. 128' },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
    ] },
  { id: 'percentage_card', label: 'Percentage Card', category: 'Goal & Progress', dataSource: 'none',
    icon: 'M19 5L5 19M6.5 6.5h.01M17.5 17.5h.01',
    defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 }, defaultConfig: { percent: 0, subtitle: '', color: C.emerald },
    configSchema: [
      { key: 'percent', label: 'Percent (0–100)', type: 'number', min: 0, max: 100 },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'color', label: 'Bar color', type: 'color' },
    ] },
  { id: 'gauge', label: 'Gauge', category: 'Goal & Progress', dataSource: 'none',
    icon: 'M12 14l4-4M4 14a8 8 0 1116 0',
    defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 }, defaultConfig: { percent: 0, subtitle: '', color: C.emerald },
    configSchema: [
      { key: 'percent', label: 'Percent (0–100)', type: 'number', min: 0, max: 100 },
      { key: 'subtitle', label: 'Subtitle', type: 'text' },
      { key: 'color', label: 'Dial color', type: 'color' },
    ] },
  { id: 'rich_text', label: 'Rich Text', category: 'Content & Layout', dataSource: 'none',
    icon: 'M4 6h16M4 12h10M4 18h7',
    defaultSize: { w: 4, h: 3 }, minSize: { w: 2, h: 2 }, defaultConfig: { text: '' },
    configSchema: [{ key: 'text', label: 'Text', type: 'textarea', placeholder: 'Note / instructions…' }] },
]

const { getComponent, getPaletteCategories, defaultConfigFor } = makeHelpers(HOME_ENTRIES)

// dataSource → the sources list key the picker reads.
const SOURCE_KEY = { dashboard: 'dashboards', report: 'reports', list_view: 'listViews' }
const SOURCE_LABEL = { dashboard: 'Dashboard', report: 'Report', list_view: 'List View' }

function HomeComponentInspector({ component, sources = {}, onChange, onRemove }) {
  const entry = getComponent(component.type)
  if (!entry) return <div style={{ fontSize: 12, color: C.textMuted }}>Unknown component.</div>
  const cfg = component.config || {}
  const setConfig = (key, value) => onChange({ config: { ...cfg, [key]: value } })
  const needsSource = entry.dataSource !== 'none'
  const sourceList = needsSource ? (sources[SOURCE_KEY[entry.dataSource]] || []) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 2 }}>{entry.category}</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{entry.label}</div>
      </div>

      <Field label="Title"><input type="text" value={component.title || ''} placeholder={entry.label}
        onChange={e => onChange({ title: e.target.value })} style={inputStyle()} /></Field>

      {needsSource && (
        <Field label={SOURCE_LABEL[entry.dataSource]} help={`The ${SOURCE_LABEL[entry.dataSource].toLowerCase()} this component embeds.`}>
          <select value={component.dataSourceId || ''} onChange={e => onChange({ dataSourceId: e.target.value || null })} style={inputStyle()}>
            <option value="">— Select —</option>
            {sourceList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}

      {entry.dataSource === 'none' && entry.id === 'task_list' && (
        <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>Shows the current user’s open tasks. No configuration needed.</div>
      )}

      {entry.configSchema.filter(d => fieldVisible(d, cfg)).map(d => (
        <Field key={d.key} label={d.label} help={d.help}>
          <FieldControl descriptor={d} value={cfg[d.key]} onChange={v => setConfig(d.key, v)} />
        </Field>
      ))}

      <button onClick={onRemove} style={{
        marginTop: 6, padding: '8px 12px', fontSize: 12, fontWeight: 500,
        background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
      }}>Remove component</button>
    </div>
  )
}

// Heavy embeds render as labeled placeholders in the builder (App-Builder
// style); lighter cards + list views render live so the canvas is WYSIWYG.
const HEAVY = new Set(['dashboard', 'report_chart'])

function HomeLivePreview({ component, sources }) {
  const preview = HEAVY.has(component.type)
  return (
    <HomeComponentRenderer
      component={{ type: component.type, sourceId: component.dataSourceId, title: component.title, config: component.config || {} }}
      preview={preview}
      sources={sources}
    />
  )
}

export const homeRegistry = {
  id: 'home',
  selfChrome: true,
  entries: HOME_ENTRIES,
  getComponent,
  getPaletteCategories,
  defaultConfigFor,
  ComponentInspector: HomeComponentInspector,
  LivePreview: HomeLivePreview,
}
