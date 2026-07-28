import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { loadDashboard, runWidgetData, fetchFilterOptions } from '../data/reportsService'
import { WidgetBody } from './DashboardWidgetView'

// ─── Dashboard Runner ─────────────────────────────────────────────────────
//
// Loads a dashboard, fetches every widget's underlying report in parallel,
// and renders the widgets in a grid. Each widget chooses its own viz
// (table / metric / bar / line / pie / donut / funnel / gauge).

// A UUID raw value means the group column is a picklist/lookup FK, which the
// object list surfaces as a resolved `<col>__label` text column — so those
// drill on the human label; plain scalar columns drill on the raw value.
const DRILL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Translate a clicked chart segment into the list-view filter that scopes the
// records drill. Returns [] (unfiltered — every record behind the widget) when
// there is no group column or the bucket can't be scoped safely (a `—`/blank
// bucket: a null FK still renders `—` in the list, not blank, so an equality
// or is-blank filter would silently match nothing or everything).
function buildDrillFilters(groupBy, rawValue, label) {
  if (!groupBy || rawValue == null || rawValue === '') return []
  const human = String(groupBy).replace(/__label$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  if (typeof rawValue === 'string' && DRILL_UUID_RE.test(rawValue)) {
    if (label == null || label === '—' || label === '(blank)') return []
    return [{ field: `${groupBy}__label`, label: human, op: 'equals', value: String(label) }]
  }
  return [{ field: groupBy, label: human, op: 'equals', value: String(rawValue) }]
}

export default function DashboardRunner({ dashboardId, onClose, onEdit, onOpenReport, onDrillToRecords, onNavigate }) {
  const [data, setData]                 = useState(null)        // { dashboard, widgets, filters }
  const [results, setResults]           = useState({})          // widget.id → run result
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filterValues, setFilterValues] = useState({})          // dfilt id → current value
  const [filterOptions, setFilterOptions] = useState({})        // dfilt id → [{value,label}]
  const [filterWidgetValues, setFilterWidgetValues] = useState({}) // filter-widget id → value
  const [crossFilter, setCrossFilter] = useState(null)             // { field, value, label, sourceWidgetId }

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

  const FILTER_WIDGET_TYPES = new Set(['filter_picklist', 'filter_toggle', 'filter_date_range'])

  // On-canvas filter widgets contribute filters exactly like the header bar:
  // picklist/toggle → equals; date range → gte/lte pair. Unset = not applied.
  function buildWidgetFilterExtras(widgets, values) {
    const out = []
    for (const w of (widgets || [])) {
      if (!FILTER_WIDGET_TYPES.has(w.dw_widget_type)) continue
      const field = w.dw_widget_config?.filter_field
      if (!field) continue
      const v = values[w.id]
      if (w.dw_widget_type === 'filter_date_range') {
        if (v?.from) out.push({ field_name: field, operator: 'greater_or_equal', value: v.from })
        if (v?.to)   out.push({ field_name: field, operator: 'less_or_equal',    value: v.to })
      } else if (v !== undefined && v !== null && v !== '') {
        out.push({ field_name: field, operator: 'equals', value: v })
      }
    }
    return out
  }

  const runWidgets = async (dashboardData, currentFilterValues, widgetValues = filterWidgetValues, activeCross = crossFilter) => {
    const baseExtra = [
      ...buildExtraFilters(dashboardData.filters, currentFilterValues),
      ...buildWidgetFilterExtras(dashboardData.widgets, widgetValues),
    ]
    // Columns the dashboard filter bar controls. These override each widget
    // report's own saved filter on the same column — so setting STATE to
    // "All" clears the report's built-in `property_state = NC` filter rather
    // than leaving the dashboard pinned to NC. Listed even when their current
    // value is "All" (empty), which is precisely when the override matters.
    const baseOverride = [
      ...(dashboardData.filters || []).map(f => f.dfilt_field_name),
      ...(dashboardData.widgets || [])
        .filter(w => FILTER_WIDGET_TYPES.has(w.dw_widget_type))
        .map(w => w.dw_widget_config?.filter_field),
    ].filter(Boolean)
    // Each widget type routes to its server-side query shape (grouped
    // aggregate, 2D pivot, time buckets, single aggregate) via runWidgetData,
    // which itself falls back to the full row fetch on any fast-path failure —
    // a degraded-but-correct result, never a blank widget.
    const widgetResults = await Promise.all(
      (dashboardData.widgets || []).map(async w => {
        // Cross-filter: a click on another widget's segment filters this one.
        // The source widget stays unfiltered (Power BI behavior — the clicked
        // visual keeps showing every category so you can pick another).
        const applyCross = activeCross && activeCross.field && w.id !== activeCross.sourceWidgetId
        const extra = applyCross
          ? [...baseExtra, { field_name: activeCross.field, operator: 'equals', value: activeCross.value }]
          : baseExtra
        const overrideFields = applyCross ? [...baseOverride, activeCross.field] : baseOverride
        try {
          const r = await runWidgetData(w, extra, overrideFields)
          return [w.id, r]
        } catch (err) {
          return [w.id, { error: err }]
        }
      })
    )
    setResults(Object.fromEntries(widgetResults))
  }

  // Cross-filter: clicking a chart segment filters every other widget on the
  // dashboard by that segment's value. Click again (or Clear) to remove it.
  const applyCrossFilter = async (widget, rawValue, label) => {
    const field = widget.dw_widget_config?.group_by
    if (!field || rawValue == null || rawValue === '') return
    const isSame = crossFilter && crossFilter.sourceWidgetId === widget.id &&
      String(crossFilter.value) === String(rawValue)
    const next = isSame ? null : { field, value: rawValue, label: label ?? rawValue, sourceWidgetId: widget.id }
    setCrossFilter(next)
    if (data) await runWidgets(data, filterValues, filterWidgetValues, next)
  }
  const clearCrossFilter = async () => {
    setCrossFilter(null)
    if (data) await runWidgets(data, filterValues, filterWidgetValues, null)
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

  // On-canvas filter widgets apply immediately on change (no Apply button —
  // Power BI slicer behavior). Data widgets re-fetch; the tiles stay mounted.
  const handleFilterWidgetChange = async (widgetId, value) => {
    const next = { ...filterWidgetValues, [widgetId]: value }
    setFilterWidgetValues(next)
    if (data) await runWidgets(data, filterValues, next)
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
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {crossFilter && (
            <div style={{
              display:'inline-flex', alignItems:'center', gap:8,
              padding:'5px 8px 5px 12px', borderRadius:16,
              background:'#e8f1fb', border:`1px solid ${C.skyBlue}`, color:'#2f6da3', fontSize:12,
            }}>
              <span>Filtered by <strong>{String(crossFilter.label)}</strong></span>
              <button onClick={clearCrossFilter} title="Clear cross-filter"
                style={{ border:'none', background:'transparent', cursor:'pointer', color:'#2f6da3', fontSize:14, lineHeight:1, padding:0 }}>×</button>
            </div>
          )}
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
                onDrillToRecords={onDrillToRecords}
                onNavigate={onNavigate}
                filterValue={filterWidgetValues[w.id]}
                onFilterWidgetChange={handleFilterWidgetChange}
                onCrossFilter={applyCrossFilter}
                crossFilter={crossFilter}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Widget tile ──────────────────────────────────────────────────────────

function DashboardWidgetTile({ widget, result, useGeometry, onOpenReport, onDrillToRecords, onNavigate, filterValue, onFilterWidgetChange, onCrossFilter, crossFilter }) {
  const span = widget.dw_width || 1
  const cfg = widget.dw_widget_config || {}
  // Drilling opens the underlying RECORDS (the object's list, scoped to what was
  // clicked) — not the source report, which for a summary widget just re-renders
  // the same grouped chart as a goofy one-column table. Falls back to opening the
  // report only where no records-drill handler is wired (e.g. an inline preview).
  const primaryObject = result?.primaryObject || null
  const canDrillRecords = !!onDrillToRecords && !!primaryObject
  const canDrill = canDrillRecords || !!onOpenReport
  const canCrossFilter = !!onCrossFilter && !!cfg.group_by

  // Resolve the human label from the aggregated rows (for the cross-filter chip
  // and the drill scope banner).
  const resolveLabel = (rawValue) => {
    const agg = Array.isArray(result?.aggregated) ? result.aggregated : null
    const hit = agg?.find(r => String(r.rawValue) === String(rawValue))
    return hit?.name ?? rawValue
  }
  // Open the records list scoped to a clicked segment (or unscoped for the whole
  // widget). Falls back to the report opener when records-drill isn't available.
  const drillRecords = (rawValue, label) => {
    if (canDrillRecords) {
      const filters = buildDrillFilters(cfg.group_by || null, rawValue, label)
      const base = widget.dw_title || result?.name || 'Records'
      const scopeLabel = filters.length ? `${base} · ${label}` : base
      onDrillToRecords(primaryObject, filters, scopeLabel)
    } else if (onOpenReport) {
      onOpenReport(widget.dw_report_id)
    }
  }
  const drillTo = (rawValue) => {
    // Chart segment on a grouped widget → cross-filter the dashboard (Power BI
    // behavior — stays on the dashboard). Everything else → drill to records.
    if (canCrossFilter && rawValue != null && rawValue !== '') {
      onCrossFilter(widget, rawValue, resolveLabel(rawValue))
    } else {
      drillRecords(rawValue, resolveLabel(rawValue))
    }
  }
  const drillWhole = () => drillRecords(null, null)

  // Is this widget the source of the active cross-filter?
  const isCrossSource = crossFilter && crossFilter.sourceWidgetId === widget.id

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
      background: C.card,
      border: isCrossSource ? `2px solid ${C.emerald}` : `1px solid ${C.border}`,
      borderRadius: 8,
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
            canDrill={canDrill} drillTo={drillTo} drillWhole={drillWhole}
            filterValue={filterValue}
            onFilterChange={onFilterWidgetChange ? (v) => onFilterWidgetChange(widget.id, v) : undefined} />
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
