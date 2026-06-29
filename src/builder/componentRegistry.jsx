// =============================================================================
// src/builder/componentRegistry.jsx
//
// THE single source of truth for every component the LEAP Canvas can place.
//
// In the old world a new widget meant edits in three places: the
// DashboardEditor's type dropdown, the DashboardRunner's switch statement, and
// the widget-config form. Here a component is ONE declarative entry. Both the
// left palette and the right inspector are generated from this registry:
//   • palette        ← entry.label / icon / category
//   • inspector form ← entry.configSchema (field descriptors)
//   • canvas preview ← entry.Preview (the live-ish tile shown on the canvas)
//
// This is the central lever for "more widgets than Salesforce": adding one is
// appending an object here, not touching the builder or the runner.
//
// Phase 0 scope: this seeds the registry with the dashboard widget family
// (the nine types the DashboardRunner already renders) plus a few content
// components, enough to exercise every config field type and category in the
// inspector. The `Preview` renderers here are lightweight, on-palette
// representations — Phase 1 swaps them for the real DashboardRunner widget
// renderers (reused, not rewritten) once the canvas is wired to live data.
//
// Entry shape:
//   {
//     id, label, icon (svg path), category,
//     dataSource: 'report' | 'object-field' | 'none',
//     defaultSize: {w,h}, minSize, maxSize,   // grid units (see geometry.js)
//     configSchema: [ FieldDescriptor ],      // drives the Inspector
//     defaultConfig,                           // initial widget_config
//     Preview,                                 // ({config}) => JSX canvas tile
//   }
//
// FieldDescriptor:
//   { key, label, type, options?, placeholder?, help?, min?, max?, dependsOn? }
//   type ∈ 'text' | 'textarea' | 'number' | 'select' | 'boolean'
//        | 'report' | 'field' | 'color' | 'sortable-list'
//   `field` pickers read columns from the report chosen in the `report` field;
//   `dependsOn` names a config key whose truthiness gates this field's display.
// =============================================================================

import { C, CHART_COLORS } from '../data/constants'

// ─── Shared config-field fragments ───────────────────────────────────────────
const MEASURE_FIELD = {
  key: 'measure_type', label: 'Measure', type: 'select',
  options: [
    { value: 'count', label: 'Count of records' },
    { value: 'sum',   label: 'Sum of' },
    { value: 'avg',   label: 'Average of' },
    { value: 'min',   label: 'Min of' },
    { value: 'max',   label: 'Max of' },
  ],
}
const MEASURE_TARGET_FIELD = {
  key: 'measure_field', label: 'Measure field', type: 'field',
  dependsOn: { key: 'measure_type', notEquals: 'count' },
  help: 'Column to aggregate. Ignored when the measure is Count.',
}
const GROUP_BY_FIELD = {
  key: 'group_by', label: 'Group by', type: 'field',
  help: 'Column whose distinct values become the bars/slices/points.',
}
const SORT_FIELD = {
  key: 'sort_by', label: 'Sort', type: 'select',
  options: [
    { value: 'value_desc', label: 'Value, high → low' },
    { value: 'value_asc',  label: 'Value, low → high' },
    { value: 'name',       label: 'Label, A → Z' },
  ],
}
const LIMIT_FIELD = {
  key: 'limit', label: 'Max categories', type: 'number', min: 1, max: 100,
  help: 'Keeps charts legible. Extra categories are dropped after sorting.',
}

