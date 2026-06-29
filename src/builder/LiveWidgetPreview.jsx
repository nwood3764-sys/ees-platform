// =============================================================================
// src/builder/LiveWidgetPreview.jsx
//
// Live, data-backed preview of a report-bound widget ON the canvas. This is
// what makes the builder genuinely WYSIWYG: the tile renders through the exact
// same DashboardWidgetView the runner uses, fed by real report data, driven by
// the in-editor (unsaved) config — so what you see while building is what
// ships.
//
// Fetch mirrors DashboardRunner.runWidgets for a single widget (the aggregate
// fast-path for group-by chart types, runReport otherwise), minus dashboard
// filters (those apply at view time). Re-fetches when the report or the
// config inputs that affect the query change. Drill is disabled in the
// builder — clicking a tile selects it for editing, it doesn't navigate.
// =============================================================================

import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { runReport, runWidgetAggregate } from '../data/reportsService'
import { WidgetBody } from '../modules/DashboardWidgetView'

const AGG_TYPES = new Set(['bar', 'line', 'pie', 'donut', 'funnel', 'ranked_list'])

export default function LiveWidgetPreview({ component }) {
  const { type, dataSourceId, config } = component
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Signature of the config inputs that change the query/aggregation, so we
  // re-fetch on a meaningful edit but not on cosmetic ones (title, color).
  const sig = JSON.stringify({
    g: config?.group_by, mt: config?.measure_type, mf: config?.measure_field,
    s: config?.sort_by, l: config?.limit, fv: config?.filter_value,
  })

  useEffect(() => {
    let cancelled = false
    if (!dataSourceId) { setResult(null); setLoading(false); return }
    setLoading(true); setError(null)
    const widget = { dw_widget_type: type, dw_widget_config: config || {}, dw_report_id: dataSourceId }
    const run = async () => {
      if (AGG_TYPES.has(type) && config?.group_by) {
        try { return await runWidgetAggregate(widget) }
        catch { return await runReport(dataSourceId) }
      }
      return runReport(dataSourceId)
    }
    run()
      .then(r => { if (!cancelled) { setResult(r); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [dataSourceId, type, sig, config])

  if (loading) return <Centered>Loading data…</Centered>
  if (error)   return <Centered tone={C.sky}>Couldn’t load report data.</Centered>
  if (!result) return null

  const widget = {
    dw_widget_type: type,
    dw_widget_config: config || {},
    dw_report_id: dataSourceId,
    dw_title: component.title,
  }
  return <WidgetBody widget={widget} result={result} canDrill={false} />
}

function Centered({ children, tone }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: tone || C.textMuted }}>
      {children}
    </div>
  )
}
