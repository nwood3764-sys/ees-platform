import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, loadDashboard, runWidgetAggregate, fetchFilterOptions } from '../data/reportsService'
import { WidgetBody } from './DashboardWidgetView'

// ─── Dashboard Runner ─────────────────────────────────────────────────────
//
// Loads a dashboard, fetches every widget's underlying report in parallel,
// and renders the widgets in a grid. Each widget chooses its own viz
// (table / metric / bar / line / pie / donut / funnel / gauge).

export default function DashboardRunner({ dashboardId, onClose, onEdit, onOpenReport, onNavigate }) {
  const [data, setData]                 = useState(null)        // { dashboard, widgets, filters }
  const [results, setResults]           = useState({})          // widget.id → run result
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filterValues, setFilterValues] = useState({})          // dfilt id → current value
  const [filterOptions, setFilterOptions] = useState({})        // dfilt id → [{value,label}]

  // Build the extraFilters array for runReport from the current filter
  // values. Empty values mean the filter is not applied this run.
  function buildExtraFilters(dashboardFilters, values) {
    const out = []
    for (const f of (dashboardFilters || [])) {
      const v = values[f.id]
      if (v === undefined || v === null || v === '') continue
      out.push({
        field_name: f.dfilt_field_name,
        operator:   f.dfilt_operator || 'equals',
        value:      v,
      })
    }
    return out
  }

  const runWidgets = async (dashboardData, currentFilterValues) => {
    const extra = buildExtraFilters(dashboardData.filters, currentFilterValues)
    // Columns the dashboard filter bar controls. These override each widget
    // report's own saved filter on the same column — so setting STATE to
    // "All" clears the report's built-in `property_state = NC` filter rather
    // than leaving the dashboard pinned to NC. Listed even when their current
    // value is "All" (empty), which is precisely when the override matters.
    const overrideFields = (dashboardData.filters || [])
      .map(f => f.dfilt_field_name)
      .filter(Boolean)
    // Widget types that are pure group-by aggregations use the server-side
    // report_aggregate fast path (one GROUP BY, ~N rows) instead of pulling
    // all detail rows into the browser. metric/table still use runReport.
    const AGG_TYPES = new Set(['bar', 'line', 'pie', 'donut', 'funnel', 'ranked_list'])
    const widgetResults = await Promise.all(
      (dashboardData.widgets || []).map(async w => {
        const cfg = w.dw_widget_config || {}
        if (AGG_TYPES.has(w.dw_widget_type) && cfg.group_by) {
          try {
            const agg = await runWidgetAggregate(w, extra, overrideFields)
            return [w.id, agg]
          } catch (err) {
            // Fall back to the full row-fetch path so a fast-path failure
            // degrades to the (slower) correct result, never a blank widget.
            try {
              const r = await runReport(w.dw_report_id, null, extra, overrideFields)
              return [w.id, r]
            } catch (err2) {
              return [w.id, { error: err2 }]
            }
          }
        }
        try {
          const r = await runReport(w.dw_report_id, null, extra, overrideFields)
          return [w.id, r]
        } catch (err) {
          return [w.id, { error: err }]
        }
      })
    )
    setResults(Object.fromEntries(widgetResults))
  }

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const d = await loadDashboard(dashboardId)
      if (!d) throw new Error('Dashboard not found')
      setData(d)

      // Initialize filter values from each filter's default
      const initialValues = {}
      for (const f of (d.filters || [])) {
        const dv = f.dfilt_default_value
        // jsonb default may be null, a string, or a wrapped value
        if (dv == null) { initialValues[f.id] = ''; continue }
        if (typeof dv === 'object' && 'value' in dv) initialValues[f.id] = dv.value ?? ''
        else initialValues[f.id] = dv
      }
      setFilterValues(initialValues)

      // Resolve selectable options for each filter (dynamic distinct sources or
      // static arrays). Runs in parallel; failures degrade to a text input.
      const optionEntries = await Promise.all(
        (d.filters || []).map(async f => [f.id, await fetchFilterOptions(f)])
      )
      setFilterOptions(Object.fromEntries(optionEntries))

      await runWidgets(d, initialValues)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  // Re-run all widgets when filter values change (after initial load).
  const applyFilters = async () => {
    if (!data) return
    setLoading(true)
    try {
      await runWidgets(data, filterValues)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId])

  if (loading && !data) return <LoadingState />
  if (error && !data)   return <ErrorState error={error} onRetry={refresh} />
  if (!data)            return null

  const cols = data.dashboard.dash_columns || 3
  // Geometry mode: at least one widget was placed by the LEAP Canvas (carries
  // _geometry in its config). Render the whole dashboard on the 12-col grid so
  // the view is pixel-faithful to the builder.
  const useGeometry = (data.widgets || []).some(w => w.dw_widget_config?._geometry)
  const hasFilters = (data.filters || []).length > 0

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:C.page }}>
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ fontSize:11, color:C.textMuted }}>Dashboard</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>{data.dashboard.dash_name}</div>
          <div style={{ fontSize:11, color:C.textMuted }}>
            {data.widgets.length} widgets · {cols}-column layout
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={refresh} style={btnSecondary()}>Refresh</button>
          {onEdit  && <button onClick={onEdit}  style={btnSecondary()}>Edit</button>}
          {onClose && <button onClick={onClose} style={btnSecondary()}>Close</button>}
        </div>
      </div>

      {hasFilters && (
        <div style={{
          background:C.card, borderBottom:`1px solid ${C.border}`,
          padding:'10px 24px', display:'flex', gap:12, alignItems:'flex-end', flexWrap:'wrap',
        }}>
          {data.filters.map(f => (
            <div key={f.id} style={{ display:'flex', flexDirection:'column', gap:2, minWidth:160 }}>
              <label style={{
                fontSize:10, fontWeight:500, color:C.textSecondary,
                textTransform:'uppercase', letterSpacing:0.5,
              }}>
                {f.dfilt_label}
                <span style={{ color:C.textMuted, marginLeft:6, textTransform:'none' }}>
                  ({f.dfilt_field_name} {f.dfilt_operator})
                </span>
              </label>
              {(filterOptions[f.id] && filterOptions[f.id].length > 0) ? (
                <select
                  value={filterValues[f.id] ?? ''}
                  onChange={e => setFilterValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                  style={{
                    padding:'6px 8px', fontSize:12,
                    background:C.card, color:C.textPrimary,
                    border:`1px solid ${C.border}`, borderRadius:4, font:'inherit',
                    cursor:'pointer',
                  }}>
                  <option value="">All</option>
                  {filterOptions[f.id].map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input type="text"
                  value={filterValues[f.id] ?? ''}
                  onChange={e => setFilterValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                  style={{
                    padding:'6px 8px', fontSize:12,
                    background:C.card, color:C.textPrimary,
                    border:`1px solid ${C.border}`, borderRadius:4, font:'inherit',
                  }} />
              )}
            </div>
          ))}
          <button
            onClick={applyFilters}
            disabled={loading}
            style={{
              padding:'6px 14px', fontSize:12, fontWeight:500,
              background: loading ? C.borderDark : C.emerald, color:'#fff',
              border:'none', borderRadius:4,
              cursor: loading ? 'default' : 'pointer',
            }}>
            {loading ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}

      <div style={{ flex:1, overflow:'auto', padding:'16px 24px' }}>
        {data.widgets.length === 0 ? (
          <EmptyState message="No widgets yet. Click Edit to add reports to this dashboard." />
        ) : (
          <div style={
            // Dashboards built/edited in the LEAP Canvas carry per-widget
            // _geometry ({x,y,w,h} on a 12-col grid). Place those exactly so the
            // view matches the builder. Dashboards without geometry (built in the
            // old editor) keep the legacy column-flow grid — unchanged.
            useGeometry ? {
              display:'grid', gridTemplateColumns:'repeat(12, 1fr)',
              gridAutoRows:'56px', gap:8,
            } : {
              display:'grid', gridTemplateColumns:`repeat(${cols}, 1fr)`, gap:16,
            }
          }>
            {data.widgets.map(w => (
              <DashboardWidgetTile
                key={w.id}
                widget={w}
                result={results[w.id]}
                useGeometry={useGeometry}
                onOpenReport={onOpenReport}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Widget tile ──────────────────────────────────────────────────────────

function DashboardWidgetTile({ widget, result, useGeometry, onOpenReport, onNavigate }) {
  const span = widget.dw_width || 1
  // Drill: open the report behind the widget. The header link opens the whole
  // report; clicking a chart segment / metric drills to just those filtered
  // records (Salesforce-style) by passing extraFilters to onOpenReport.
  const canDrill = !!onOpenReport
  const cfg = widget.dw_widget_config || {}

  // Build the extraFilters for a clicked segment: filter the group_by column to
  // the segment's raw stored value (what the report engine matches on).
  const drillTo = (rawValue) => {
    if (!canDrill) return
    const groupCol = cfg.group_by || null
    if (groupCol && rawValue !== undefined && rawValue !== null && rawValue !== '') {
      onOpenReport(widget.dw_report_id, [{ field_name: groupCol, operator: 'equals', value: rawValue }])
    } else {
      onOpenReport(widget.dw_report_id)        // fall back to whole report
    }
  }
  const drillWhole = () => { if (canDrill) onOpenReport(widget.dw_report_id) }

  // Salesforce dashboard-component chrome carried in config by the canvas.
  const subtitle = cfg._subtitle || null
  const footer   = cfg._footer || null
  const geo      = cfg._geometry || null

  // Placement: geometry mode → exact 12-col x/y/w/h; legacy → column span.
  const placement = (useGeometry && geo)
    ? {
        gridColumn: `${(geo.x | 0) + 1} / span ${Math.max(1, geo.w | 0)}`,
        gridRow:    `${(geo.y | 0) + 1} / span ${Math.max(1, geo.h | 0)}`,
      }
    : { gridColumn: `span ${span}`, minHeight: 240 }

  return (
    <div style={{
      ...placement,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding:'8px 12px', borderBottom:`1px solid ${C.border}`,
        display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8,
        background:C.cardSecondary,
      }}>
        <div style={{ minWidth:0, display:'flex', flexDirection:'column', gap:1 }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {widget.dw_title || result?.name || 'Widget'}
          </div>
          {subtitle && (
            <div style={{ fontSize:11, color:C.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{subtitle}</div>
          )}
        </div>
        <button
          onClick={drillWhole}
          disabled={!canDrill}
          style={{
            background:'transparent', border:'none', color: canDrill ? C.emerald : C.textMuted,
            fontSize:11, fontWeight:500, cursor: canDrill ? 'pointer' : 'default', padding:0, flexShrink:0, whiteSpace:'nowrap',
          }}
        >View Records →</button>
      </div>
      <div style={{ flex:1, padding:12, overflow:'hidden' }}>
        {!result ? (
          <div style={{ fontSize:12, color:C.textMuted }}>Loading…</div>
        ) : result.error ? (
          <div style={{ fontSize:12, color:C.danger }}>Failed: {result.error.message}</div>
        ) : (
          <WidgetBody widget={widget} result={result}
            canDrill={canDrill} drillTo={drillTo} drillWhole={drillWhole} />
        )}
      </div>
      {footer && (
        <div style={{
          padding:'5px 12px', borderTop:`1px solid ${C.border}`, background:C.cardSecondary,
          fontSize:10.5, color:C.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>{footer}</div>
      )}
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────

function btnSecondary() {
  return {
    padding:'8px 14px', fontSize:13, fontWeight:500,
    background:C.card, color:C.textPrimary,
    border:`1px solid ${C.borderDark}`, borderRadius:6, cursor:'pointer',
  }
}

function EmptyState({ message }) {
  return (
    <div style={{
      padding:'40px 24px', textAlign:'center', background:C.card,
      border:`1px solid ${C.border}`, borderRadius:8,
      fontSize:14, color:C.textMuted,
    }}>
      {message}
    </div>
  )
}
