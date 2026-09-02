// Chart audit harness — NOT shipped.
//
// Renders every data-bearing widget type at real tile sizes with real-shaped
// LEAP data, so the audit is done by LOOKING at them. The pie and funnel were
// both fixed only after being photographed; reading the option objects had
// missed what was obvious on screen.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetBody } from '../../src/modules/DashboardWidgetView'

// Real enrollment statuses and property owners — long names on purpose, because
// short fake labels hide every truncation defect.
const CATS = [
  { name: 'Enrollment To Be Verified', value: 23 },
  { name: 'Enrollment Approved', value: 11 },
  { name: 'Enrollment Submitted To Program', value: 7 },
  { name: 'Enrollment Income Qualification In Progress', value: 4 },
  { name: 'Enrollment To Be Prepared', value: 3 },
  { name: 'Enrollment Withdrawn', value: 2 },
]
const rows = CATS.map((c, i) => ({ id: `r${i}`, status: c.name, amount: c.value * 4200 }))
const result = {
  rows, columns: [
    { name: 'status', label: 'Status' },
    { name: 'amount', label: 'Requested Incentive', type: 'currency' },
  ],
  aggregated: CATS.map(c => ({ ...c, rawValue: c.name })),
  aggregated2d: CATS.slice(0, 4).flatMap(c =>
    ['Wisconsin', 'North Carolina', 'Michigan'].map((s, j) => ({
      name: c.name, series: s, value: Math.max(1, Math.round(c.value / (j + 1.4))),
    }))),
  aggregatedTime: Array.from({ length: 12 }, (_, i) => ({
    bucket: `2026-${String(i + 1).padStart(2, '0')}-01`,
    name: `2026-${String(i + 1).padStart(2, '0')}-01`,
    value: 8 + Math.round(14 * Math.sin(i / 2)) + i,
  })),
  aggregatedSingle: 41,
  primaryObject: 'enrollments',
  name: 'Enrollments by Status',
}

const CFG = { measure_type: 'count', group_by: 'status', series_by: 'state', date_field: 'created_at',
              measure_field: 'amount', number_format: 'number', target: 60 }

// The widgets the runner sends down the single-aggregate path get exactly what
// that path returns — no rows.
const SINGLE = new Set(['metric','gauge','kpi','rating','speedometer','bullet','progress_ring'])

function Tile({ type, w = 460, h = 300, config = {} }) {
  return (
    <div data-case={type} style={{ width: w, height: h, background: '#fff', border: '1px solid #e4e9f2',
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e4e9f2', background: '#f7f9fc',
        fontSize: 12, fontWeight: 600, color: '#0d1a2e' }}>{type}</div>
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <WidgetBody widget={{ dw_widget_type: type, dw_widget_config: { ...CFG, ...config } }}
          result={SINGLE.has(type) ? AGG_ONLY : result} />
      </div>
    </div>
  )
}

const AGG_ONLY = { aggregatedSingle: 41, primaryObject: 'enrollments', name: 'Enrollments' }

const TYPES = [
  'bar','line','area','stacked_bar','clustered_bar','stacked_bar_100','combo','pareto',
  'histogram','scatter','waterfall','heatmap','treemap','rose','radar','sunburst',
  'box_plot','calendar_heatmap','matrix','ranked_list','table',
  'metric','kpi','stat','gauge','speedometer','bullet','progress_ring','rating','multi_row_card',
]

createRoot(document.getElementById('root')).render(
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16, width: 1000 }}>
    {TYPES.map(t => <Tile key={t} type={t} />)}
  </div>
)
