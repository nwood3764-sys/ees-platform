// Scroll-stability harness — NOT shipped.
//
// Mounts the REAL widget renderers and exposes each scroll box on window so a
// browser driver can scroll it and photograph the header band. The assertion is
// not "the header has a background" — it is "the header band's pixels do not
// change as the rows move underneath it", which is what Nicholas actually sees
// when it breaks, whatever the mechanism.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { C } from '../../src/data/constants'
import { WidgetBody } from '../../src/modules/DashboardWidgetView'
import { TabularLayout, SummaryLayout, MatrixLayout } from '../../src/modules/ReportRunner'
import { ListView } from '../../src/components/ListView'

const columns = [
  { name: 'enrollment_status', label: 'Status' },
  { name: 'property_name',     label: 'Property Name' },
  { name: 'building_name',     label: 'Building' },
]
const rows = Array.from({ length: 40 }, (_, i) => ({
  id: `r${i}`,
  enrollment_status: 'Enrollment To Be Prepared',
  property_name: ['2 Waunona Woods Court - Madison', '5513 North Hopkins Street - Milwaukee', '7400 West Center Street - Wauwatosa'][i % 3],
  building_name: ['2 Waunona Woods Court', '5513 North Hopkins Street', '7400 West Center Street'][i % 3],
}))
// Numeric rows so the totals variant has something to total (and a sticky tfoot).
const numRows = Array.from({ length: 40 }, (_, i) => ({
  id: `n${i}`, enrollment_status: `Unit ${i + 1}`, property_name: String(1000 + i * 37), building_name: String(250 + i),
}))
const aggregated2d = []
for (const g of ['Madison', 'Milwaukee', 'Wauwatosa', 'Janesville', 'Rocky Mount', 'Huntersville', 'Denver', 'Detroit', 'Fort Wayne', 'Green Bay', 'Kenosha', 'Racine']) {
  for (const s of ['To Be Prepared', 'Submitted', 'Approved', 'Paid']) {
    aggregated2d.push({ name: g, series: s, value: (g.length * s.length) % 97 })
  }
}

const CASES = [
  { id: 'table',        title: 'Enrolments (table widget)',
    widget: { dw_widget_type: 'table', dw_widget_config: {} },
    result: { columns, rows, primaryObject: 'enrollments' } },
  { id: 'table-totals', title: 'Table widget with totals row (sticky footer)',
    widget: { dw_widget_type: 'table', dw_widget_config: { show_totals: true } },
    result: { columns, rows: numRows, primaryObject: 'enrollments' } },
  { id: 'matrix',       title: 'Matrix widget',
    widget: { dw_widget_type: 'matrix', dw_widget_config: {} },
    result: { columns, rows: [], aggregated2d } },
]

// The real dashboard tile chrome from DashboardRunner (title bar, padding,
// overflow:hidden) — the header pins inside this, so the harness must have it.
function Tile({ c }) {
  return (
    <div data-case={c.id}
         style={{ width: 620, height: 230, margin: '24px', background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, background: C.cardSecondary }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{c.title}</div>
      </div>
      <div style={{ flex: 1, padding: 12, overflow: 'hidden' }}>
        <WidgetBody widget={c.widget} result={c.result} />
      </div>
    </div>
  )
}
// ── The report viewer, where most of the platform's pinned headers live ─────
// TabularLayout / SummaryLayout / MatrixLayout are exported and take a plain
// result object, so they mount for real with no service stubbing.
const reportResult = {
  columns, rows, primaryObject: 'enrollments', calculatedFields: [], groupings: [],
}
const summaryResult = {
  ...reportResult,
  groupings: [{ field_name: 'property_name', field_label: 'Property Name', sort_direction: 'asc' }],
}
// A matrix has to overflow on BOTH axes to be a real test of it: 30 row groups
// down, 14 column groups across, so the row labels can scroll out sideways just
// as the column headings can scroll out upwards.
const matrixRows = Array.from({ length: 600 }, (_, i) => ({
  id: `m${i}`,
  enrollment_status: `Stage ${String((i % 14) + 1).padStart(2, '0')} Prepared`,
  property_name: `${100 + (i % 30)} North Hopkins Street - Milwaukee ${i % 30}`,
  building_name: `Building ${i % 30}`,
}))
const matrixResult = {
  ...reportResult,
  rows: matrixRows,
  groupings: [{ field_name: 'property_name', field_label: 'Property Name', sort_direction: 'asc' }],
  // TWO column-grouping levels on purpose. A single level would pin at top:0
  // and prove nothing about the stacking — the second level is the one that
  // has to land exactly one header-row-height down, and it is the one that
  // goes wrong if the declared height and the offset ever drift apart.
  columnGroupings: [
    { name: 'building_name',      label: 'Building', sort_direction: 'asc' },
    { name: 'enrollment_status',  label: 'Status',   sort_direction: 'asc' },
  ],
  measure: { type: 'count', field: null },
}

// A report layout in `fill` mode inside a fixed-height box is how a viewer
// pane renders it; the pinned header lives inside the layout's own scroll box.
// `xPinDecided` records that this surface deliberately pins no column on the
// horizontal axis, and why. Without it the run reports an unpinned column as a
// gap — which, for a list view, would be a report that the platform has a bug
// where it actually has a ruling.
function Pane({ id, title, xPinDecided, children }) {
  return (
    <div data-case={id} data-x-pin-decided={xPinDecided || undefined}
         style={{ width: 620, height: 230, margin: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

// Positive control. The exclusions above (rounded-corner arc, scrollbar gutter)
// narrow the band, so the test must be shown to still FAIL on a header that
// genuinely lets rows through. This tile strips the header background back off
// via CSS — it is the exact defect, reproduced on purpose, and the harness
// asserts this case fails while every other case passes.
function ControlStyles() {
  return <style>{`[data-case="CONTROL-transparent-header"] th { background: transparent !important; }`}</style>
}

createRoot(document.getElementById('root')).render(
  <div>
    <ControlStyles />
    {CASES.map(c => <Tile key={c.id} c={c} />)}
    <Tile c={{ ...CASES[0], id: 'CONTROL-transparent-header',
               title: 'CONTROL — header background stripped (must FAIL)' }} />
    <Pane id="report-tabular" title="Report viewer — Tabular">
      <TabularLayout result={reportResult} fill />
    </Pane>
    <Pane id="report-summary" title="Report viewer — Summary (grouped)">
      <SummaryLayout result={summaryResult} fill />
    </Pane>
    <Pane id="report-matrix" title="Report viewer — Matrix">
      <MatrixLayout result={matrixResult} fill />
    </Pane>
    {/* The object list every module opens onto — 5 of the platform's pinned
        styles live here, including the frozen row-actions column. */}
    <Pane id="list-view" title="Object list (ListView)"
          xPinDecided="no column is pinned in a list view — Nicholas, PR #549">
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ListView
          data={rows.map(r => ({ id: r.id, status: r.enrollment_status, property: r.property_name, building: r.building_name }))}
          columns={[
            { field: 'status',   label: 'Status' },
            { field: 'property', label: 'Property Name' },
            { field: 'building', label: 'Building' },
          ]}
          systemViews={[]}
          listObject="enrollments"
          tableName="enrollments"
          renderCell={(row, col) => row[col.field]}
        />
      </div>
    </Pane>
  </div>
)
