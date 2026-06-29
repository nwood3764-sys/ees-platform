import { useRecharts } from '../lib/RechartsLazy'
import { C, CHART_COLORS } from '../data/constants'
import { getRowValue } from '../data/reportsService'

// ─── Dashboard widget view ──────────────────────────────────────────────────
//
// The widget-body renderers, extracted from DashboardRunner so BOTH the runner
// (read-only viewing) and the LEAP Canvas builder (live WYSIWYG preview) render
// widgets through the exact same code. This is what makes the builder a true
// "what you see is what ships" canvas — the preview is the runner.
//
// Behavior is identical to the renderers that previously lived inline in
// DashboardRunner; only the location changed. `widget` is a dashboard_widgets
// row shape ({ dw_widget_type, dw_widget_config, dw_report_id, ... }) and
// `result` is a runReport / runWidgetAggregate result.

export function WidgetBody({ widget, result, canDrill, drillTo, drillWhole }) {
  const type = widget.dw_widget_type || 'table'
  const rows = result?.rows || []

  // The aggregate fast-path (runWidgetAggregate) returns grouped rows in
  // result.aggregated and no result.rows. Treat an aggregated array as the
  // row-presence signal for those widgets, otherwise the empty-rows guard
  // below short-circuits every grouped widget to "No matching rows." before
  // buildChartData ever reads result.aggregated.
  const aggregated = Array.isArray(result?.aggregated) ? result.aggregated : null

  if (aggregated ? aggregated.length === 0 : rows.length === 0) {
    return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>No matching rows.</div>
  }

  switch (type) {
    case 'metric':
      return <MetricWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} drillWhole={drillWhole} />
    case 'bar':
      return <BarWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'line':
      return <LineWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'pie':
      return <PieWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'donut':
      return <PieWidget result={result} widget={widget} donut canDrill={canDrill} drillTo={drillTo} />
    case 'funnel':
      return <FunnelWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'ranked_list':
      return <RankedListWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'gauge':
      return <GaugeWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'table':
    default:
      return <TableWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
  }
}

// ─── Widget renderers ─────────────────────────────────────────────────────

function MetricWidget({ result, widget, canDrill, drillTo, drillWhole }) {
  // Configurable single number. With no measure config, defaults to row count.
  // widget_config:
  //   { measure_type, measure_field, label, group_by, filter_value }
  // When group_by + filter_value are set, the metric is scoped to the rows
  // whose group_by field equals filter_value (e.g. count of records in one
  // status), rather than the whole report. Without them it spans all rows.
  const cfg          = widget.dw_widget_config || {}
  const measureType  = cfg.measure_type  || 'count'
  const measureField = cfg.measure_field || null
  const groupBy      = cfg.group_by || null
  const filterValue  = (cfg.filter_value !== undefined && cfg.filter_value !== null && cfg.filter_value !== '')
    ? String(cfg.filter_value) : null

  // Resolve the real column definition from the report so picklist/FK group
  // values resolve to labels and via_path columns read correctly — the same
  // resolution the chart path uses. A bare { name } object skips _is_picklist /
  // via_path metadata, so getRowValue would only return the raw stored UUID.
  const groupField = (result.columns || []).find(c => c.name === groupBy)
    || (groupBy ? { name: groupBy } : null)

  // Scope rows by group_by = filter_value when both are present. Match against
  // BOTH the resolved label (getRowValue) and the raw stored value (row[name]),
  // so the scope works whether the builder stored filter_value as a status UUID
  // or as the human-readable picklist label.
  const scopedRows = (groupBy && filterValue && groupField)
    ? (result.rows || []).filter(row => {
        const label = getRowValue(row, groupField, result)
        const raw   = row[groupField.name]
        return (label != null && String(label) === filterValue)
            || (raw   != null && String(raw)   === filterValue)
      })
    : (result.rows || [])

  let value, displayLabel
  if (measureType === 'count' || !measureField) {
    value = scopedRows.length
    displayLabel = cfg.label || 'rows'
  } else {
    const nums = []
    for (const row of scopedRows) {
      const v = getRowValue(row, { name: measureField }, result)
      if (v == null || v === '') continue
      const n = typeof v === 'number' ? v : parseFloat(v)
      if (Number.isFinite(n)) nums.push(n)
    }
    if (nums.length === 0) value = 0
    else switch (measureType) {
      case 'sum': value = nums.reduce((a,b) => a+b, 0); break
      case 'avg': value = nums.reduce((a,b) => a+b, 0) / nums.length; break
      case 'min': value = Math.min(...nums); break
      case 'max': value = Math.max(...nums); break
      default:    value = nums.length
    }
    displayLabel = cfg.label || `${measureType} of ${measureField}`
  }

  // Format integers cleanly, decimals to 1 place
  const isInt = Number.isInteger(value)
  const display = isInt
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })

  // Click drills: if the metric is scoped to a group/filter value, drill to
  // those filtered records; otherwise open the whole report.
  const onMetricClick = !canDrill ? undefined : () => {
    if (groupBy && filterValue) drillTo?.(filterValue)
    else drillWhole?.()
  }

  return (
    <div
      onClick={onMetricClick}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ fontSize:48, fontWeight:700, color:C.textPrimary, lineHeight:1 }}>
        {display}
      </div>
      <div style={{ fontSize:12, color:C.textMuted, marginTop:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        {displayLabel}
      </div>
    </div>
  )
}

