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
// WHAT a data label says, not merely whether there is one. The boolean above
// stays for every widget already saved with it; this wins when it is set.
// (Nicholas, 2026-08-31: "I need to be able to turn on percentages, count, all
// of this stuff.")
const DATA_LABEL_MODE_FIELD = {
  key: 'data_label_mode', label: 'Data labels', type: 'select',
  options: [
    { value: 'auto',          label: 'Default for this chart' },
    { value: 'value',         label: 'Value' },
    { value: 'percent',       label: 'Percentage' },
    { value: 'value_percent', label: 'Value and percentage' },
    { value: 'none',          label: 'None' },
  ],
}
const LEGEND_FIELD      = { key: 'show_legend', label: 'Show legend', type: 'boolean' }
// Where the legend sits. Right by default: a bottom legend in a tile-height
// widget collapses into a one-item-at-a-time pager, and a pie's categories are
// exactly the thing the reader needs to see all of at once.
const LEGEND_POSITION_FIELD = {
  key: 'legend_position', label: 'Legend position', type: 'select',
  options: [
    { value: 'right',  label: 'Right (recommended)' },
    { value: 'bottom', label: 'Bottom' },
  ],
  dependsOn: { key: 'show_legend', notEquals: false },
}
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
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, show_legend: true, legend_position: 'right', number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABEL_MODE_FIELD, LEGEND_FIELD, LEGEND_POSITION_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox(fakePie(false)),
  },
  {
    id: 'donut', label: 'Donut Chart', category: 'Charts',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 6a4 4 0 100 8 4 4 0 000-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, show_legend: true, legend_position: 'right', number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABEL_MODE_FIELD, LEGEND_FIELD, LEGEND_POSITION_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
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

  // ── Goal & progress family ───────────────────────────────────────────────
  {
    id: 'speedometer', label: 'Speedometer Gauge', category: 'Goal & Progress',
    icon: 'M12 4a9 9 0 019 9M12 4a9 9 0 00-9 9M12 4v2M4.6 8.6l1.5 1.5M19.4 8.6l-1.5 1.5M12 13l4-4M12 15a2 2 0 100-4',
    dataSource: 'report', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', target: 100, number_format: 'number' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'target', label: 'Target', type: 'number', min: 0 },
      { key: 'cond_low', label: 'Sky band below', type: 'number', help: 'Segment breakpoints: sky below this, amber between, emerald above. Defaults to thirds of the scale.' },
      { key: 'cond_high', label: 'Emerald band at or above', type: 'number' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 62" style={{ width: '100%', height: '100%' }}>
        <path d="M14 52 A40 40 0 0 1 38 17" fill="none" stroke={C.sky} strokeWidth="9" />
        <path d="M40 16 A40 40 0 0 1 66 18" fill="none" stroke="#e8a949" strokeWidth="9" />
        <path d="M68 19 A40 40 0 0 1 87 52" fill="none" stroke={C.emerald} strokeWidth="9" />
        <line x1="50" y1="52" x2="72" y2="30" stroke="#1e466b" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="50" cy="52" r="5" fill="#1e466b" stroke="#fff" strokeWidth="2" />
      </svg>
    )),
  },
  {
    id: 'bullet', label: 'Bullet / Linear Gauge', category: 'Goal & Progress',
    icon: 'M3 9h18v6H3zM3 12h11M17 8v8',
    dataSource: 'report', defaultSize: { w: 4, h: 2 }, minSize: { w: 2, h: 1 },
    defaultConfig: { measure_type: 'count', target: 100, number_format: 'number' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'target', label: 'Target', type: 'number', min: 0 },
      { key: 'label', label: 'Caption', type: 'text' },
      { key: 'cond_low', label: 'Sky band below', type: 'number' },
      { key: 'cond_high', label: 'Emerald band at or above', type: 'number' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ position: 'relative', height: 16, borderRadius: 4, overflow: 'hidden', width: '100%' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          <div style={{ width: '33%', background: '#dcebfa' }} />
          <div style={{ width: '34%', background: '#f7e6c8' }} />
          <div style={{ flex: 1, background: '#d9f6e9' }} />
        </div>
        <div style={{ position: 'absolute', left: 0, top: 5, height: 6, width: '62%', background: '#1e466b' }} />
        <div style={{ position: 'absolute', left: '78%', top: 1, height: 14, width: 3, background: C.textPrimary }} />
      </div>
    ), { center: true }),
  },
  {
    id: 'progress_ring', label: 'Progress Ring', category: 'Goal & Progress',
    icon: 'M12 3a9 9 0 11-9 9M12 3v4M12 12l5-3',
    dataSource: 'report', defaultSize: { w: 3, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', target: 100, number_format: 'number' },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'target', label: 'Target', type: 'number', min: 0 },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ position: 'relative', width: 74, height: 74 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(${C.emerald} 0 68%, #e4e9f2 68% 100%)` }} />
        <div style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: C.textPrimary }}>68%</div>
      </div>
    ), { center: true }),
  },
  {
    id: 'rating', label: 'Rating', category: 'Goal & Progress',
    icon: 'M12 3l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16l-5.2 3 1.2-5.9-4.4-4 5.9-.7z',
    dataSource: 'report', defaultSize: { w: 3, h: 2 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'avg', rating_max: 5, number_format: 'number', decimals: 1 },
    configSchema: [MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'rating_max', label: 'Stars', type: 'number', min: 1, max: 10 },
      { key: 'label', label: 'Caption', type: 'text' },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', gap: 3 }}>
        {[1, 1, 1, 0.5, 0].map((f, i) => (
          <svg key={i} width="20" height="20" viewBox="0 0 24 24">
            <path fill={f >= 1 ? C.emerald : f > 0 ? C.emeraldMid || '#2aab72' : C.borderDark}
              d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" opacity={f > 0 ? 1 : 0.6} />
          </svg>
        ))}
      </div>
    ), { center: true }),
  },

  // ── More chart forms ─────────────────────────────────────────────────────
  {
    id: 'combo', label: 'Combo (Bar + Line)', category: 'Charts',
    icon: 'M4 20v-7h3v7M10 20V9h3v11M16 20v-5h3v5M3 8l5-3 5 4 7-6',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', measure2_type: 'count', sort_by: 'name', limit: 15, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD,
      MEASURE_FIELD, MEASURE_TARGET_FIELD,
      { key: 'measure_label', label: 'Bar series name', type: 'text', placeholder: 'Bars' },
      { key: 'measure2_type', label: 'Line measure', type: 'select', options: [
        { value: 'count', label: 'Count of records' }, { value: 'sum', label: 'Sum of' },
        { value: 'avg', label: 'Average of' }, { value: 'min', label: 'Min of' }, { value: 'max', label: 'Max of' },
      ] },
      { key: 'measure2_field', label: 'Line measure field', type: 'field', dependsOn: { key: 'measure2_type', notEquals: 'count' } },
      { key: 'measure2_label', label: 'Line series name', type: 'text', placeholder: 'Line' },
      { key: 'combo_dual_axis', label: 'Second axis for the line', type: 'boolean', default: false, help: 'Use when the two measures are on very different scales.' },
      SORT_FIELD, LIMIT_FIELD, LEGEND_FIELD, DATA_LABELS_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {[10, 30, 50, 70].map((x, i) => (
          <rect key={i} x={x} y={60 - [34, 46, 26, 40][i]} width="12" height={[34, 46, 26, 40][i]} rx="2" fill={C.emerald} />
        ))}
        <polyline points="16,30 36,18 56,26 76,10" fill="none" stroke="#1e466b" strokeWidth="2.5" />
      </svg>
    )),
  },
  {
    id: 'pareto', label: 'Pareto', category: 'Charts',
    icon: 'M4 20V6h4v14M10 20v-9h4v9M16 20v-5h4v5M3 14 Q10 5 21 3',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 12, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        {[[6, 44], [26, 30], [46, 20], [66, 12], [84, 7]].map(([x, h], i) => (
          <rect key={i} x={x} y={60 - h} width="13" height={h} rx="2" fill={C.emerald} />
        ))}
        <polyline points="12,26 32,14 52,8 72,4 90,2" fill="none" stroke="#1e466b" strokeWidth="2.5" />
      </svg>
    )),
  },
  {
    id: 'rose', label: 'Rose Chart', category: 'Charts',
    icon: 'M12 12L12 3a9 9 0 016.4 2.6zM12 12l6.4-6.4A9 9 0 0121 12zM12 12h9a9 9 0 01-9 9zM12 12v9a9 9 0 01-6.4-15.4z',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 8, show_data_labels: true, show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, DATA_LABELS_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 80" style={{ width: '100%', height: '100%' }}>
        <path d="M50 40 L50 6 A34 34 0 0 1 79 23 Z" fill={CHART_COLORS[0]} />
        <path d="M50 40 L74 26 A28 28 0 0 1 74 54 Z" fill={CHART_COLORS[1]} />
        <path d="M50 40 L67 58 A25 25 0 0 1 40 63 Z" fill={CHART_COLORS[2]} />
        <path d="M50 40 L38 58 A22 22 0 0 1 28 40 Z" fill={CHART_COLORS[3]} />
        <path d="M50 40 L32 36 A19 19 0 0 1 44 22 Z" fill={CHART_COLORS[4]} />
      </svg>
    )),
  },
  {
    id: 'radar', label: 'Radar', category: 'Charts',
    icon: 'M12 2l8.7 6.3-3.3 10.2H6.6L3.3 8.3zM12 2v16.5M20.7 8.3L6.6 18.5M3.3 8.3l14.1 10.2',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', show_legend: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LEGEND_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 80" style={{ width: '100%', height: '100%' }}>
        <polygon points="50,8 88,34 74,72 26,72 12,34" fill="none" stroke={C.borderDark} strokeWidth="1" />
        <polygon points="50,24 72,38 66,60 34,60 28,38" fill="none" stroke={C.border} strokeWidth="1" />
        <polygon points="50,14 80,36 66,66 32,62 20,36" fill={C.emerald} opacity="0.18" stroke={C.emerald} strokeWidth="2" />
        <polygon points="50,28 68,40 60,58 38,56 32,42" fill={C.sky} opacity="0.18" stroke={C.sky} strokeWidth="2" />
      </svg>
    )),
  },
  {
    id: 'sunburst', label: 'Sunburst', category: 'Charts',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 5a5 5 0 100 10 5 5 0 000-10zM12 2v5M22 12h-5M12 22v-5M4.9 4.9l3.5 3.5',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 10, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: `conic-gradient(${CHART_COLORS[0]} 0 22%, ${CHART_COLORS[1]} 22% 40%, ${CHART_COLORS[2]} 40% 62%, ${CHART_COLORS[3]} 62% 78%, ${CHART_COLORS[4]} 78% 100%)`, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', background: `conic-gradient(${CHART_COLORS[0]} 0 40%, ${CHART_COLORS[2]} 40% 100%)`, opacity: 0.75 }} />
          <div style={{ position: 'absolute', inset: 30, borderRadius: '50%', background: C.card }} />
        </div>
      </div>
    )),
  },
  {
    id: 'sankey', label: 'Sankey Flow', category: 'Charts',
    icon: 'M3 5h4v4H3zM3 15h4v4H3zM17 4h4v4h-4zM17 11h4v4h-4zM17 17h4v3h-4zM7 7c5 0 5-2 10-1M7 7c5 0 5 6 10 6M7 17c5 0 5 2 10 2',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { measure_type: 'count', limit: 12, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <rect x="4" y="6" width="6" height="22" rx="1" fill={CHART_COLORS[0]} />
        <rect x="4" y="34" width="6" height="18" rx="1" fill={CHART_COLORS[1]} />
        <rect x="90" y="4" width="6" height="14" rx="1" fill={CHART_COLORS[2]} />
        <rect x="90" y="24" width="6" height="18" rx="1" fill={CHART_COLORS[3]} />
        <path d="M10 8 C50 8 50 6 90 6 L90 16 C50 16 50 20 10 20 Z" fill={CHART_COLORS[0]} opacity="0.3" />
        <path d="M10 22 C50 22 50 28 90 28 L90 38 C50 38 50 30 10 28 Z" fill={CHART_COLORS[1]} opacity="0.3" />
        <path d="M10 36 C50 36 50 40 90 40 L90 42 C50 44 50 48 10 50 Z" fill={CHART_COLORS[1]} opacity="0.25" />
      </svg>
    )),
  },
  {
    id: 'calendar_heatmap', label: 'Calendar Heatmap', category: 'Charts',
    icon: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4M6 12h3v3H6zM11 12h3v3h-3zM16 16h3v3h-3z',
    dataSource: 'report', defaultSize: { w: 6, h: 3 }, minSize: { w: 4, h: 2 },
    defaultConfig: { measure_type: 'count', date_grain: 'day', number_format: 'number' },
    configSchema: [DATE_FIELD_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, NUMBER_FORMAT_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 2, height: '100%', alignContent: 'center' }}>
        {Array.from({ length: 36 }, (_, i) => {
          const t = Math.abs(Math.sin(i * 2.7))
          const c = t > 0.75 ? '#2aab72' : t > 0.5 ? C.emerald : t > 0.25 ? '#9fe8c9' : '#eefaf4'
          return <div key={i} style={{ paddingTop: '100%', background: c, borderRadius: 2 }} />
        })}
      </div>
    )),
  },
  {
    id: 'box_plot', label: 'Box Plot', category: 'Charts',
    icon: 'M6 4v4M6 8h4M8 8v8M4 16h8M8 16v4M16 2v5M14 7h4M16 7v9M14 16h4M16 16v4',
    dataSource: 'report', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 },
    defaultConfig: { limit: 10, number_format: 'number' },
    configSchema: [
      { key: 'value_field', label: 'Value field', type: 'field', help: 'Numeric column to summarize (min / quartiles / max).' },
      GROUP_BY_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <svg viewBox="0 0 100 60" style={{ width: '100%', height: '100%' }}>
        {[[20, 8, 18, 34, 50], [50, 14, 24, 38, 54], [80, 4, 16, 30, 44]].map(([x, t, q3, q1, b], i) => (
          <g key={i} stroke="#2aab72" strokeWidth="2" fill="#d9f6e9">
            <line x1={x} y1={t} x2={x} y2={q3} />
            <rect x={x - 9} y={q3} width="18" height={q1 - q3} rx="1" />
            <line x1={x - 9} y1={(q3 + q1) / 2} x2={x + 9} y2={(q3 + q1) / 2} />
            <line x1={x} y1={q1} x2={x} y2={b} />
          </g>
        ))}
      </svg>
    )),
  },
  {
    id: 'multi_row_card', label: 'Multi-Row Card', category: 'Metrics & KPIs',
    icon: 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z',
    dataSource: 'report', defaultSize: { w: 4, h: 3 }, minSize: { w: 2, h: 2 },
    defaultConfig: { measure_type: 'count', sort_by: 'value_desc', limit: 12, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, SORT_FIELD, LIMIT_FIELD, NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: '100%' }}>
        {[['412', 'Dane'], ['388', 'Milwaukee'], ['201', 'Rock'], ['167', 'Brown']].map(([v, n], i) => (
          <div key={i} style={{ background: C.cardSecondary, borderLeft: `3px solid ${C.emerald}`, borderRadius: 4, padding: '4px 7px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textPrimary }}>{v}</div>
            <div style={{ fontSize: 9, color: C.textMuted }}>{n}</div>
          </div>
        ))}
      </div>
    )),
  },

  // ── Tables & matrices ────────────────────────────────────────────────────
  {
    id: 'matrix', label: 'Matrix / Pivot', category: 'Tables & Lists',
    icon: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
    dataSource: 'report', defaultSize: { w: 6, h: 4 }, minSize: { w: 3, h: 2 },
    defaultConfig: { measure_type: 'count', limit: 30, highlight_cells: true, number_format: 'number' },
    configSchema: [GROUP_BY_FIELD, SERIES_BY_FIELD, MEASURE_FIELD, MEASURE_TARGET_FIELD, LIMIT_FIELD,
      { key: 'highlight_cells', label: 'Shade cells by value', type: 'boolean', default: true },
      NUMBER_FORMAT_FIELD, DECIMALS_FIELD],
    Preview: () => previewBox((
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, width: '100%' }}>
        {['', 'Q1', 'Q2', 'Q3', 'WI', '', '', '', 'NC', '', '', '', 'CO', '', '', ''].map((t, i) => {
          const isHead = i < 4 || i % 4 === 0
          const shades = ['#eefaf4', '#d9f6e9', '#bff0da', '#eefaf4', '#d9f6e9', '#eefaf4', '#bff0da', '#d9f6e9', '#eefaf4']
          return (
            <div key={i} style={{
              height: 14, borderRadius: 2, fontSize: 8.5, display: 'flex', alignItems: 'center', justifyContent: isHead ? 'flex-start' : 'center',
              paddingLeft: isHead ? 3 : 0, color: C.textSecondary, fontWeight: isHead ? 700 : 400,
              background: isHead ? C.cardSecondary : shades[(i * 3) % shades.length],
            }}>{t}</div>
          )
        })}
      </div>
    )),
  },

  // ── Filters & navigation ─────────────────────────────────────────────────
  {
    id: 'filter_picklist', label: 'Picklist Filter', category: 'Filters & Navigation',
    icon: 'M4 6h16M7 12h10M10 18h4',
    dataSource: 'report', defaultSize: { w: 3, h: 1 }, minSize: { w: 2, h: 1 },
    defaultConfig: {},
    configSchema: [{ key: 'filter_field', label: 'Filter field', type: 'field',
      help: 'Filters every widget whose report has this field. Values come from the data — nothing hardcoded.' }],
    Preview: () => previewBox((
      <div style={{ width: '100%', padding: '6px 9px', fontSize: 12, color: C.textSecondary, background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
        <span>All</span><span>▾</span>
      </div>
    ), { center: true }),
  },
  {
    id: 'filter_toggle', label: 'Toggle Filter', category: 'Filters & Navigation',
    icon: 'M4 8h6M4 16h6M14 6h6v4h-6zM14 14h6v4h-6z',
    dataSource: 'report', defaultSize: { w: 4, h: 1 }, minSize: { w: 2, h: 1 },
    defaultConfig: { max_options: 6 },
    configSchema: [
      { key: 'filter_field', label: 'Filter field', type: 'field' },
      { key: 'max_options', label: 'Max buttons', type: 'number', min: 2, max: 12 },
    ],
    Preview: () => previewBox((
      <div style={{ display: 'flex', gap: 5 }}>
        <span style={{ padding: '4px 10px', fontSize: 11, borderRadius: 99, background: '#eefaf4', color: '#2aab72', border: `1px solid ${C.emerald}` }}>All</span>
        <span style={{ padding: '4px 10px', fontSize: 11, borderRadius: 99, background: C.card, color: C.textSecondary, border: `1px solid ${C.borderDark}` }}>WI</span>
        <span style={{ padding: '4px 10px', fontSize: 11, borderRadius: 99, background: C.card, color: C.textSecondary, border: `1px solid ${C.borderDark}` }}>NC</span>
      </div>
    ), { center: true }),
  },
  {
    id: 'filter_date_range', label: 'Date Range Filter', category: 'Filters & Navigation',
    icon: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4M7 14h4M13 17h4',
    dataSource: 'report', defaultSize: { w: 4, h: 1 }, minSize: { w: 3, h: 1 },
    defaultConfig: {},
    configSchema: [{ key: 'filter_field', label: 'Date field', type: 'field',
      help: 'Widgets are filtered to records where this date falls in the picked range.' }],
    Preview: () => previewBox((
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
        <div style={{ flex: 1, padding: '5px 8px', fontSize: 11, color: C.textMuted, background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 6 }}>From</div>
        <span style={{ fontSize: 11, color: C.textMuted }}>to</span>
        <div style={{ flex: 1, padding: '5px 8px', fontSize: 11, color: C.textMuted, background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 6 }}>To</div>
      </div>
    ), { center: true }),
  },
  {
    id: 'link', label: 'Link', category: 'Filters & Navigation',
    icon: 'M10 14L21 3M21 3h-6M21 3v6M9 3H4v17h17v-5',
    dataSource: 'none', defaultSize: { w: 3, h: 1 }, minSize: { w: 2, h: 1 },
    defaultConfig: {},
    configSchema: [
      { key: 'link_label', label: 'Label', type: 'text', placeholder: 'Open Properties' },
      { key: 'link_url', label: 'URL or path', type: 'text', placeholder: '/properties or https://…' },
      { key: 'link_description', label: 'Description', type: 'text' },
    ],
    Preview: ({ config }) => previewBox((
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 6, background: '#eefaf4', border: `1px solid ${C.emerald}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="2"><path d="M10 14L21 3M21 3h-6M21 3v6M9 3H4v17h17v-5" /></svg>
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>{config.link_label || 'Link'}</span>
      </div>
    ), { center: true }),
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
