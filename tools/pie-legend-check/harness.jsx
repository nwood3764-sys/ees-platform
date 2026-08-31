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
  { name: 'CITY OF MADISON CDA', value: 2 },
  { name: 'JES Holdings, LLC', value: 1 },
  { name: 'Westminster Company', value: 1 },
]
const result = {
  rows: rows.map((r, i) => ({ id: `r${i}`, owner: r.name })),
  columns: [{ name: 'owner', label: 'Property Owner' }],
  aggregated: rows,
  primaryObject: 'enrollments',
}

const widget = (config, kind) => ({
  dw_widget_type: kind,
  dw_widget_config: { measure_type: 'count', group_by: 'owner', ...config },
})

function Tile({ title, config, id, width = 560, height = 320, donut = false, kind }) {
  const type = kind || (donut ? 'donut' : 'pie')
  return (
    <div data-case={id} style={{ width, height, margin: 24, background: '#fff',
      border: '1px solid #e4e9f2', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e4e9f2', background: '#f7f9fc',
        fontSize: 13, fontWeight: 600, color: '#0d1a2e' }}>{title}</div>
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <WidgetBody widget={widget(config, type)} result={result} />
      </div>
    </div>
  )
}

// Real tile sizes, because the defect Nicholas photographed only appears at a
// NARROW one: the legend sat on top of the circle. A single convenient width
// proves nothing.
// Real tile sizes, because the defects Nicholas photographed only appear at
// particular ones: at a NARROW tile the legend used to jump under the chart
// even when he had chosen "right" — the editor and the rendered page then
// disagreed — and at a WIDE one the legend stayed a fixed 210px so the names
// stayed truncated however much room it was given.
createRoot(document.getElementById('root')).render(
  <div>
    <Tile id="wide"   width={620} height={320} title="Wide (620) — legend beside, grows with the tile" config={{}} />
    <Tile id="xwide"  width={900} height={320} title="Wider (900) — the legend gets wider too"         config={{}} />
    <Tile id="narrow" width={430} height={320} title="Narrow (430) — 'right' STAYS right"              config={{}} />
    <Tile id="tiny"   width={340} height={320} title="Tiny (340) — 'right' still stays right"          config={{}} />
    <Tile id="auto"   width={340} height={320} title="Tiny (340), position 'auto' — drops below"       config={{ legend_position: 'auto' }} />
    <Tile id="numsleft" width={620} height={320} title="Numbers before the name"                       config={{ legend_value_position: 'left' }} />
    <Tile id="novalue"  width={620} height={320} title="Percentage only"                               config={{ legend_show_value: false }} />
    <Tile id="nopct"    width={620} height={320} title="Count only"                                    config={{ legend_show_percent: false }} />
    <Tile id="namesonly" width={620} height={320} title="Names only — both numbers off"                config={{ legend_show_value: false, legend_show_percent: false }} />
    <Tile id="donut"  width={620} height={320} title="Donut, wide"                                     config={{}} donut />
    <Tile id="bottom" width={620} height={320} title="Legend bottom, by choice"                        config={{ legend_position: 'bottom' }} />
    <Tile id="funnel"     width={620} height={340} title="Funnel — labels inside, names in the legend" config={{}} kind="funnel" />
    <Tile id="funnelnarrow" width={430} height={340} title="Funnel, narrow"                            config={{}} kind="funnel" />
  </div>
)