// ─── Preview helpers (on-palette, no external chart lib on the canvas yet) ────
function previewBox(children, opts = {}) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: opts.center ? 'center' : 'stretch',
      justifyContent: opts.center ? 'center' : 'flex-start',
      gap: 8, color: C.textSecondary, fontSize: 12, overflow: 'hidden',
    }}>{children}</div>
  )
}
function fakeBars(vertical) {
  const heights = [80, 55, 95, 40, 70, 30]
  if (vertical) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: '100%', padding: '6px 2px' }}>
        {heights.map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h}%`, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: '3px 3px 0 0' }} />
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', height: '100%', padding: '4px 2px' }}>
      {heights.map((h, i) => (
        <div key={i} style={{ width: `${h}%`, height: 10, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 3 }} />
      ))}
    </div>
  )
}
function fakePie(donut) {
  const stops = CHART_COLORS.slice(0, 4)
  const bg = `conic-gradient(${stops[0]} 0 30%, ${stops[1]} 30% 55%, ${stops[2]} 55% 80%, ${stops[3]} 80% 100%)`
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ width: 88, height: 88, borderRadius: '50%', background: bg, position: 'relative' }}>
        {donut && <div style={{ position: 'absolute', inset: 26, borderRadius: '50%', background: C.card }} />}
      </div>
    </div>
  )
}

// ─── The registry ────────────────────────────────────────────────────────────
export const COMPONENT_REGISTRY = [
  // ── Metrics & KPIs ──────────────────────────────────────────────────────
  {
    id: 'metric', label: 'Single Metric', category: 'Metrics & KPIs',
    icon: 'M3 3v18h18M7 14l3-3 4 4 5-6',
    dataSource: 'report', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', label: 'records' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD, { key: 'label', label: 'Caption', type: 'text', placeholder: 'records' }],
    Preview: ({ config }) => previewBox((<>
      <div style={{ fontSize: 38, fontWeight: 700, color: C.textPrimary, lineHeight: 1 }}>1,248</div>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{config.label || 'records'}</div>
    </>), { center: true }),
  },
  {
    id: 'gauge', label: 'Gauge', category: 'Goal & Progress',
    icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2',
    dataSource: 'report', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', target: 100 },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD, { key: 'target', label: 'Target', type: 'number', min: 0 }],
    Preview: ({ config }) => previewBox((<>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.textPrimary }}>68 / {config.target ?? 100}</div>
      <div style={{ width: '80%', height: 10, borderRadius: 5, background: C.borderDark, overflow: 'hidden' }}>
        <div style={{ width: '68%', height: '100%', background: C.emerald }} />
      </div>
    </>), { center: true }),
  },

  // ── Charts ───────────────────────────────────────────────────────────────
  {
    id: 'bar', label: 'Bar Chart', category: 'Charts',
    icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', sort_by: 'value_desc', limit: 20, orientation: 'horizontal' },
    configSchema: [
      GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'orientation', label: 'Orientation', type: 'select', options: [
        { value: 'horizontal', label: 'Horizontal (ranked)' },
        { value: 'vertical',   label: 'Vertical' },
      ] },
      SORT_FIELD, LIMIT_FIELD,
    ],
    Preview: ({ config }) => previewBox(fakeBars(config.orientation === 'vertical')),
  },
  {
    id: 'line', label: 'Line Chart', category: 'Charts',
    icon: 'M3 17l5-6 4 3 6-8M3 21h18',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', sort_by: 'name', limit: 20 },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, SORT_FIELD, LIMIT_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <polyline points="0,50 20,30 40,38 60,15 80,25 100,8" fill="none" stroke={C.emerald} strokeWidth="2.5" />
      </svg>
    )),
  },
  {
    id: 'pie', label: 'Pie Chart', category: 'Charts',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM12 2v10l8 4',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8 },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD],
    Preview: () => previewBox(fakePie(false)),
  },
  {
    id: 'donut', label: 'Donut Chart', category: 'Charts',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 6a4 4 0 100 8 4 4 0 000-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8 },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD],
    Preview: () => previewBox(fakePie(true)),
  },
  {
    id: 'funnel', label: 'Funnel', category: 'Charts',
    icon: 'M3 4h18l-7 8v6l-4 2v-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8 },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'center', height: '100%' }}>
        {[100, 76, 52, 30].map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: 12, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 2 }} />
        ))}
      </div>
    )),
  },

  // ── Tables & lists ─────────────────────────────────────────────────────────
  {
    id: 'table', label: 'Table', category: 'Tables & Lists',
    icon: 'M3 5h18M3 12h18M3 19h18M9 5v14M15 5v14',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 2 },
    defaultConfig: {},
    configSchema: [{ key: 'row_limit', label: 'Row limit', type: 'number', min: 1, max: 200, help: 'Rows shown in the tile before scroll.' }],
    Preview: () => previewBox((
      <div style={{ width: '100%' }}>
        {[0, 1, 2, 3].map(r => (
          <div key={r} style={{ display: 'flex', gap: 6, padding: '5px 0', borderBottom: `1px solid ${C.border}` }}>
            {[40, 25, 20].map((w, c) => (
              <div key={c} style={{ width: `${w}%`, height: 8, background: r === 0 ? C.borderDark : C.cardSecondary, borderRadius: 2 }} />
            ))}
          </div>
        ))}
      </div>
    )),
  },
  {
    id: 'ranked_list', label: 'Ranked List', category: 'Tables & Lists',
    icon: 'M4 6h10M4 12h16M4 18h7M18 6l3 0M16 18l5 0',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', sort_by: 'value_desc', limit: 20 },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD],
    Preview: () => previewBox((
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {[['Dane', 90], ['Milwaukee', 64], ['Brown', 48], ['Rock', 30]].map(([n, w], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '40% 1fr auto', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
            <div style={{ height: 7, background: C.cardSecondary, borderRadius: 4 }}>
              <div style={{ width: `${w}%`, height: '100%', background: C.emerald, borderRadius: 4 }} />
            </div>
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: C.textPrimary }}>{w}</span>
          </div>
        ))}
      </div>
    )),
  },

  // ── Content & layout ─────────────────────────────────────────────────────
  {
    id: 'heading', label: 'Heading', category: 'Content & Layout',
    icon: 'M6 4v16M18 4v16M6 12h12',
    dataSource: 'none', defaultSize: { w: 12, h: 1 }, minSize: { w: 2, h: 1 },
    defaultConfig: { text: 'Section heading', align: 'left' },
    configSchema: [
      { key: 'text', label: 'Text', type: 'text', placeholder: 'Section heading' },
      { key: 'align', label: 'Align', type: 'select', options: [
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' },
      ] },
    ],
    Preview: ({ config }) => (
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%',
        justifyContent: config.align === 'center' ? 'center' : config.align === 'right' ? 'flex-end' : 'flex-start' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>{config.text || 'Section heading'}</span>
      </div>
    ),
  },
  {
    id: 'rich_text', label: 'Rich Text', category: 'Content & Layout',
    icon: 'M4 6h16M4 10h16M4 14h10M4 18h7',
    dataSource: 'none', defaultSize: { w: 4, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { content: 'Add notes, instructions, or context here.' },
    configSchema: [{ key: 'content', label: 'Content', type: 'textarea', placeholder: 'Markdown / rich text…' }],
    Preview: ({ config }) => (
      <div style={{ fontSize: 13, color: C.textSecondary, lineHeight: 1.5, overflow: 'hidden' }}>
        {config.content || 'Add notes, instructions, or context here.'}
      </div>
    ),
  },
  {
    id: 'spacer', label: 'Spacer / Divider', category: 'Content & Layout',
    icon: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4',
    dataSource: 'none', defaultSize: { w: 12, h: 1 }, minSize: { w: 1, h: 1 },
    defaultConfig: { divider: true },
    configSchema: [{ key: 'divider', label: 'Show divider line', type: 'boolean' }],
    Preview: ({ config }) => (
      <div style={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%' }}>
        {config.divider !== false
          ? <div style={{ width: '100%', height: 1, background: C.borderDark }} />
          : <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>Spacer</span>}
      </div>
    ),
  },
]

// ─── Lookup helpers ──────────────────────────────────────────────────────────
const BY_ID = Object.fromEntries(COMPONENT_REGISTRY.map(e => [e.id, e]))

export function getComponent(id) {
  return BY_ID[id] || null
}

// Categories in registry order, each with its components — drives the palette.
export function getPaletteCategories() {
  const seen = []
  const map = new Map()
  for (const e of COMPONENT_REGISTRY) {
    if (!map.has(e.category)) { map.set(e.category, []); seen.push(e.category) }
    map.get(e.category).push(e)
  }
  return seen.map(cat => ({ category: cat, components: map.get(cat) }))
}

// Initial widget_config for a newly-placed component (deep-ish clone so two
// instances don't share a mutable object).
export function defaultConfigFor(id) {
  const e = BY_ID[id]
  return e ? JSON.parse(JSON.stringify(e.defaultConfig || {})) : {}
}

// Whether a field descriptor should render, given the current config (honors
// `dependsOn`). Kept here so both the inspector and any validation share it.
export function fieldVisible(descriptor, config) {
  const dep = descriptor.dependsOn
  if (!dep) return true
  const v = config?.[dep.key]
  if ('equals' in dep)    return v === dep.equals
  if ('notEquals' in dep) return v !== dep.notEquals
  return !!v
}
