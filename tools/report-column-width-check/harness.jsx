// Column-width harness — NOT shipped.
//
// Mounts the REAL report table with a control that changes the DATA underneath
// it without touching the columns. The whole promise Nicholas asked for is that
// the second thing cannot move the first: "It shouldn't change unless the user
// changes the widths." A driver measures the columns, presses the button, and
// measures again.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TabularLayout, SummaryLayout } from '../../src/modules/ReportRunner'

const columns = [
  { name: 'ia_status', label: 'Status', type: 'uuid' },
  { name: 'ia_requested_incentive_amount', label: 'Requested Incentive Amount', type: 'numeric' },
  { name: 'ia_submission_date', label: 'Submission Date', type: 'date' },
]

const SHORT = 'Prepared'
// A value far wider than its column — under `table-layout: auto` this is what
// yanks the column open and shoves every other one sideways.
const LONG = 'Incentive Application To Be Prepared And Reviewed By The Program Administrator Before Submission'

function makeRows(text) {
  return Array.from({ length: 30 }, (_, i) => ({
    id: `r${i}`,
    ia_status: i === 0 ? text : SHORT,
    ia_requested_incentive_amount: 2000 + i,
    ia_submission_date: '2026-08-29',
  }))
}

// No reportId: the harness must never try to write a width to a database.
const baseResult = (rows) => ({
  rows, columns, primaryObject: 'incentive_applications',
  calculatedFields: [], groupings: [], reportId: null, columnWidths: null,
})

const summaryResult = (rows) => ({
  ...baseResult(rows),
  groupings: [{ field_name: 'ia_submission_date', field_label: 'Submission Date', show_subtotal: true }],
})

function App() {
  const [long, setLong] = useState(false)
  const rows = makeRows(long ? LONG : SHORT)
  return (
    <div style={{ padding: 24 }}>
      <button id="toggle-data" onClick={() => setLong(v => !v)}>
        {long ? 'Short values' : 'Long values'}
      </button>
      <div data-case="report-tabular" style={{ width: 700, height: 300, marginTop: 16, display:'flex', flexDirection:'column' }}>
        <TabularLayout result={baseResult(rows)} fill />
      </div>
      <div data-case="report-summary" style={{ width: 700, height: 300, marginTop: 16, display:'flex', flexDirection:'column' }}>
        <SummaryLayout result={summaryResult(rows)} fill />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