function TableWidget({ result, canDrill, drillWhole }) {
  const { rows, columns } = result
  return (
    <div
      onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ overflow:'auto', maxHeight:240, cursor: canDrill ? 'pointer' : 'default' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
        <thead style={{ background:C.cardSecondary, position:'sticky', top:0 }}>
          <tr>
            {columns.map((c, idx) => (
              <th key={idx} style={{
                padding:'4px 8px', fontSize:10, fontWeight:600, color:C.textSecondary,
                textTransform:'uppercase', textAlign:'left', whiteSpace:'nowrap',
                borderBottom:`1px solid ${C.border}`,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((row, ri) => (
            <tr key={row.id || ri} style={{ borderTop:`1px solid ${C.border}` }}>
              {columns.map((c, ci) => {
                const v = getRowValue(row, c, result)
                return (
                  <td key={ci} style={{ padding:'4px 8px', whiteSpace:'nowrap' }}>
                    {v == null ? '—' : (typeof v === 'object' ? '[obj]' : String(v))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Build chart data from a report result based on the widget's group_by
// and measure config. Each {name, value} pair becomes one bar/slice/point.
//
// widget_config shape (all optional):
//   group_by:      column name on the report (defaults to first column)
//   measure_type:  'count' | 'sum' | 'avg' | 'min' | 'max'  (default 'count')
//   measure_field: column name to aggregate (required when measure_type != 'count')
//   sort_by:       'value_desc' (default) | 'value_asc' | 'name'
//   limit:         max categories to show (default 20 — keeps charts legible)
export function buildChartData(result, widget) {
  // Fast path: when the runner used the server-side report_aggregate RPC,
  // the grouped rows are already in result.aggregated in final shape.
  // The RPC applied group-by, measure, label resolution, sort, and limit,
  // so return them directly.
  if (result && Array.isArray(result.aggregated)) {
    return result.aggregated
  }
  const cfg          = widget.dw_widget_config || {}
  const groupCol     = cfg.group_by      || (result.columns?.[0]?.name) || null
  const measureType  = cfg.measure_type  || 'count'
  const measureField = cfg.measure_field || null
  const sortBy       = cfg.sort_by       || 'value_desc'
  const limit        = cfg.limit         || 20
  if (!groupCol) return []

  // Resolve the real column definitions from the report so picklist/FK
  // group values resolve to labels and via_path columns read correctly.
  // getRowValue needs the column's _is_picklist / via_path metadata; a bare
  // { name } object skips label resolution and reads the wrong key.
  const cols       = result.columns || []
  const groupField = cols.find(c => c.name === groupCol) || { name: groupCol }
  const measFieldDef = measureField
    ? (cols.find(c => c.name === measureField) || { name: measureField })
    : null

  // Group rows by the resolved value of groupCol (FK labels and picklist
  // labels already substituted by getRowValue). Keep the raw stored value of
  // the group column for the first row in each bucket so a segment click can
  // drill to filtered records using the value the report engine matches on
  // (e.g. the status UUID), not the human label.
  const buckets = new Map()
  const rawByKey = new Map()
  for (const row of result.rows) {
    const k = getRowValue(row, groupField, result) ?? '—'
    const key = String(k)
    if (!buckets.has(key)) {
      buckets.set(key, [])
      rawByKey.set(key, row[groupField.name] ?? null)
    }
    buckets.get(key).push(row)
  }

  // Apply the measure to each bucket.
  const aggregated = []
  for (const [name, bucketRows] of buckets) {
    let value
    if (measureType === 'count' || !measFieldDef) {
      value = bucketRows.length
    } else {
      // Pull resolved values for the measure field; coerce to numbers
      const nums = []
      for (const row of bucketRows) {
        const v = getRowValue(row, measFieldDef, result)
        if (v == null || v === '') continue
        const n = typeof v === 'number' ? v : parseFloat(v)
        if (Number.isFinite(n)) nums.push(n)
      }
      if (nums.length === 0) { value = 0 }
      else switch (measureType) {
        case 'sum': value = nums.reduce((a,b) => a+b, 0); break
        case 'avg': value = nums.reduce((a,b) => a+b, 0) / nums.length; break
        case 'min': value = Math.min(...nums); break
        case 'max': value = Math.max(...nums); break
        default:    value = nums.length
      }
    }
    aggregated.push({ name, value, rawValue: rawByKey.get(name), groupCol })
  }

  // Sort + limit
  if (sortBy === 'name') {
    aggregated.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  } else if (sortBy === 'value_asc') {
    aggregated.sort((a, b) => a.value - b.value)
  } else {
    aggregated.sort((a, b) => b.value - a.value)
  }
  return aggregated.slice(0, limit)
}

function BarWidget({ result, widget, canDrill, drillTo }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  const onBarClick = canDrill ? (d) => drillTo?.(d?.rawValue) : undefined
  const cfg = widget.dw_widget_config || {}
  // Horizontal layout: categories listed top-to-bottom on the Y axis,
  // counts growing left-to-right on the X axis (ranked-bar style). Default
  // for category-count widgets; matches the standard outreach dashboards.
  const horizontal = cfg.orientation !== 'vertical'
  // Height scales with the number of bars so 20 categories aren't crushed.
  const chartHeight = horizontal ? Math.max(240, data.length * 26 + 40) : 240

  if (horizontal) {
    return (
      <R.ResponsiveContainer width="100%" height={chartHeight}>
        <R.BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <R.XAxis type="number" tick={{ fontSize:10 }} />
          <R.YAxis type="category" dataKey="name" width={150}
            tick={{ fontSize:10 }} interval={0} />
          <R.Tooltip />
          <R.Bar dataKey="value" fill={C.emerald}
            cursor={canDrill ? 'pointer' : undefined}
            onClick={onBarClick} />
        </R.BarChart>
      </R.ResponsiveContainer>
    )
  }

  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.BarChart data={data}>
        <R.XAxis dataKey="name" tick={{ fontSize:10 }} />
        <R.YAxis tick={{ fontSize:10 }} />
        <R.Tooltip />
        <R.Bar dataKey="value" fill={C.emerald}
          cursor={canDrill ? 'pointer' : undefined}
          onClick={onBarClick} />
      </R.BarChart>
    </R.ResponsiveContainer>
  )
}

function LineWidget({ result, widget, canDrill, drillTo }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  const onPointClick = canDrill ? (d) => drillTo?.(d?.payload?.rawValue ?? d?.rawValue) : undefined
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.LineChart data={data}>
        <R.XAxis dataKey="name" tick={{ fontSize:10 }} />
        <R.YAxis tick={{ fontSize:10 }} />
        <R.Tooltip />
        <R.Line type="monotone" dataKey="value" stroke={C.emerald} strokeWidth={2}
          activeDot={{ cursor: canDrill ? 'pointer' : undefined, onClick: onPointClick }} />
      </R.LineChart>
    </R.ResponsiveContainer>
  )
}

function PieWidget({ result, widget, donut, canDrill, drillTo }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  const onSliceClick = canDrill ? (d) => drillTo?.(d?.payload?.rawValue ?? d?.rawValue) : undefined
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.PieChart>
        <R.Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={80} innerRadius={donut ? 40 : 0}
          label={(e) => e.name}
          cursor={canDrill ? 'pointer' : undefined}
          onClick={onSliceClick}>
          {data.map((_, i) => (
            <R.Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </R.Pie>
        <R.Tooltip />
      </R.PieChart>
    </R.ResponsiveContainer>
  )
}

function FunnelWidget({ result, widget, canDrill, drillTo }) {
  const R = useRecharts()
  const data = buildChartData(result, widget).sort((a, b) => b.value - a.value)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  const onSegClick = canDrill ? (d) => drillTo?.(d?.payload?.rawValue ?? d?.rawValue) : undefined
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.FunnelChart>
        <R.Tooltip />
        <R.Funnel data={data} dataKey="value" nameKey="name" isAnimationActive={false}
          cursor={canDrill ? 'pointer' : undefined}
          onClick={onSegClick}>
          {data.map((_, i) => (
            <R.Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </R.Funnel>
      </R.FunnelChart>
    </R.ResponsiveContainer>
  )
}

// Ranked list — the readable form for a many-category breakdown (county,
// organization, etc.). One row per item: name on the left, a thin
// proportional bar, the count on the right. Full-size text, scrolls
// vertically when there are more rows than fit. This is the Salesforce /
// Manus "Progress by X" table pattern; a 20-bar chart can't show long
// labels legibly, so category-count widgets use this instead.
function RankedListWidget({ result, widget, canDrill, drillTo }) {
  const data = buildChartData(result, widget)
  if (!data.length) return <div style={{ fontSize:12, color:C.textMuted, padding:14 }}>No data.</div>
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ flex:1, overflowY:'auto', padding:'4px 12px 12px' }}>
      {data.map((d, i) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100))
        return (
          <div key={i}
            onClick={canDrill ? () => drillTo?.(d.rawValue) : undefined}
            style={{
              display:'grid', gridTemplateColumns:'minmax(120px, 40%) 1fr auto',
              alignItems:'center', gap:10, padding:'7px 0',
              borderBottom:`1px solid ${C.border}`,
              cursor: canDrill ? 'pointer' : 'default',
            }}>
            <div style={{ fontSize:13, color:C.textPrimary, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
              title={d.name}>{d.name}</div>
            <div style={{ height:8, background:C.cardSecondary, borderRadius:4, overflow:'hidden' }}>
              <div style={{ width:`${pct}%`, height:'100%', background:C.emerald, borderRadius:4 }} />
            </div>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace', minWidth:48, textAlign:'right' }}>
              {Number(d.value).toLocaleString()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function GaugeWidget({ result, widget, canDrill, drillWhole }) {
  // Progress toward target. widget_config.target is the denominator;
  // numerator is the configured measure (defaults to row count).
  const cfg          = widget.dw_widget_config || {}
  const target       = cfg.target        || 100
  const measureType  = cfg.measure_type  || 'count'
  const measureField = cfg.measure_field || null

  let value
  if (measureType === 'count' || !measureField) {
    value = result.rows.length
  } else {
    const nums = []
    for (const row of result.rows) {
      const v = getRowValue(row, { name: measureField }, result)
      if (v == null || v === '') continue
      const n = typeof v === 'number' ? v : parseFloat(v)
      if (Number.isFinite(n)) nums.push(n)
    }
    if (nums.length === 0) value = 0
    else switch (measureType) {
      case 'sum': value = nums.reduce((a,b) => a+b, 0); break
      case 'avg': value = nums.reduce((a,b) => a+b, 0) / nums.length; break
      case 'min': value = Math.min(...nums); break
      case 'max': value = Math.max(...nums); break
      default:    value = nums.length
    }
  }

  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  const isInt = Number.isInteger(value) && Number.isInteger(target)
  const fmt = (n) => isInt ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 })

  return (
    <div
      onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ fontSize:32, fontWeight:700, color:C.textPrimary, lineHeight:1 }}>
        {fmt(value)} / {fmt(target)}
      </div>
      <div style={{
        marginTop:14, width:'80%', height:10, borderRadius:5,
        background:C.borderDark, overflow:'hidden',
      }}>
        <div style={{
          width:`${pct}%`, height:'100%', background:C.emerald,
          transition:'width 250ms ease',
        }} />
      </div>
      <div style={{ fontSize:11, color:C.textMuted, marginTop:6 }}>
        {pct.toFixed(0)}%
      </div>
    </div>
  )
}
