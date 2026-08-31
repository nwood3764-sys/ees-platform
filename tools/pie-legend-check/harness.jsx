// Pie legibility harness — NOT shipped.
//
// Renders the REAL pie widget with the data that made Nicholas say "you can't
// read anything": five property-owner names, two of them long enough to be
// clipped to an em dash by the old leader-lined labels.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetBody } from '../../src/modules/DashboardWidgetView'

const rows = [
  { name: 'Lutheran Social Services of Wisconsin and Upper Michigan, Inc.', value: 13 },
  { name: 'FOUNDER 3 MANAGEMENT COMPANY', value: 11 },
  { name: 'Rocky Mount Housing Authority', value: 7 },
  { name: 'Community Management Corporation', value: 3 },
  { name: 'Housing Authority of the City of Rocky Mount', value: 3 },
]
const result = {
  rows: rows.map((r, i) => ({ id: `r${i}`, owner: r.name })),
  columns: [{ name: 'owner', label: 'Property Owner' }],
  aggregated: rows,
  primaryObject: 'enrollments',
}

const widget = (config) => ({
  dw_widget_type: 'pie',
  dw_widget_config: { measure_type: 'count', group_by: 'owner', ...config },
})

function Tile({ title, config, id }) {
  return (
    <div data-case={id} style={{ width: 560, height: 320, margin: 24, background: '#fff',
      border: '1px solid #e4e9f2', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e4e9f2', background: '#f7f9fc',
        fontSize: 13, fontWeight: 600, color: '#0d1a2e' }}>{title}</div>
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <WidgetBody widget={widget(config)} result={result} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <div>
    <Tile id="right"  title="Enrollments By Property Owner — legend right"  config={{ legend_position: 'right' }} />
    <Tile id="bottom" title="Same data — legend bottom (the old layout)"    config={{ legend_position: 'bottom' }} />
  </div>
)
