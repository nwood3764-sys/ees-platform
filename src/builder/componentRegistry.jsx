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
const NUMBER_FORMAT_FIELD = {
  key: 'number_format', label: 'Number format', type: 'select',
  options: [
    { value: 'number',   label: 'Number' },
    { value: 'currency', label: 'Currency (USD)' },
    { value: 'percent',  label: 'Percent' },
    { value: 'compact',  label: 'Compact (1.2K)' },
  ],
  help: 'Applied to data labels, tooltips, and axis values.',
}
const DECIMALS_FIELD = {
  key: 'decimals', label: 'Decimal places', type: 'number', min: 0, max: 4,
  dependsOn: { key: 'number_format', notEquals: 'compact' },
}
const DATA_LABELS_FIELD = { key: 'show_data_labels', label: 'Show data labels', type: 'boolean' }
const LEGEND_FIELD      = { key: 'show_legend', label: 'Show legend', type: 'boolean' }
const SERIES_BY_FIELD = {
  key: 'series_by', label: 'Series (split by)', type: 'field',
  help: 'Second grouping — its values become the stacked/clustered series.',
}
const DATE_FIELD_FIELD = {
  key: 'date_field', label: 'Date field', type: 'field',
  help: 'Date/timestamp column that drives the time axis.',
}
const DATE_GRAIN_FIELD = {
  key: 'date_grain', label: 'Time grain', type: 'select',
  options: [
    { value: 'day', label: 'Day' }, { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' },
    { value: 'year', label: 'Year' },
  ],
}
const REFERENCE_VALUE_FIELD = {
  key: 'reference_value', label: 'Reference line', type: 'number',
  help: 'Draws a dashed target line at this value on the measure axis.',
}
const REFERENCE_LABEL_FIELD = {
  key: 'reference_label', label: 'Reference line label', type: 'text',
  dependsOn: { key: 'reference_value' },
}
const X_AXIS_TITLE_FIELD = { key: 'x_axis_title', label: 'X axis title', type: 'text' }
const Y_AXIS_TITLE_FIELD = { key: 'y_axis_title', label: 'Y axis title', type: 'text' }
const COND_HIGH_FIELD = {
  key: 'cond_high', label: 'Emerald at or above', type: 'number',
  help: 'Conditional color: emerald at/above this value, amber between the two breakpoints, sky below the lower one.',
}
const COND_LOW_FIELD = { key: 'cond_low', label: 'Sky below', type: 'number' }

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
    defaultConfig: { measure_type: 'count', label: 'records', number_format: 'number' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD, { key: 'label', label: 'Caption', type: 'text', placeholder: 'records' }, NUMBER_FORMAT_FIELD, DECIMALS_FIELD, COND_HIGH_FIELD, COND_LOW_FIELD],
    Preview: ({ config }) => previewBox((<>
      <div style={{ fontSize: 38, fontWeight: 700, color: C.textPrimary, lineHeight: 1 }}>1,248</div>
      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{config.label || 'records'}</div>
    </>), { center: true }),
  },
  {
    id: 'gauge', label: 'Gauge', category: 'Goal & Progress',
    icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4v5l3 2',
    dataSource: 'report', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', target: 100, number_format: 'number' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD, { key: 'target', label: 'Target', type: 'number', min: 0 }, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
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
    defaultConfig: { measure_type: 'count', sort_by: 'value_desc', limit: 20, orientation: 'horizontal', show_data_labels: true, number_format: 'number' },
    configSchema: [
      GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'orientation', label: 'Orientation', type: 'select', options: [
        { value: 'horizontal', label: 'Horizontal (ranked)' },
        { value: 'vertical',   label: 'Vertical' },
      ] },
      SORT_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD,
      REFERENCE_VALUE_FIELD, REFERENCE_LABEL_FIELD, X_AXIS_TITLE_FIELD, Y_AXIS_TITLE_FIELD,
    ],
    Preview: ({ config }) => previewBox(fakeBars(config.orientation === 'vertical')),
  },
  {
    id: 'line', label: 'Line Chart', category: 'Charts',
    icon: 'M3 17l5-6 4 3 6-8M3 21h18',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', sort_by: 'name', limit: 20, show_data_labels: false, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, SORT_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD, REFERENCE_VALUE_FIELD, REFERENCE_LABEL_FIELD, X_AXIS_TITLE_FIELD, Y_AXIS_TITLE_FIELD],
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
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox(fakePie(false)),
  },
  {
    id: 'donut', label: 'Donut Chart', category: 'Charts',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 6a4 4 0 100 8 4 4 0 000-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox(fakePie(true)),
  },
  {
    id: 'funnel', label: 'Funnel', category: 'Charts',
    icon: 'M3 4h18l-7 8v6l-4 2v-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
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
    configSchema: [
      { key: 'columns', label: 'Columns', type: 'multi-field', help: 'Which report columns show, left to right. Empty = all.' },
      { key: 'table_sort_by', label: 'Sort by', type: 'field' },
      { key: 'table_sort_dir', label: 'Sort direction', type: 'select', options: [
        { value: 'desc', label: 'High → low / Z → A' }, { value: 'asc', label: 'Low → high / A → Z' },
      ], dependsOn: { key: 'table_sort_by' } },
      { key: 'row_limit', label: 'Row limit', type: 'number', min: 1, max: 200, help: 'Rows shown in the tile before scroll.' },
      { key: 'show_totals', label: 'Totals row', type: 'boolean', default: false, help: 'Sums every numeric column across the shown rows.' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD,
    ],
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
    defaultConfig: { measure_type: 'count', sort_by: 'value_desc', limit: 20, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
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

  // ── KPI & stat cards (single-aggregate + time shapes) ────────────────────
  {
    id: 'kpi', label: 'KPI Card', category: 'Metrics & KPIs',
    icon: 'M4 4h16v16H4zM4 14h16M8 9l3 3 5-5',
    dataSource: 'report', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', target: 100, number_format: 'number' },
    configSchema: [
      MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'target', label: 'Target', type: 'number', min: 0, help: 'Goal the value is measured against.' },
      { key: 'label', label: 'Caption', type: 'text', placeholder: 'vs target' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD, COND_HIGH_FIELD, COND_LOW_FIELD,
    ],
    Preview: ({ config }) => previewBox((<>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 700, color: C.textPrimary, lineHeight: 1 }}>82</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: C.emerald, border: `1px solid ${C.emerald}`, borderRadius: 99, padding: '2px 7px' }}>82% of {config.target ?? 100}</span>
      </div>
      <div style={{ width: '90%', height: 7, borderRadius: 4, background: C.cardSecondary, overflow: 'hidden' }}>
        <div style={{ width: '82%', height: '100%', background: C.emerald }} />
      </div>
    </>), { center: true }),
  },
  {
    id: 'stat', label: 'Stat + Sparkline', category: 'Metrics & KPIs',
    icon: 'M4 5h9M4 9h5M3 19l4-5 3 2 5-7 4 4',
    dataSource: 'report', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', label: 'records', date_grain: 'month', number_format: 'number' },
    configSchema: [
      MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'label', label: 'Caption', type: 'text', placeholder: 'records' },
      DATE_FIELD_FIELD, DATE_GRAIN_FIELD,
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD, COND_HIGH_FIELD, COND_LOW_FIELD,
    ],
    Preview: () => previewBox((<>
      <div style={{ fontSize: 28, fontWeight: 700, color: C.textPrimary, lineHeight: 1 }}>1,248</div>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" style={{ width: '100%', height: 26 }}>
        <polyline points="0,20 18,14 36,17 54,9 72,12 100,4" fill="none" stroke={C.emerald} strokeWidth="2" />
      </svg>
    </>)),
  },

  // ── Series charts (category × series pivot) ──────────────────────────────
  {
    id: 'stacked_bar', label: 'Stacked Bar', category: 'Charts',
    icon: 'M4 20V8M4 14h4V8H4M10 20V4M10 12h4V4h-4M16 20v-9M16 16h4v-5h-4M2 20h20',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 12, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'orientation', label: 'Orientation', type: 'select', options: [
        { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' },
      ] },
      LIMIT_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: '100%', padding: '6px 2px' }}>
        {[[45, 30, 15], [30, 25, 20], [55, 20, 10], [25, 15, 25]].map((seg, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2 }}>
            {seg.map((h, j) => (
              <div key={j} style={{ height: `${h}%`, background: CHART_COLORS[j], borderRadius: j === 0 ? '3px 3px 0 0' : 0 }} />
            ))}
          </div>
        ))}
      </div>
    )),
  },
  {
    id: 'clustered_bar', label: 'Clustered Bar', category: 'Charts',
    icon: 'M3 20V10M7 20V6M13 20v-8M17 20V4M2 20h20',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 10, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'orientation', label: 'Orientation', type: 'select', options: [
        { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' },
      ] },
      LIMIT_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: '100%', padding: '6px 2px' }}>
        {[[80, 55], [60, 75], [90, 40]].map((pair, i) => (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {pair.map((h, j) => (
              <div key={j} style={{ flex: 1, height: `${h}%`, background: CHART_COLORS[j], borderRadius: '3px 3px 0 0' }} />
            ))}
          </div>
        ))}
      </div>
    )),
  },
  {
    id: 'stacked_bar_100', label: '100% Stacked Bar', category: 'Charts',
    icon: 'M4 20V4h4v16M10 20V4h4v16M16 20V4h4v16M4 12h16',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 12, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'orientation', label: 'Orientation', type: 'select', options: [
        { value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' },
      ] },
      LIMIT_FIELD, LEGEND_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, height: '100%', padding: '6px 2px' }}>
        {[[50, 30, 20], [25, 45, 30], [40, 20, 40]].map((seg, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {seg.map((h, j) => (
              <div key={j} style={{ height: `${h}%`, background: CHART_COLORS[j], borderRadius: j === 0 ? '3px 3px 0 0' : j === 2 ? '0 0 3px 3px' : 0 }} />
            ))}
          </div>
        ))}
      </div>
    )),
  },
  {
    id: 'area', label: 'Area Chart (time)', category: 'Charts',
    icon: 'M3 17l5-6 4 3 6-8v14H3zM3 21h18',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', date_grain: 'month', show_legend: true, number_format: 'number' },
    configSchema: [DATE_FIELD_FIELD, DATE_GRAIN_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD,
      LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD, REFERENCE_VALUE_FIELD, REFERENCE_LABEL_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <polygon points="0,50 20,32 40,40 60,18 80,26 100,10 100,60 0,60" fill={C.emerald} opacity="0.18" />
        <polyline points="0,50 20,32 40,40 60,18 80,26 100,10" fill="none" stroke={C.emerald} strokeWidth="2.5" />
      </svg>
    )),
  },
  {
    id: 'pyramid', label: 'Pyramid', category: 'Charts',
    icon: 'M12 3l9 18H3zM7.5 12h9M5.5 16.5h13',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, justifyContent: 'center', height: '100%' }}>
        {[28, 52, 76, 100].map((w, i) => (
          <div key={i} style={{ width: `${w}%`, height: 12, background: CHART_COLORS[i % CHART_COLORS.length], borderRadius: 2 }} />
        ))}
      </div>
    )),
  },
  {
    id: 'treemap', label: 'Treemap', category: 'Charts',
    icon: 'M3 3h18v18H3zM3 12h11M14 3v18M14 8h7',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 12, show_data_labels: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gridTemplateRows: '3fr 2fr', gap: 2, height: '100%', padding: 2 }}>
        <div style={{ background: CHART_COLORS[0], borderRadius: 2 }} />
        <div style={{ background: CHART_COLORS[1], borderRadius: 2 }} />
        <div style={{ background: CHART_COLORS[2], borderRadius: 2 }} />
        <div style={{ background: CHART_COLORS[3], borderRadius: 2 }} />
      </div>
    )),
  },
  {
    id: 'waterfall', label: 'Waterfall', category: 'Charts',
    icon: 'M3 20V16h4v4M8 16v-6h4v6M13 10V6h4v4M18 20V4h3M2 20h20',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'sum', sort_by: 'value_desc', limit: 10, show_data_labels: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, SORT_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: '100%', padding: '6px 2px' }}>
        {[{ b: 0, h: 40 }, { b: 40, h: 22 }, { b: 62, h: 16 }, { b: 0, h: 78 }].map((s, i) => (
          <div key={i} style={{ flex: 1, height: '100%', position: 'relative' }}>
            <div style={{ position: 'absolute', bottom: `${s.b}%`, height: `${s.h}%`, width: '100%', background: i === 3 ? CHART_COLORS[2] : CHART_COLORS[0], borderRadius: '3px 3px 0 0' }} />
          </div>
        ))}
      </div>
    )),
  },
  {
    id: 'heatmap', label: 'Heatmap', category: 'Charts',
    icon: 'M3 3h6v6H3zM10 3h6v6h-6zM3 10h6v6H3zM10 10h6v6h-6zM17 3h4v13h-4zM3 17h18v4H3z',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 15, show_data_labels: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2, height: '100%', padding: 2 }}>
        {['#eefaf4', '#9fe8c9', C.emerald, '#9fe8c9', '#eefaf4', C.emerald, '#eefaf4', '#9fe8c9', C.emerald, '#2aab72',
          '#9fe8c9', C.emerald, '#eefaf4', '#2aab72', '#9fe8c9'].map((c, i) => (
          <div key={i} style={{ background: c, borderRadius: 2 }} />
        ))}
      </div>
    )),
  },
  {
    id: 'scatter', label: 'Scatter Plot', category: 'Charts',
    icon: 'M3 3v18h18M8 14a1 1 0 100-2M12 9a1 1 0 100-2M16 13a1 1 0 100-2M18 6a1 1 0 100-2',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { number_format: 'number' },
    configSchema: [
      { key: 'x_field', label: 'X field', type: 'field', help: 'Numeric column for the horizontal axis.' },
      { key: 'y_field', label: 'Y field', type: 'field', help: 'Numeric column for the vertical axis.' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD, X_AXIS_TITLE_FIELD, Y_AXIS_TITLE_FIELD,
    ],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" style={{ width: '100%', height: '100%' }}>
        {[[12, 45], [25, 38], [35, 42], [48, 26], [58, 30], [70, 18], [82, 22], [90, 10]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="4" fill={C.sky} stroke="#fff" strokeWidth="1.5" />
        ))}
      </svg>
    )),
  },
  {
    id: 'histogram', label: 'Histogram', category: 'Charts',
    icon: 'M3 20V12h4v8M7 20V6h4v14M11 20V9h4v11M15 20V14h4v6M2 20h20',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { bin_count: 10, number_format: 'number' },
    configSchema: [
      { key: 'value_field', label: 'Value field', type: 'field', help: 'Numeric column to bin into a distribution.' },
      { key: 'bin_count', label: 'Bins', type: 'number', min: 3, max: 30 },
      DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD,
    ],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: '100%', padding: '6px 2px' }}>
        {[15, 35, 60, 85, 100, 80, 55, 30, 14, 6].map((h, i) => (
          <div key={i} style={{ flex: 1, height: `${h}%`, background: C.emerald, borderRadius: '2px 2px 0 0' }} />
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
  {
    id: 'image', label: 'Image', category: 'Content & Layout',
    icon: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 5M8 9a1 1 0 100-2 1 1 0 000 2z',
    dataSource: 'none', defaultSize: { w: 3, h: 3 }, minSize: { w: 1, h: 1 },
    defaultConfig: { image_fit: 'contain' },
    configSchema: [
      { key: 'image_url', label: 'Image URL', type: 'text', placeholder: 'https://…' },
      { key: 'image_fit', label: 'Fit', type: 'select', options: [
        { value: 'contain', label: 'Contain (whole image)' }, { value: 'cover', label: 'Cover (fill tile)' },
      ] },
    ],
    Preview: ({ config }) => config.image_url
      ? <img src={config.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: config.image_fit || 'contain' }} />
      : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', border: `1px dashed ${C.borderDark}`, borderRadius: 6 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="1.5">
            <path d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 5M8 9a1 1 0 100-2 1 1 0 000 2z" />
          </svg>
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

// Config carried across an in-place type change: start from the new type's
// defaults, then keep the current value for every key the new type's schema
// also declares — so report binding plus group-by / measure / sort / limit
// survive a bar → pie → line conversion, while keys the new type doesn't
// understand are dropped instead of lingering in dw_widget_config.
export function convertConfigForType(config, newTypeId) {
  const entry = BY_ID[newTypeId]
  if (!entry) return { ...(config || {}) }
  const next = JSON.parse(JSON.stringify(entry.defaultConfig || {}))
  const keys = new Set((entry.configSchema || []).map(d => d.key))
  for (const [k, v] of Object.entries(config || {})) {
    if (keys.has(k) && v !== undefined && v !== null && v !== '') next[k] = v
  }
  return next
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
