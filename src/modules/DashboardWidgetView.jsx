import { C, CHART_COLORS, seriesColor } from '../data/constants'
import { PINNED_TABLE, ROW_RULE, pinnedHeaderCell, pinnedFooterCell } from '../lib/pinnedTableHeader'
import { useState, useRef, useEffect } from 'react'
import { getRowValue, saveWidgetColumnWidths } from '../data/reportsService'
import { useColumnResize, resizeGripStyle } from '../lib/columnWidths'
import { dataLabelMode, dataLabelText, labelInkFor, categoryLabel } from '../lib/chartDataLabels'
import {
  reportColumnKey, resolveReportColumnWidths, totalWidth, withColumnWidth, withoutColumnWidth,
} from '../lib/reportColumnWidths'
import { LeapEChart } from '../builder/chartKit/EChartsLazy'
import { TOOLTIP_ITEM, TOOLTIP_AXIS } from '../builder/chartKit/leapEchartsTheme'
import { formatNumber, formatAxisTick } from '../builder/chartKit/formatNumber'

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

export function WidgetBody({ widget, result, canDrill, drillTo, drillWhole, filterValue, onFilterChange }) {
  const type = widget.dw_widget_type || 'table'
  const cfg = widget.dw_widget_config || {}

  // Content widgets render straight from config — no report, no data guard.
  if (type === 'heading') {
    return <div style={{ display:'flex', alignItems:'center', height:'100%',
      justifyContent: cfg.align === 'center' ? 'center' : cfg.align === 'right' ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontSize:18, fontWeight:700, color:C.textPrimary }}>{cfg.text || widget.dw_title || ''}</span>
    </div>
  }
  if (type === 'rich_text') {
    return <div style={{ fontSize:13, color:C.textSecondary, lineHeight:1.55, whiteSpace:'pre-wrap', overflow:'auto', height:'100%' }}>{cfg.content || ''}</div>
  }
  if (type === 'spacer') {
    return <div style={{ display:'flex', alignItems:'center', height:'100%' }}>
      {cfg.divider !== false ? <div style={{ width:'100%', height:1, background:C.borderDark }} /> : null}
    </div>
  }
  if (type === 'image') {
    return cfg.image_url
      ? <img src={cfg.image_url} alt={widget.dw_title || 'Dashboard image'} style={{ width:'100%', height:'100%', objectFit: cfg.image_fit || 'contain' }} />
      : <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set an image URL in the inspector.</div>
  }
  if (type === 'link') {
    return <LinkWidget widget={widget} />
  }

  // Filter widgets carry no report rows — their "data" is the option list.
  if (type === 'filter_picklist' || type === 'filter_toggle' || type === 'filter_date_range') {
    return <FilterWidget type={type} widget={widget} result={result} value={filterValue} onChange={onFilterChange} />
  }

  const rows = result?.rows || []

  // Data-presence guard, per query shape: grouped aggregate (aggregated),
  // 2D pivot (aggregated2d), time buckets (aggregatedTime), single aggregate
  // (aggregatedSingle — 0 is data), raw rows.
  const aggregated = Array.isArray(result?.aggregated) ? result.aggregated : null
  const hasData =
    (aggregated ? aggregated.length > 0 : false) ||
    (Array.isArray(result?.aggregated2d) && result.aggregated2d.length > 0) ||
    (Array.isArray(result?.aggregatedTime) && result.aggregatedTime.length > 0) ||
    (typeof result?.aggregatedSingle === 'number') ||
    (!aggregated && rows.length > 0)
  if (!hasData) {
    return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>No matching rows.</div>
  }

  switch (type) {
    case 'metric':
      return <MetricWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} drillWhole={drillWhole} />
    case 'kpi':
      return <KpiWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'stat':
      return <StatWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'bar':
      return <BarWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'speedometer':
      return <SpeedometerWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'bullet':
      return <BulletWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'progress_ring':
      return <ProgressRingWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'pareto':
      return <ParetoWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'rose':
      return <RoseWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'radar':
      return <RadarWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'sunburst':
      return <SunburstWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'box_plot':
      return <BoxPlotWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'combo':
      return <ComboWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'matrix':
      return <MatrixWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'sankey':
      return <SankeyWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'calendar_heatmap':
      return <CalendarHeatmapWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'multi_row_card':
      return <MultiRowCardWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'rating':
      return <RatingWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'stacked_bar':
      return <SeriesBarWidget result={result} widget={widget} mode="stacked" canDrill={canDrill} drillTo={drillTo} />
    case 'clustered_bar':
      return <SeriesBarWidget result={result} widget={widget} mode="clustered" canDrill={canDrill} drillTo={drillTo} />
    case 'stacked_bar_100':
      return <SeriesBarWidget result={result} widget={widget} mode="stacked100" canDrill={canDrill} drillTo={drillTo} />
    case 'line':
      return <LineWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'area':
      return <AreaWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'pie':
      return <PieWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'donut':
      return <PieWidget result={result} widget={widget} donut canDrill={canDrill} drillTo={drillTo} />
    case 'funnel':
      return <FunnelWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'pyramid':
      return <FunnelWidget result={result} widget={widget} pyramid canDrill={canDrill} drillTo={drillTo} />
    case 'treemap':
      return <TreemapWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'waterfall':
      return <WaterfallWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'heatmap':
      return <HeatmapWidget result={result} widget={widget} canDrill={canDrill} drillTo={drillTo} />
    case 'scatter':
      return <ScatterWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
    case 'histogram':
      return <HistogramWidget result={result} widget={widget} canDrill={canDrill} drillWhole={drillWhole} />
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
  if (typeof result.aggregatedSingle === 'number') {
    // Server-side single-aggregate fast path (no rows were fetched).
    value = result.aggregatedSingle
    displayLabel = cfg.label || (measureType === 'count' || !measureField ? 'rows' : `${measureType} of ${measureField}`)
  } else if (measureType === 'count' || !measureField) {
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

  const display = formatNumber(value, cfg.number_format, cfg.decimals)
  const valueColor = conditionalColor(value, cfg)

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
      <div style={{ fontSize:48, fontWeight:700, color:valueColor, lineHeight:1 }}>
        {display}
      </div>
      <div style={{ fontSize:12, color:C.textMuted, marginTop:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        {displayLabel}
      </div>
    </div>
  )
}

function TableWidget({ result, widget, canDrill, drillWhole }) {
  const { rows, columns } = result
  const cfg = widget?.dw_widget_config || {}

  // Column widths, same rules as a report's: laid out FIXED with an explicit
  // width per column, so re-running the dashboard, changing a filter or a value
  // longer than its column cannot re-measure the table. Dragged on the header
  // edge, saved onto the WIDGET so the layout belongs to the dashboard rather
  // than to one browser (Nicholas, 2026-08-31: "I need to be able to adjust its
  // column widths, and they need to stay at those widths").
  const [widths, setWidths] = useState(() => cfg.column_widths || {})
  const [widthError, setWidthError] = useState(false)
  const widthsRef = useRef(widths)
  widthsRef.current = widths
  const persistWidths = (next) => {
    setWidths(next)
    if (!widget?.id) return          // an unsaved widget in the editor preview
    saveWidgetColumnWidths(widget.id, next)
      .then(() => setWidthError(false))
      .catch(() => setWidthError(true))
  }
  const onResizeStart = useColumnResize({
    setWidth: (key, px) => setWidths(prev => withColumnWidth(prev, key, px)),
    onCommit: (key, px) => persistWidths(withColumnWidth(widthsRef.current, key, px)),
  })

  // Visible columns: the configured ordered subset when present, else all.
  const picked = Array.isArray(cfg.columns) && cfg.columns.length
    ? cfg.columns.map(n => columns.find(c => c.name === n)).filter(Boolean)
    : columns

  // Client-side sort on the (already fetched) rows.
  const sortCol = cfg.table_sort_by ? columns.find(c => c.name === cfg.table_sort_by) : null
  const sortDir = cfg.table_sort_dir === 'asc' ? 1 : -1
  const sorted = sortCol
    ? [...rows].sort((a, b) => {
        const va = getRowValue(a, sortCol, result)
        const vb = getRowValue(b, sortCol, result)
        const na = parseFloat(va), nb = parseFloat(vb)
        if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * sortDir
        return String(va ?? '').localeCompare(String(vb ?? '')) * sortDir
      })
    : rows

  const limit = Number(cfg.row_limit) > 0 ? Number(cfg.row_limit) : 50
  const shown = sorted.slice(0, limit)

  // Totals row: sum every column whose shown values are numeric.
  const totals = cfg.show_totals ? picked.map(c => {
    let sum = 0, any = false
    for (const row of shown) {
      const v = getRowValue(row, c, result)
      const n = typeof v === 'number' ? v : parseFloat(v)
      if (Number.isFinite(n) && v !== null && v !== '') { sum += n; any = true }
    }
    return any ? sum : null
  }) : null
  const fmtTotal = widgetFmt(cfg)

  const colWidths = resolveReportColumnWidths(picked, widths)

  return (
    <div
      onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ overflow:'auto', height:'100%', cursor: canDrill ? 'pointer' : 'default' }}>
      {widthError && (
        <div style={{ fontSize:10, color:C.textSecondary, background:'#e8f1fb', padding:'3px 8px' }}>
          Column width not saved to the dashboard — it holds until this is reopened.
        </div>
      )}
      {/* One definition of a header that stays put — src/lib/pinnedTableHeader.js. */}
      <table style={{ ...PINNED_TABLE, fontSize:11, tableLayout:'fixed', width: totalWidth(colWidths) }}>
        <colgroup>
          {colWidths.map((w, idx) => <col key={idx} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr>
            {picked.map((c, idx) => (
              <th key={idx} style={{
                padding:'4px 8px', fontSize:10, fontWeight:600, color:C.textSecondary,
                textTransform:'uppercase', textAlign:'left', whiteSpace:'nowrap',
                ...pinnedHeaderCell(),
                overflow:'hidden', textOverflow:'ellipsis',
              }}>
                {c.label}
                <div
                  onPointerDown={(e) => { e.stopPropagation(); onResizeStart(reportColumnKey(c), e, colWidths[idx]) }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.preventDefault(); e.stopPropagation()
                    persistWidths(withoutColumnWidth(widthsRef.current, reportColumnKey(c)))
                  }}
                  title="Drag to set this column's width · double-click to reset it"
                  style={resizeGripStyle()}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={row.id || ri}>
              {picked.map((c, ci) => {
                const v = getRowValue(row, c, result)
                return (
                  <td key={ci} style={{ padding:'4px 8px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', ...ROW_RULE }}>
                    {v == null ? '—' : (typeof v === 'object' ? '[obj]' : String(v))}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              {totals.map((t, i) => (
                <td key={i} style={{ padding:'4px 8px', fontWeight:700, fontFamily:'JetBrains Mono, monospace', whiteSpace:'nowrap',
                  ...pinnedFooterCell() }}>
                  {i === 0 && t === null ? `Total (${shown.length})` : t === null ? '' : fmtTotal(t)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
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

// Widget-level formatting helpers shared by the chart renderers. Every number
// a widget shows (label, tooltip, axis tick) goes through the widget's own
// number_format/decimals config so a quantity reads identically everywhere.
function widgetFmt(cfg) {
  return (v) => formatNumber(v, cfg.number_format, cfg.decimals)
}

// Salesforce-style conditional highlighting for metric/KPI values: at or above
// the high breakpoint → emerald, below the low breakpoint → sky, between →
// amber. (Design system: attention states are sky/amber/navy — never red.)
function conditionalColor(value, cfg) {
  const high = Number(cfg.cond_high)
  const low  = Number(cfg.cond_low)
  const hasHigh = cfg.cond_high !== undefined && cfg.cond_high !== null && cfg.cond_high !== '' && Number.isFinite(high)
  const hasLow  = cfg.cond_low  !== undefined && cfg.cond_low  !== null && cfg.cond_low  !== '' && Number.isFinite(low)
  if (!hasHigh && !hasLow) return C.textPrimary
  if (hasHigh && value >= high) return C.emeraldMid || '#2aab72'
  if (hasLow  && value <  low)  return C.sky
  return hasHigh && hasLow ? '#e8a949' : C.textPrimary
}

// Reference line (markLine) shared by bar/line/area — a dashed navy line at a
// configured value on the measure axis.
function referenceMarkLine(cfg, horizontal = false) {
  const v = Number(cfg.reference_value)
  if (cfg.reference_value === undefined || cfg.reference_value === null || cfg.reference_value === '' || !Number.isFinite(v)) return undefined
  return {
    silent: true, symbol: 'none',
    lineStyle: { color: '#1e466b', type: 'dashed', width: 1.5 },
    label: { color: '#1e466b', fontSize: 10, formatter: cfg.reference_label || String(v), position: horizontal ? 'insideEndTop' : 'insideEndTop' },
    data: [horizontal ? { xAxis: v } : { yAxis: v }],
  }
}

// Pivot the 2D aggregate rows ({name, series, value, …}, ordered by group
// total desc) into group list, series list (by series total desc), and a cell
// lookup. Shared by stacked/clustered/100% bars, heatmap.
function pivot2D(rows, groupLimit = 20, seriesLimit = 10) {
  const groups = []
  const seen = new Set()
  const seriesTotals = new Map()
  for (const r of rows) {
    if (!seen.has(r.name)) { seen.add(r.name); groups.push(r.name) }
    seriesTotals.set(r.series, (seriesTotals.get(r.series) || 0) + r.value)
  }
  const seriesNames = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, seriesLimit)
  const limitedGroups = groups.slice(0, groupLimit)
  const cell = new Map(rows.map(r => [r.name + '\u0000' + r.series, r]))
  return { groups: limitedGroups, seriesNames, get: (g, s) => cell.get(g + '\u0000' + s) }
}

function BarWidget({ result, widget, canDrill, drillTo }) {
  const data = buildChartData(result, widget)
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  // Horizontal layout: categories listed top-to-bottom on the Y axis,
  // counts growing left-to-right on the X axis (ranked-bar style). Default
  // for category-count widgets; matches the standard outreach dashboards.
  const horizontal = cfg.orientation !== 'vertical'
  const showLabels = cfg.show_data_labels !== false
  // ECharts renders category axes bottom-up; reverse so rank 1 sits on top.
  const display = horizontal ? [...data].reverse() : data
  const axisTick = (v) => formatAxisTick(v, cfg.number_format)

  const catAxis = {
    type: 'category', data: display.map(d => d.name),
    name: horizontal ? (cfg.y_axis_title || undefined) : (cfg.x_axis_title || undefined),
    axisLabel: { interval: 0, width: horizontal ? 140 : undefined, overflow: 'truncate', hideOverlap: !horizontal },
  }
  const valAxis = {
    type: 'value', axisLabel: { formatter: axisTick },
    name: horizontal ? (cfg.x_axis_title || undefined) : (cfg.y_axis_title || undefined),
    nameTextStyle: { color: C.textMuted, fontSize: 10 },
  }

  const option = {
    animationDuration: 250,
    grid: { left: 8, right: horizontal && showLabels ? 56 : 16, top: 8, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.name}<br/><b>${fmt(p.value)}</b>` },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: [{
      type: 'bar', data: display.map(d => d.value),
      barMaxWidth: 26,
      itemStyle: { color: C.emerald, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      label: {
        show: showLabels, position: horizontal ? 'right' : 'top',
        color: C.textPrimary, fontSize: 10.5, formatter: (p) => fmt(p.value),
      },
      markLine: referenceMarkLine(cfg, horizontal),
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill
    ? (p) => drillTo?.(display[p.dataIndex]?.rawValue)
    : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

function LineWidget({ result, widget, canDrill, drillTo }) {
  const data = buildChartData(result, widget)
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  // Data labels default OFF for lines — a number on every point is noise;
  // the crosshair tooltip carries exact values.
  const showLabels = cfg.show_data_labels === true
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 16, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_AXIS, formatter: (ps) => {
      const p = Array.isArray(ps) ? ps[0] : ps
      return `${p.name}<br/><b>${fmt(p.value)}</b>`
    } },
    xAxis: { type: 'category', data: data.map(d => d.name), boundaryGap: false, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: [{
      type: 'line', data: data.map(d => d.value),
      lineStyle: { width: 2, color: C.emerald },
      itemStyle: { color: C.emerald, borderColor: '#ffffff', borderWidth: 2 },
      symbol: 'circle', symbolSize: 7,
      areaStyle: { color: C.emerald, opacity: 0.06 },
      label: { show: showLabels, color: C.textPrimary, fontSize: 10.5, formatter: (p) => fmt(p.value) },
      markLine: referenceMarkLine(cfg),
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(data[p.dataIndex]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// A pie you can actually read.
//
// Nicholas, 2026-08-31: "There's no way this should look like this, and the text
// is so goofy. What kind of font is that?"
//
// The legend is HTML, not an ECharts legend, and that is the whole difference.
// ECharts lays a legend out in its own canvas coordinate space: it does not know
// the tile's width, its rich-text column widths do not constrain an entry, and
// the only way to make a value column line up inside it was to set the whole
// thing in a monospace face — which is what read as "goofy", and was a straight
// violation of the design system (Inter for UI, JetBrains Mono for numbers
// ONLY). At a narrow tile width its fixed pixel legend also sat on top of the
// circle.
//
// So the widget is a flex row: the chart takes the space it has, and the legend
// is a real list beside it — names in Inter truncating with CSS, values in mono,
// right-aligned, scrolling when there are more than fit. Below a threshold width
// the row becomes a column and the legend sits under the chart. Both are checked
// by screenshotting the real widget at real tile sizes
// (tools/pie-legend-check).
// A tile narrower than this cannot hold a legend BESIDE the chart and still
// show a pie — but that is only ever applied when the author asked for 'auto'.
// It used to be applied to 'right' as well, which is how a legend set to the
// right in the editor arrived at the BOTTOM on the rendered page: the runner's
// tile is narrower than the canvas tile, it crossed this threshold, and the
// widget silently re-laid itself out. (Nicholas, 2026-08-31: "I put the legend
// to the right, but then when I look at the actual rendered page, it pushed it
// to the bottom. That can't happen. You got to keep fidelity.") A layout the
// author chose is now honoured literally everywhere it is drawn; responsive
// behaviour is a THIRD choice they can opt into, never a silent override.
const PIE_LEGEND_MIN_WIDTH = 400   // px of TILE below which 'auto' puts the legend under
// The legend is a SHARE of the tile, not a fixed column. It used to be a hard
// 210px with `flex: 0 0 auto`, so widening the tile widened the CHART and never
// the legend — the names stayed truncated no matter how much room you gave it
// (Nicholas, 2026-08-31: "even when I made the element way wider, it's still
// cutting off the names of the property owners"). Bounded at both ends: below
// the floor a legend is unreadable anyway, and past the ceiling it starves the
// pie it is labelling.
const PIE_LEGEND_FRACTION  = 0.42
const PIE_LEGEND_MIN_COL   = 190
const PIE_LEGEND_MAX_COL   = 520
const pieLegendWidth = (tileWidth) => {
  const w = tileWidth || 0
  const want = Math.max(PIE_LEGEND_MIN_COL, Math.min(PIE_LEGEND_MAX_COL, w * PIE_LEGEND_FRACTION))
  // Never more than 60% of the tile: honouring "legend on the right" on a
  // narrow tile must not squeeze the pie out of existence.
  return Math.round(w > 0 ? Math.min(want, w * 0.6) : want)
}
const PIE_INSIDE_LABEL_MIN_PCT = 9 // a slice smaller than this has no room for text
// Part-to-whole reads at a glance up to about six wedges; past that adjacent
// slices blur and the chart stops answering anything. The tail folds into one
// "Other" wedge, which the legend still names.
const PIE_MAX_SLICES = 6

// The element's own width, so the widget lays itself out from the space it
// actually has rather than from a guess. A dashboard tile is resized by
// dragging, so this has to follow it, not sample it once.
function useElementWidth(ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [ref])
  return width
}

function PieWidget({ result, widget, donut, canDrill, drillTo }) {
  const raw = buildChartData(result, widget)
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  // `auto` on a pie means the share, which is what the boolean used to show.
  const labelMode = dataLabelMode(cfg, 'percent')
  const showLegend = cfg.show_legend !== false
  const hostRef = useRef(null)
  const width = useElementWidth(hostRef)
  // Until the first measurement lands, assume there is room: a tile that starts
  // as a column and jumps to a row on the next frame reads as a flicker.
  // 'right' and 'bottom' are LITERAL — the same layout in the editor, on the
  // dashboard, and at any tile size. Only 'auto' consults the width.
  const legendPos = cfg.legend_position || 'right'
  const legendBeside = showLegend && (
    legendPos === 'right' ? true
      : legendPos === 'bottom' ? false
      : (width === 0 || width >= PIE_LEGEND_MIN_WIDTH)   // 'auto'
  )

  // Fold the tail into one wedge, keeping its parts for the tooltip.
  const sorted = [...raw].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
  const head = sorted.slice(0, PIE_MAX_SLICES)
  const tail = sorted.slice(PIE_MAX_SLICES)
  // A group with no value is "(blank)", not an em dash the reader has to
  // interpret — the same word the summary report uses for the same thing.
  for (const d of sorted) d.name = categoryLabel(d.name)
  const data = tail.length > 0
    ? [...head, {
        name: `Other (${tail.length})`,
        value: tail.reduce((a, d) => a + (Number(d.value) || 0), 0),
        _tail: tail,
      }]
    : head

  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0)
  const byName = Object.fromEntries(data.map(d => [d.name, d]))
  const share = (v) => (total > 0 ? (Number(v) || 0) / total * 100 : 0)

  const option = {
    animationDuration: 250,
    tooltip: {
      ...TOOLTIP_ITEM,
      formatter: (p) => {
        const d = byName[p.name]
        const head2 = `${p.name}<br/><b>${fmt(p.value)}</b> · ${p.percent}%`
        if (!d?._tail) return head2
        // "Other" names what it swallowed rather than hiding it.
        const parts = d._tail.slice(0, 6).map(t => `${t.name} · ${fmt(t.value)}`).join('<br/>')
        const more = d._tail.length > 6 ? `<br/>… and ${d._tail.length - 6} more` : ''
        return `${head2}<br/><span style="opacity:.7">${parts}${more}</span>`
      },
    },
    legend: { show: false },   // the legend is HTML, beside this
    title: donut ? {
      text: fmt(total), subtext: 'Total', left: 'center', top: '40%', textAlign: 'center',
      textStyle: { fontSize: 20, fontWeight: 700, color: C.textPrimary, fontFamily: "'JetBrains Mono', monospace" },
      subtextStyle: { fontSize: 11, color: C.textMuted, fontFamily: "'Inter', system-ui, sans-serif" },
    } : undefined,
    series: [{
      type: 'pie',
      data: data.map((d, i) => {
        const fill = seriesColor(i)
        return {
          name: d.name, value: d.value,
          // The ink rides on the datum, because it depends on THIS wedge's fill.
          label: { color: labelInkFor(fill) },
        }
      }),
      radius: donut ? ['54%', '78%'] : '76%',
      center: ['50%', '50%'],
      // A 2px surface gap between fills, per the mark spec — adjacent wedges
      // must not touch.
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 3 },
      // Selective direct labels, inside the wedge, only where there is room —
      // and in ink CHOSEN from the wedge's own fill. It was a hardcoded white,
      // which on this palette's light emerald and sky is about 1.9:1 and
      // unreadable (Nicholas: "Why would you have white text? I can't even see
      // that shit"). Never a leader line: they are what collided.
      label: labelMode === 'none'
        ? { show: false }
        : { show: true, position: 'inside', fontSize: 11, fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            color: undefined,   // per-slice, set in the data below
            formatter: (p) => dataLabelText(labelMode, {
              value: p.value, percent: p.percent, fmt,
              autoMode: 'percent', minPercent: PIE_INSIDE_LABEL_MIN_PCT,
            }) },
      labelLine: { show: false },
      emphasis: { scaleSize: 6 },
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(byName[p.name]?.rawValue) : undefined

  return (
    <div ref={hostRef} style={{
      height: '100%', minHeight: 0, display: 'flex', gap: 10, overflow: 'hidden',
      flexDirection: legendBeside ? 'row' : 'column',
    }}>
      {/* `flex: 1 1 0%` with minHeight/minWidth 0 and overflow hidden: a flex
          child's default basis is its CONTENT, and a canvas reports the size it
          was last drawn at — so with `auto` the chart refuses to shrink and
          spills over the legend under it in a short tile. */}
      <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {/* minHeight={0}: LeapEChart defaults to a 200px floor, which in a short
            tile with the legend underneath leaves the canvas taller than its
            box — the pie then renders with its bottom sliced off. The flex row
            above already guarantees a sane size. */}
        <LeapEChart option={option} onSeriesClick={onSeriesClick} minHeight={0} />
      </div>
      {showLegend && (
        <SeriesLegend
          data={data} total={total} fmt={fmt} share={share}
          beside={legendBeside} width={pieLegendWidth(width)} onPick={onSeriesClick}
          showValue={cfg.legend_show_value !== false}
          showPercent={cfg.legend_show_percent !== false}
          valuePosition={cfg.legend_value_position || 'right'}
        />
      )}
    </div>
  )
}

// The legend, in HTML: a swatch, the name in Inter truncating with an ellipsis,
// the value and share in mono, right-aligned so the numbers form a column. Text
// wears text tokens — the swatch carries the identity, never the words.
function SeriesLegend({
  data, total, fmt, share, beside, width, onPick,
  showValue = true, showPercent = true, valuePosition = 'right',
}) {
  // Each number is its own switch: turning the count off must not take the
  // share with it, and vice versa. With both off the legend is names only,
  // which is a legitimate choice when the wedges already carry their labels.
  const numbers = (d) => {
    const cells = []
    if (showValue) cells.push(
      <span key="v" style={{
        flex: '0 0 auto', fontSize: 11.5, fontWeight: 600, color: C.textPrimary,
        fontFamily: "'JetBrains Mono', monospace",
        // Before the name the numbers form a left column, so they need a fixed
        // width to line up; after it they hug the right edge and do not.
        ...(valuePosition === 'left' ? { minWidth: 34, textAlign: 'right' } : {}),
      }}>{fmt(d.value)}</span>
    )
    if (showPercent) cells.push(
      <span key="p" style={{
        flex: '0 0 auto', width: 42, textAlign: 'right', fontSize: 10.5, color: C.textMuted,
        fontFamily: "'JetBrains Mono', monospace",
      }}>{share(d.value).toFixed(1)}%</span>
    )
    return cells
  }

  return (
    <div style={{
      ...(beside
        ? { width, flex: '0 0 auto', maxHeight: '100%' }
        : { width: '100%', flex: '0 1 auto', maxHeight: '42%', minHeight: 0 }),
      overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column', gap: 4,
      alignSelf: beside ? 'center' : 'stretch',
      paddingRight: 2,
    }}>
      {data.map((d, i) => {
        const nums = numbers(d)
        const name = (
          <span key="n" style={{
            flex: '1 1 auto', minWidth: 0, fontSize: 11.5, color: C.textSecondary,
            fontFamily: "'Inter', system-ui, sans-serif",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{d.name}</span>
        )
        return (
          <div
            key={d.name}
            // The full name is always reachable on hover, however narrow the tile.
            title={`${d.name} · ${fmt(d.value)} · ${share(d.value).toFixed(1)}%`}
            onClick={onPick ? () => onPick({ name: d.name }) : undefined}
            style={{
              display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
              cursor: onPick ? 'pointer' : 'default', lineHeight: 1.35,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto',
              background: seriesColor(i), alignSelf: 'center',
            }} />
            {valuePosition === 'left' ? [...nums, name] : [name, ...nums]}
          </div>
        )
      })}
    </div>
  )
}

function FunnelWidget({ result, widget, pyramid, canDrill, drillTo }) {
  const raw = [...buildChartData(result, widget)].sort((a, b) => b.value - a.value)
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const labelMode = dataLabelMode(cfg, 'value')
  const showLegend = cfg.show_legend !== false
  const hostRef = useRef(null)
  const width = useElementWidth(hostRef)
  const legendPos = cfg.legend_position || 'right'
  const legendBeside = showLegend && (
    legendPos === 'right' ? true
      : legendPos === 'bottom' ? false
      : (width === 0 || width >= PIE_LEGEND_MIN_WIDTH)
  )

  const data = raw.map(d => ({ ...d, name: categoryLabel(d.name) }))
  const first = data[0]?.value || 0
  const total = data.reduce((a, d) => a + (Number(d.value) || 0), 0)
  const share = (v) => (total > 0 ? (Number(v) || 0) / total * 100 : 0)
  const byName = Object.fromEntries(data.map(d => [d.name, d]))

  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => {
      const conv = first > 0 ? ` · ${Math.round((p.value / first) * 100)}% of top` : ''
      return `${p.name}<br/><b>${fmt(p.value)}</b>${conv}`
    } },
    series: [{
      // Pyramid = the same stage chart with the widest band at the bottom.
      type: 'funnel',
      data: data.map((d, i) => {
        const fill = seriesColor(i)
        return { name: d.name, value: d.value, label: { color: labelInkFor(fill) } }
      }),
      sort: pyramid ? 'ascending' : 'descending',
      // A real gap between bands, like a Salesforce funnel — 2px read as a
      // seam, not a separation.
      gap: 3,
      // The chart now uses the WHOLE tile. It used to reserve 26% on the right
      // for outside labels, which still were not wide enough: the names ran off
      // the edge and their leader lines crossed the bands (Nicholas: "This
      // funnel is crazy... unbelievably unattractive"). Names live in the
      // legend now, where they have room and can be read.
      left: 6, right: 6, top: 6, bottom: 6,
      // The floor is what stops a funnel becoming a wide head on a hairline
      // stem. At 33 → 1 the old 14% floor drew a band two pixels wide; a stage
      // that exists has to be visible, and the taper still reads from top to
      // bottom because every band above it is wider.
      minSize: '38%', maxSize: '100%',
      itemStyle: { borderColor: '#ffffff', borderWidth: 1, borderRadius: 2 },
      // Inside the band, in ink chosen from that band's own fill, and never a
      // leader line — the leader lines ARE what collided.
      label: labelMode === 'none'
        ? { show: false }
        : { show: true, position: 'inside', fontSize: 11, fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            formatter: (p) => dataLabelText(labelMode, {
              value: p.value, percent: share(p.value), fmt, autoMode: 'value',
            }) },
      labelLine: { show: false },
      emphasis: { disabled: false },
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(byName[p.name]?.rawValue) : undefined

  return (
    <div ref={hostRef} style={{
      height: '100%', minHeight: 0, display: 'flex', gap: 10, overflow: 'hidden',
      flexDirection: legendBeside ? 'row' : 'column',
    }}>
      <div style={{ flex: '1 1 0%', minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <LeapEChart option={option} onSeriesClick={onSeriesClick} minHeight={0} />
      </div>
      {showLegend && (
        <SeriesLegend
          data={data} total={total} fmt={fmt} share={share}
          beside={legendBeside} width={pieLegendWidth(width)} onPick={onSeriesClick}
          showValue={cfg.legend_show_value !== false}
          showPercent={cfg.legend_show_percent !== false}
          valuePosition={cfg.legend_value_position || 'right'}
        />
      )}
    </div>
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
  const cfg = widget.dw_widget_config || {}
  const fmtValue = widgetFmt(cfg)
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
              {fmtValue(d.value)}
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
  const fmt = widgetFmt(cfg)

  const option = {
    animationDuration: 250,
    series: [{
      type: 'gauge',
      startAngle: 210, endAngle: -30,
      min: 0, max: Math.max(target, value, 1),
      progress: { show: true, roundCap: true, width: 14, itemStyle: { color: C.emerald } },
      axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, '#e4e9f2']] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      anchor: { show: false },
      detail: {
        valueAnimation: true, offsetCenter: [0, '-8%'],
        formatter: () => fmt(value),
        color: C.textPrimary, fontSize: 26, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
      },
      title: { offsetCenter: [0, '22%'], color: C.textMuted, fontSize: 11 },
      data: [{ value, name: `${pct.toFixed(0)}% of ${fmt(target)}` }],
    }],
  }
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ height: '100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <LeapEChart option={option} minHeight={160} />
    </div>
  )
}

// ─── Series charts (2D pivot shape: aggregated2d) ─────────────────────────

// Stacked / clustered / 100%-stacked bars from the category × series pivot.
function SeriesBarWidget({ result, widget, mode, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows = result.aggregated2d || []
  if (!rows.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows, cfg.limit || 20)
  const pct = mode === 'stacked100'
  const horizontal = cfg.orientation === 'horizontal'
  const displayGroups = horizontal ? [...groups].reverse() : groups

  // Per-group totals for the 100% normalization.
  const groupTotal = Object.fromEntries(displayGroups.map(g => [
    g, seriesNames.reduce((a, s) => a + (get(g, s)?.value || 0), 0) || 1,
  ]))

  const catAxis = { type: 'category', data: displayGroups, axisLabel: { interval: 0, width: horizontal ? 140 : undefined, overflow: 'truncate', hideOverlap: !horizontal } }
  const valAxis = {
    type: 'value',
    max: pct ? 100 : undefined,
    axisLabel: { formatter: (v) => pct ? `${v}%` : formatAxisTick(v, cfg.number_format) },
  }

  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 16, top: 30, bottom: 4, containLabel: true },
    legend: cfg.show_legend !== false ? { top: 0, left: 0, type: 'scroll' } : { show: false },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => {
      const cellRow = get(displayGroups[p.dataIndex], p.seriesName)
      const raw = cellRow?.value ?? 0
      return `${p.name} · ${p.seriesName}<br/><b>${fmt(raw)}</b>${pct ? ` (${Number(p.value).toFixed(1)}%)` : ''}`
    } },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? catAxis : valAxis,
    series: seriesNames.map((s) => ({
      name: s, type: 'bar',
      stack: mode === 'clustered' ? undefined : 'total',
      barMaxWidth: mode === 'clustered' ? 18 : 30,
      itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
      emphasis: { focus: 'series' },
      data: displayGroups.map(g => {
        const v = get(g, s)?.value || 0
        return pct ? Math.round((v / groupTotal[g]) * 1000) / 10 : v
      }),
      cursor: canDrill ? 'pointer' : 'default',
    })),
  }
  const onSeriesClick = canDrill
    ? (p) => drillTo?.(get(displayGroups[p.dataIndex], p.seriesName)?.rawValue)
    : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Heatmap: groups × series grid, cell color = value.
function HeatmapWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows = result.aggregated2d || []
  if (!rows.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows, cfg.limit || 20, 12)
  const data = []
  let max = 0
  groups.forEach((g, gi) => seriesNames.forEach((s, si) => {
    const v = get(g, s)?.value || 0
    if (v > max) max = v
    data.push([gi, si, v])
  }))
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 16, top: 8, bottom: 36, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) =>
      `${groups[p.value[0]]} · ${seriesNames[p.value[1]]}<br/><b>${fmt(p.value[2])}</b>` },
    xAxis: { type: 'category', data: groups, axisLabel: { interval: 0, overflow: 'truncate', width: 90, hideOverlap: true } },
    yAxis: { type: 'category', data: seriesNames, axisLabel: { overflow: 'truncate', width: 120 } },
    visualMap: {
      min: 0, max: Math.max(max, 1), orient: 'horizontal', left: 'center', bottom: 0,
      itemWidth: 10, itemHeight: 70, text: ['More', ''],
      textStyle: { color: C.textMuted, fontSize: 10 },
      inRange: { color: ['#eefaf4', '#9fe8c9', C.emerald, '#2aab72'] },
    },
    series: [{
      type: 'heatmap', data,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 3 },
      label: { show: cfg.show_data_labels !== false, color: C.textPrimary, fontSize: 9.5,
        formatter: (p) => fmt(p.value[2]) },
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill
    ? (p) => drillTo?.(get(groups[p.value[0]], seriesNames[p.value[1]])?.rawValue)
    : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// ─── Time charts (time-bucket shape: aggregatedTime) ──────────────────────

// Area chart over real date buckets, optionally stacked by a series field.
function AreaWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows = result.aggregatedTime || []
  if (!rows.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set a Date field in the inspector.</div>

  const buckets = []
  const seen = new Set()
  for (const r of rows) { if (!seen.has(r.name)) { seen.add(r.name); buckets.push(r.name) } }
  const hasSeries = rows.some(r => r.series != null)
  const seriesNames = hasSeries ? [...new Set(rows.map(r => r.series))] : [null]
  const byKey = new Map(rows.map(r => [r.name + '|' + (r.series ?? ''), r.value]))

  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 16, top: hasSeries ? 30 : 12, bottom: 4, containLabel: true },
    legend: hasSeries && cfg.show_legend !== false ? { top: 0, left: 0, type: 'scroll' } : { show: false },
    tooltip: { ...TOOLTIP_AXIS, formatter: (ps) => {
      const list = Array.isArray(ps) ? ps : [ps]
      return `${list[0]?.name}<br/>` + list.map(p => `${hasSeries ? p.seriesName + ': ' : ''}<b>${fmt(p.value)}</b>`).join('<br/>')
    } },
    xAxis: { type: 'category', data: buckets, boundaryGap: false, axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: seriesNames.map((s, i) => ({
      name: hasSeries ? s : (widget.dw_title || 'Value'),
      type: 'line',
      stack: hasSeries ? 'total' : undefined,
      data: buckets.map(b => byKey.get(b + '|' + (s ?? '')) ?? 0),
      lineStyle: { width: 2 },
      symbol: 'circle', symbolSize: 6,
      itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
      areaStyle: { opacity: hasSeries ? 0.35 : 0.10 },
      emphasis: { focus: hasSeries ? 'series' : 'none' },
      markLine: i === 0 ? referenceMarkLine(cfg) : undefined,
      cursor: canDrill ? 'pointer' : 'default',
    })),
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// ─── Part-to-whole extras (grouped aggregate shape) ───────────────────────

function TreemapWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const data = buildChartData(result, widget)
  const byName = Object.fromEntries(data.map(d => [d.name, d]))
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.name}<br/><b>${fmt(p.value)}</b>` },
    series: [{
      type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false },
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, gapWidth: 2 },
      label: { color: '#ffffff', fontSize: 11,
        formatter: cfg.show_data_labels !== false ? (p) => `${p.name}\n${fmt(p.value)}` : (p) => p.name },
      data: data.map(d => ({ name: d.name, value: d.value })),
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(byName[p.name]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Waterfall: each category's value as a floating bar on a running total.
function WaterfallWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const data = buildChartData(result, widget)
  let running = 0
  const base = []
  const delta = []
  for (const d of data) {
    const v = Number(d.value) || 0
    base.push(v >= 0 ? running : running + v)
    delta.push(v)
    running += v
  }
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 14, top: 14, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.name}<br/><b>${fmt(delta[p.dataIndex])}</b>` },
    xAxis: { type: 'category', data: data.map(d => d.name), axisLabel: { interval: 0, overflow: 'truncate', width: 80, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: [
      { type: 'bar', stack: 'w', silent: true,
        itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } },
        data: base, tooltip: { show: false } },
      { type: 'bar', stack: 'w', barMaxWidth: 32,
        data: delta.map(v => ({
          value: Math.abs(v),
          itemStyle: { color: v >= 0 ? C.emerald : C.sky, borderRadius: [4, 4, 0, 0] },
        })),
        label: { show: cfg.show_data_labels !== false, position: 'top', fontSize: 10, color: C.textPrimary,
          formatter: (p) => fmt(delta[p.dataIndex]) },
        cursor: canDrill ? 'pointer' : 'default' },
    ],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(data[p.dataIndex]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// ─── Row-shape charts (client-side compute from report rows) ──────────────

// Scatter: two numeric report columns, one point per record.
function ScatterWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const xCol = (result.columns || []).find(c => c.name === cfg.x_field)
  const yCol = (result.columns || []).find(c => c.name === cfg.y_field)
  if (!xCol || !yCol) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set X and Y fields in the inspector.</div>
  const pts = []
  for (const row of (result.rows || [])) {
    const x = parseFloat(getRowValue(row, xCol, result))
    const y = parseFloat(getRowValue(row, yCol, result))
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y])
    if (pts.length >= 1000) break
  }
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 14, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) =>
      `${xCol.label || cfg.x_field}: <b>${formatNumber(p.value[0], cfg.number_format, cfg.decimals)}</b><br/>` +
      `${yCol.label || cfg.y_field}: <b>${formatNumber(p.value[1], cfg.number_format, cfg.decimals)}</b>` },
    xAxis: { type: 'value', name: cfg.x_axis_title || xCol.label || cfg.x_field, nameTextStyle: { color: C.textMuted, fontSize: 10 },
      axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    yAxis: { type: 'value', name: cfg.y_axis_title || yCol.label || cfg.y_field, nameTextStyle: { color: C.textMuted, fontSize: 10 },
      axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: [{ type: 'scatter', data: pts, symbolSize: 10,
      itemStyle: { color: C.sky, borderColor: '#ffffff', borderWidth: 1.5, opacity: 0.9 },
      cursor: canDrill ? 'pointer' : 'default' }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// Histogram: bins one numeric report column into a frequency distribution.
function HistogramWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const col = (result.columns || []).find(c => c.name === cfg.value_field)
  if (!col) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set a Value field in the inspector.</div>
  const nums = []
  for (const row of (result.rows || [])) {
    const n = parseFloat(getRowValue(row, col, result))
    if (Number.isFinite(n)) nums.push(n)
  }
  if (!nums.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>No numeric values.</div>
  const binCount = Math.max(3, Math.min(30, Number(cfg.bin_count) || 10))
  const min = Math.min(...nums), max = Math.max(...nums)
  const width = (max - min) / binCount || 1
  const bins = Array.from({ length: binCount }, () => 0)
  for (const n of nums) bins[Math.min(binCount - 1, Math.floor((n - min) / width))]++
  const labels = bins.map((_, i) =>
    `${formatAxisTick(min + i * width, cfg.number_format)}-${formatAxisTick(min + (i + 1) * width, cfg.number_format)}`)
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 14, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${labels[p.dataIndex]}<br/><b>${p.value}</b> records` },
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9.5, hideOverlap: true } },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: bins, barCategoryGap: '8%',
      itemStyle: { color: C.emerald, borderRadius: [3, 3, 0, 0] },
      label: { show: cfg.show_data_labels === true, position: 'top', fontSize: 10, color: C.textPrimary },
      cursor: canDrill ? 'pointer' : 'default' }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// ─── KPI & stat cards (single-aggregate shape) ────────────────────────────

// KPI card: value vs target with delta chip and progress bar.
function KpiWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const value = typeof result.aggregatedSingle === 'number' ? result.aggregatedSingle : (result.rows || []).length
  const target = Number(cfg.target) || 0
  const fmt = widgetFmt(cfg)
  const pct = target > 0 ? (value / target) * 100 : null
  const onTrack = pct !== null && pct >= 100
  const valueColor = conditionalColor(value, cfg)
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ display:'flex', flexDirection:'column', justifyContent:'center', height:'100%', gap:10, padding:'0 6px', cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:40, fontWeight:700, lineHeight:1, color:valueColor, fontFamily:'JetBrains Mono, monospace' }}>{fmt(value)}</span>
        {pct !== null && (
          <span style={{
            fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:99,
            background: onTrack ? '#eefaf4' : '#e8f1fb',
            color: onTrack ? '#2aab72' : C.sky,
            border: `1px solid ${onTrack ? C.emerald : C.sky}`,
          }}>{pct.toFixed(0)}% of {fmt(target)}</span>
        )}
      </div>
      {target > 0 && (
        <div style={{ width:'100%', height:8, borderRadius:4, background:C.cardSecondary, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          <div style={{ width:`${Math.min(100, pct)}%`, height:'100%', background: onTrack ? C.emerald : C.sky }} />
        </div>
      )}
      <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>
        {cfg.label || 'vs target'}
      </div>
    </div>
  )
}

// Stat card: big number + sparkline trend from time buckets.
function StatWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const value = typeof result.aggregatedSingle === 'number' ? result.aggregatedSingle : (result.rows || []).length
  const fmt = widgetFmt(cfg)
  const trend = result.aggregatedTime || []
  const valueColor = conditionalColor(value, cfg)
  const sparkOption = trend.length >= 2 ? {
    animationDuration: 250,
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: { type: 'category', show: false, data: trend.map(t => t.name), boundaryGap: false },
    yAxis: { type: 'value', show: false },
    tooltip: { ...TOOLTIP_AXIS, formatter: (ps) => {
      const p = Array.isArray(ps) ? ps[0] : ps
      return `${p.name}<br/><b>${fmt(p.value)}</b>`
    } },
    series: [{ type: 'line', data: trend.map(t => t.value),
      lineStyle: { width: 2, color: C.emerald }, symbol: 'none',
      areaStyle: { color: C.emerald, opacity: 0.10 },
      emphasis: { itemStyle: { color: C.emerald } } }],
  } : null
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ display:'flex', flexDirection:'column', height:'100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ fontSize:38, fontWeight:700, lineHeight:1.05, color:valueColor, fontFamily:'JetBrains Mono, monospace' }}>{fmt(value)}</div>
      <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginTop:4 }}>
        {cfg.label || 'records'}
      </div>
      {sparkOption
        ? <div style={{ flex:1, minHeight:0, marginTop:6 }}><LeapEChart option={sparkOption} minHeight={40} /></div>
        : <div style={{ flex:1 }} />}
    </div>
  )
}

// ─── Round-2 widgets: combo, matrix, sankey, calendar, cards, filters ─────

// Combo: primary measure as bars + secondary measure as a line, one grouping.
// A second value axis is opt-in (combo_dual_axis) for measures on different
// scales — Salesforce parity; single-axis remains the default.
function ComboWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const fmt2 = (v) => formatNumber(v, cfg.number2_format || cfg.number_format, cfg.decimals)
  const data = buildChartData(result, widget)
  const second = result.aggregatedSecondary || []
  const secondByName = new Map(second.map(d => [d.name, d.value]))
  const dual = cfg.combo_dual_axis === true && second.length > 0
  const names = data.map(d => d.name)

  const option = {
    animationDuration: 250,
    grid: { left: 8, right: dual ? 8 : 16, top: 30, bottom: 4, containLabel: true },
    legend: cfg.show_legend !== false ? { top: 0, left: 0 } : { show: false },
    tooltip: { ...TOOLTIP_AXIS, formatter: (ps) => {
      const list = Array.isArray(ps) ? ps : [ps]
      return `${list[0]?.name}<br/>` + list.map(p =>
        `${p.seriesName}: <b>${p.seriesIndex === 0 ? fmt(p.value) : fmt2(p.value)}</b>`).join('<br/>')
    } },
    xAxis: { type: 'category', data: names, axisLabel: { interval: 0, overflow: 'truncate', width: 90, hideOverlap: true } },
    yAxis: dual
      ? [
          { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
          { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number2_format || cfg.number_format) }, splitLine: { show: false } },
        ]
      : { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: [
      {
        name: cfg.measure_label || 'Bars', type: 'bar', barMaxWidth: 26,
        itemStyle: { color: C.emerald, borderRadius: [4, 4, 0, 0] },
        data: data.map(d => d.value),
        label: { show: cfg.show_data_labels === true, position: 'top', fontSize: 10, color: C.textPrimary, formatter: (p) => fmt(p.value) },
        cursor: canDrill ? 'pointer' : 'default',
      },
      ...(second.length ? [{
        name: cfg.measure2_label || 'Line', type: 'line',
        yAxisIndex: dual ? 1 : 0,
        data: names.map(n => secondByName.get(n) ?? 0),
        lineStyle: { width: 2, color: C.navy },
        itemStyle: { color: '#1e466b', borderColor: '#ffffff', borderWidth: 2 },
        symbol: 'circle', symbolSize: 7,
      }] : []),
    ],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(data[p.dataIndex]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Matrix / highlight table: rows × columns × measure with totals, cells
// shaded by value (Tableau highlight-table behavior, on by default).
function MatrixWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows2d = result.aggregated2d || []
  if (!rows2d.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows2d, cfg.limit || 30, 12)
  const highlight = cfg.highlight_cells !== false
  let maxCell = 0
  groups.forEach(g => seriesNames.forEach(s => { const v = get(g, s)?.value || 0; if (v > maxCell) maxCell = v }))
  const shade = (v) => {
    if (!highlight || maxCell <= 0 || !v) return 'transparent'
    const t = v / maxCell
    if (t > 0.75) return '#bff0da'
    if (t > 0.5)  return '#d9f6e9'
    if (t > 0.25) return '#eefaf4'
    return 'transparent'
  }
  const rowTotal = (g) => seriesNames.reduce((a, s) => a + (get(g, s)?.value || 0), 0)
  const colTotal = (s) => groups.reduce((a, g) => a + (get(g, s)?.value || 0), 0)
  const grand = groups.reduce((a, g) => a + rowTotal(g), 0)
  const th = { padding:'5px 9px', fontSize:10, fontWeight:600, color:C.textSecondary, textTransform:'uppercase', whiteSpace:'nowrap', textAlign:'right',
    ...pinnedHeaderCell() }
  const td = { padding:'5px 9px', fontSize:11.5, whiteSpace:'nowrap', textAlign:'right', fontFamily:'JetBrains Mono, monospace', borderBottom:`1px solid ${C.border}` }
  return (
    <div style={{ overflow:'auto', height:'100%' }}>
      <table style={PINNED_TABLE}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign:'left' }}></th>
            {seriesNames.map(s => <th key={s} style={th}>{s}</th>)}
            <th style={{ ...th, borderLeft:`2px solid ${C.borderDark}` }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g}>
              <td style={{ ...td, textAlign:'left', fontFamily:'inherit', color:C.textPrimary, fontWeight:500 }}>{g}</td>
              {seriesNames.map(s => {
                const cell = get(g, s)
                const v = cell?.value || 0
                return (
                  <td key={s}
                    onClick={canDrill && cell ? () => drillTo?.(cell.rawValue) : undefined}
                    style={{ ...td, background: shade(v), cursor: canDrill && cell ? 'pointer' : 'default' }}>
                    {v ? fmt(v) : '—'}
                  </td>
                )
              })}
              <td style={{ ...td, fontWeight:700, borderLeft:`2px solid ${C.borderDark}` }}>{fmt(rowTotal(g))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background:C.cardSecondary }}>
            <td style={{ ...td, textAlign:'left', fontFamily:'inherit', fontWeight:700 }}>Total</td>
            {seriesNames.map(s => <td key={s} style={{ ...td, fontWeight:700 }}>{fmt(colTotal(s))}</td>)}
            <td style={{ ...td, fontWeight:700, borderLeft:`2px solid ${C.borderDark}` }}>{fmt(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// Sankey: flow volume from the group dimension to the series dimension.
function SankeyWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows2d = result.aggregated2d || []
  if (!rows2d.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows2d, cfg.limit || 12, 12)
  // Node names must be unique across both sides; suffix the target side when
  // a label appears in both dimensions.
  const leftSet = new Set(groups)
  const rightName = (s) => leftSet.has(s) ? `${s} ` : s
  const nodes = [...groups.map(g => ({ name: g })), ...seriesNames.map(s => ({ name: rightName(s) }))]
  const links = []
  groups.forEach(g => seriesNames.forEach(s => {
    const v = get(g, s)?.value || 0
    if (v > 0) links.push({ source: g, target: rightName(s), value: v })
  }))
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) =>
      p.dataType === 'edge'
        ? `${p.data.source} → ${p.data.target}<br/><b>${fmt(p.data.value)}</b>`
        : `${p.name}` },
    series: [{
      type: 'sankey', data: nodes, links,
      left: 8, right: 90, top: 8, bottom: 8,
      nodeWidth: 12, nodeGap: 10,
      lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
      itemStyle: { borderColor: '#ffffff', borderWidth: 1 },
      label: { color: C.textSecondary, fontSize: 11 },
      emphasis: { focus: 'adjacency' },
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// Calendar heatmap: daily activity density on a real calendar.
function CalendarHeatmapWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows = result.aggregatedTime || []
  if (!rows.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set a Date field in the inspector.</div>
  const byDay = new Map()
  let max = 0
  for (const r of rows) {
    const day = String(r.bucket).slice(0, 10)
    const v = (byDay.get(day) || 0) + r.value
    byDay.set(day, v)
    if (v > max) max = v
  }
  const days = [...byDay.keys()].sort()
  const range = [days[0], days[days.length - 1]]
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.value[0]}<br/><b>${fmt(p.value[1])}</b>` },
    visualMap: {
      min: 0, max: Math.max(max, 1), orient: 'horizontal', left: 'center', bottom: 0,
      itemWidth: 10, itemHeight: 70, text: ['More', ''],
      textStyle: { color: C.textMuted, fontSize: 10 },
      inRange: { color: ['#eefaf4', '#9fe8c9', C.emerald, '#2aab72'] },
    },
    calendar: {
      range, left: 34, right: 10, top: 22, bottom: 34, cellSize: ['auto', 'auto'],
      itemStyle: { color: C.cardSecondary, borderColor: '#ffffff', borderWidth: 2 },
      splitLine: { lineStyle: { color: C.borderDark, width: 1 } },
      dayLabel: { color: C.textMuted, fontSize: 9, firstDay: 1 },
      monthLabel: { color: C.textSecondary, fontSize: 10 },
      yearLabel: { show: false },
    },
    series: [{
      type: 'heatmap', coordinateSystem: 'calendar',
      data: days.map(d => [d, byDay.get(d)]),
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// Multi-row card: one compact stat block per group value (Power BI pattern).
function MultiRowCardWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const data = buildChartData(result, widget)
  if (!data.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by in the inspector.</div>
  return (
    <div style={{
      display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(130px, 1fr))',
      gap:8, overflowY:'auto', height:'100%', alignContent:'start',
    }}>
      {data.map((d, i) => (
        <div key={i}
          onClick={canDrill ? () => drillTo?.(d.rawValue) : undefined}
          style={{
            background:C.cardSecondary, border:`1px solid ${C.border}`, borderRadius:6,
            borderLeft:`3px solid ${C.emerald}`, padding:'8px 10px',
            cursor: canDrill ? 'pointer' : 'default',
          }}>
          <div style={{ fontSize:17, fontWeight:700, color:C.textPrimary, fontFamily:'JetBrains Mono, monospace', lineHeight:1.1 }}>{fmt(d.value)}</div>
          <div style={{ fontSize:10.5, color:C.textSecondary, marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={d.name}>{d.name}</div>
        </div>
      ))}
    </div>
  )
}

// Rating: the aggregate rendered as filled stars out of a configurable max.
function RatingWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const value = typeof result.aggregatedSingle === 'number' ? result.aggregatedSingle : (result.rows || []).length
  const maxStars = Math.max(1, Math.min(10, Number(cfg.rating_max) || 5))
  const fill = Math.max(0, Math.min(maxStars, value))
  const fmt = widgetFmt(cfg)
  const star = (frac, i) => (
    <svg key={i} width="26" height="26" viewBox="0 0 24 24">
      <defs><linearGradient id={`rw-${widget.id || 'x'}-${i}`}><stop offset={`${frac * 100}%`} stopColor={C.emerald} /><stop offset={`${frac * 100}%`} stopColor={C.borderDark} /></linearGradient></defs>
      <path fill={`url(#rw-${widget.id || 'x'}-${i})`} d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z" />
    </svg>
  )
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:8, cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ display:'flex', gap:3 }}>
        {Array.from({ length: maxStars }, (_, i) => star(Math.max(0, Math.min(1, fill - i)), i))}
      </div>
      <div style={{ fontSize:13, color:C.textSecondary }}>
        <b style={{ color:C.textPrimary, fontFamily:'JetBrains Mono, monospace' }}>{fmt(value)}</b> of {maxStars}
      </div>
      {cfg.label && <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>{cfg.label}</div>}
    </div>
  )
}

// Link: a navigation card to a record, module, report, or external URL.
function LinkWidget({ widget }) {
  const cfg = widget.dw_widget_config || {}
  const url = cfg.link_url || ''
  const external = /^https?:\/\//i.test(url)
  const body = (
    <div style={{
      display:'flex', alignItems:'center', gap:10, height:'100%',
      padding:'0 4px', color:C.textPrimary,
    }}>
      <span style={{
        width:34, height:34, borderRadius:8, background:'#eefaf4', border:`1px solid ${C.emerald}`,
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.emerald} strokeWidth="2">
          <path d="M10 14L21 3M21 3h-6M21 3v6M9 3H4v17h17v-5" />
        </svg>
      </span>
      <span style={{ minWidth:0 }}>
        <span style={{ display:'block', fontSize:13.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {cfg.link_label || widget.dw_title || url || 'Set a link URL in the inspector'}
        </span>
        {cfg.link_description && (
          <span style={{ display:'block', fontSize:11, color:C.textMuted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cfg.link_description}</span>
        )}
      </span>
    </div>
  )
  if (!url) return body
  return (
    <a href={url} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}
      style={{ textDecoration:'none', display:'block', height:'100%' }}>
      {body}
    </a>
  )
}

// On-canvas filter widgets. Value state lives in DashboardRunner; the builder
// renders them inert (no onChange wired). Picklist = dropdown, toggle =
// button row, date range = from/to inputs producing {from, to}.
function FilterWidget({ type, widget, result, value, onChange }) {
  const cfg = widget.dw_widget_config || {}
  const opts = result?.filterOptions || []
  const disabled = !onChange
  if (!cfg.filter_field) {
    return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Pick a field in the inspector.</div>
  }
  const inputCss = {
    padding:'7px 9px', fontSize:12.5, background:C.card, color:C.textPrimary,
    border:`1px solid ${C.borderDark}`, borderRadius:6, font:'inherit', width:'100%', boxSizing:'border-box',
  }

  if (type === 'filter_date_range') {
    const v = value || {}
    const set = (patch) => onChange?.({ ...v, ...patch })
    return (
      <div style={{ display:'flex', gap:8, alignItems:'center', height:'100%' }}>
        <input type="date" value={v.from || ''} disabled={disabled}
          onChange={e => set({ from: e.target.value })} style={inputCss} />
        <span style={{ color:C.textMuted, fontSize:12, flexShrink:0 }}>to</span>
        <input type="date" value={v.to || ''} disabled={disabled}
          onChange={e => set({ to: e.target.value })} style={inputCss} />
      </div>
    )
  }

  if (type === 'filter_toggle') {
    const shown = opts.slice(0, Number(cfg.max_options) || 6)
    return (
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignContent:'center', height:'100%' }}>
        <button disabled={disabled} onClick={() => onChange?.('')} style={toggleBtn(!value)}>All</button>
        {shown.map(o => (
          <button key={o.value} disabled={disabled}
            onClick={() => onChange?.(String(value) === String(o.value) ? '' : o.value)}
            style={toggleBtn(String(value) === String(o.value))}>{o.label}</button>
        ))}
        {!opts.length && <span style={{ fontSize:11, color:C.textMuted, fontStyle:'italic' }}>No values found.</span>}
      </div>
    )
  }

  return (
    <div style={{ display:'flex', alignItems:'center', height:'100%' }}>
      <select value={value ?? ''} disabled={disabled}
        onChange={e => onChange?.(e.target.value)} style={{ ...inputCss, cursor: disabled ? 'default' : 'pointer' }}>
        <option value="">All</option>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function toggleBtn(active) {
  return {
    padding:'6px 12px', fontSize:12, fontWeight:500, borderRadius:99, cursor:'pointer',
    background: active ? '#eefaf4' : C.card,
    color: active ? '#2aab72' : C.textSecondary,
    border: `1px solid ${active ? C.emerald : C.borderDark}`,
  }
}

// ─── Goal & progress family (single-aggregate shape) ──────────────────────

// Shared value/target computation for the goal widgets.
function goalNumbers(result, cfg) {
  const value = typeof result.aggregatedSingle === 'number' ? result.aggregatedSingle : (result.rows || []).length
  const target = Number(cfg.target) || 0
  const max = Math.max(target, value, 1)
  return { value, target, max }
}

// Speedometer ("gas gauge"): needle + colored segment bands. Segments come
// from the conditional breakpoints (sky below low, amber between, emerald at
// or above high); defaults to thirds of the scale when unset. No red — the
// design system's attention colors are sky and amber.
function SpeedometerWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const { value, target, max } = goalNumbers(result, cfg)
  const lowRaw  = Number(cfg.cond_low)
  const highRaw = Number(cfg.cond_high)
  const low  = Number.isFinite(lowRaw)  && cfg.cond_low  !== '' && cfg.cond_low  != null ? lowRaw  : max / 3
  const high = Number.isFinite(highRaw) && cfg.cond_high !== '' && cfg.cond_high != null ? highRaw : (max * 2) / 3
  const stops = [
    [Math.max(0.02, Math.min(1, low / max)),  C.sky],
    [Math.max(0.04, Math.min(1, high / max)), '#e8a949'],
    [1, C.emerald],
  ]
  const option = {
    animationDuration: 250,
    series: [{
      type: 'gauge',
      startAngle: 205, endAngle: -25,
      min: 0, max,
      axisLine: { lineStyle: { width: 16, color: stops } },
      pointer: {
        show: true, length: '58%', width: 5,
        itemStyle: { color: '#1e466b' },
      },
      anchor: { show: true, size: 12, itemStyle: { color: '#1e466b', borderColor: '#ffffff', borderWidth: 2 } },
      axisTick: { distance: -16, length: 4, lineStyle: { color: '#ffffff', width: 1 } },
      splitLine: { distance: -16, length: 16, lineStyle: { color: '#ffffff', width: 2 } },
      axisLabel: { distance: 22, color: C.textMuted, fontSize: 9, formatter: (v) => formatAxisTick(v, cfg.number_format) },
      detail: {
        valueAnimation: true, offsetCenter: [0, '62%'],
        formatter: () => fmt(value),
        color: C.textPrimary, fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
      },
      title: { offsetCenter: [0, '88%'], color: C.textMuted, fontSize: 10.5 },
      data: [{ value, name: target > 0 ? `${Math.round((value / target) * 100)}% of ${fmt(target)}` : (cfg.label || '') }],
    }],
  }
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined} style={{ height: '100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <LeapEChart option={option} minHeight={160} />
    </div>
  )
}

// Bullet / linear gauge: qualitative bands + measure bar + target tick
// (Tableau bullet graph / Salesforce flat gauge). Pure DOM — crisper than a
// canvas at this size.
function BulletWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const { value, target, max } = goalNumbers(result, cfg)
  const lowRaw  = Number(cfg.cond_low)
  const highRaw = Number(cfg.cond_high)
  const low  = Number.isFinite(lowRaw)  && cfg.cond_low  !== '' && cfg.cond_low  != null ? lowRaw  : max / 3
  const high = Number.isFinite(highRaw) && cfg.cond_high !== '' && cfg.cond_high != null ? highRaw : (max * 2) / 3
  const pct = (n) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined}
      style={{ display:'flex', flexDirection:'column', justifyContent:'center', height:'100%', gap:8, padding:'0 4px', cursor: canDrill ? 'pointer' : 'default' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
        <span style={{ fontSize:24, fontWeight:700, color:C.textPrimary, fontFamily:"'JetBrains Mono', monospace" }}>{fmt(value)}</span>
        {target > 0 && <span style={{ fontSize:11, color:C.textMuted }}>target {fmt(target)}</span>}
      </div>
      <div style={{ position:'relative', height:18, borderRadius:4, overflow:'hidden', background:C.cardSecondary }}>
        <div style={{ position:'absolute', inset:0, display:'flex' }}>
          <div style={{ width:pct(low), background:'#dcebfa' }} />
          <div style={{ width:`calc(${pct(high)} - ${pct(low)})`, background:'#f7e6c8' }} />
          <div style={{ flex:1, background:'#d9f6e9' }} />
        </div>
        <div style={{ position:'absolute', left:0, top:5, height:8, width:pct(value), background:'#1e466b', borderRadius:'0 3px 3px 0' }} />
        {target > 0 && (
          <div style={{ position:'absolute', left:`calc(${pct(target)} - 1.5px)`, top:1, height:16, width:3, background:C.textPrimary, borderRadius:1 }} />
        )}
      </div>
      {cfg.label && <div style={{ fontSize:10.5, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>{cfg.label}</div>}
    </div>
  )
}

// Progress ring: percent-to-goal as a donut ring with the % in the hole.
function ProgressRingWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const { value, target } = goalNumbers(result, cfg)
  const pct = target > 0 ? Math.min(100, Math.max(0, (value / target) * 100)) : 0
  const option = {
    animationDuration: 250,
    tooltip: { show: false },
    title: {
      text: `${pct.toFixed(0)}%`,
      subtext: target > 0 ? `${fmt(value)} of ${fmt(target)}` : fmt(value),
      left: 'center', top: '36%',
      textStyle: { fontSize: 24, fontWeight: 700, color: C.textPrimary, fontFamily: "'JetBrains Mono', monospace" },
      subtextStyle: { fontSize: 10.5, color: C.textMuted },
    },
    series: [{
      type: 'pie', radius: ['68%', '84%'], center: ['50%', '50%'],
      startAngle: 90, silent: true,
      label: { show: false }, labelLine: { show: false },
      data: [
        { value: pct, itemStyle: { color: pct >= 100 ? C.emerald : pct >= 50 ? C.emerald : C.sky, borderRadius: 8 } },
        { value: 100 - pct, itemStyle: { color: '#e4e9f2' } },
      ],
    }],
  }
  return (
    <div onClick={canDrill ? () => drillWhole?.() : undefined} style={{ height: '100%', cursor: canDrill ? 'pointer' : 'default' }}>
      <LeapEChart option={option} minHeight={150} />
    </div>
  )
}

// ─── More chart forms ─────────────────────────────────────────────────────

// Pareto: categories ranked descending + cumulative-percent line (the 80/20
// view). The one chart where a second axis is standard: 0–100% cumulative.
function ParetoWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const data = [...buildChartData(result, widget)].sort((a, b) => b.value - a.value)
  const total = data.reduce((a, d) => a + d.value, 0) || 1
  let run = 0
  const cum = data.map(d => { run += d.value; return Math.round((run / total) * 1000) / 10 })
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 8, top: 14, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_AXIS, formatter: (ps) => {
      const list = Array.isArray(ps) ? ps : [ps]
      const bar = list.find(p => p.seriesType === 'bar')
      const ln  = list.find(p => p.seriesType === 'line')
      return `${list[0]?.name}<br/><b>${fmt(bar?.value ?? 0)}</b>${ln ? ` · ${ln.value}% cumulative` : ''}`
    } },
    xAxis: { type: 'category', data: data.map(d => d.name), axisLabel: { interval: 0, overflow: 'truncate', width: 70, hideOverlap: true } },
    yAxis: [
      { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
      { type: 'value', min: 0, max: 100, axisLabel: { formatter: (v) => `${v}%` }, splitLine: { show: false } },
    ],
    series: [
      { type: 'bar', data: data.map(d => d.value), barMaxWidth: 26,
        itemStyle: { color: C.emerald, borderRadius: [4, 4, 0, 0] },
        cursor: canDrill ? 'pointer' : 'default' },
      { type: 'line', yAxisIndex: 1, data: cum,
        lineStyle: { width: 2, color: '#1e466b' },
        itemStyle: { color: '#1e466b', borderColor: '#ffffff', borderWidth: 2 },
        symbol: 'circle', symbolSize: 6 },
    ],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(data[p.dataIndex]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Rose (Nightingale): pie variant where slice radius encodes the value.
function RoseWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const data = buildChartData(result, widget)
  const byName = Object.fromEntries(data.map(d => [d.name, d]))
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.name}<br/><b>${fmt(p.value)}</b> · ${p.percent}%` },
    legend: cfg.show_legend !== false ? { type: 'scroll', bottom: 0, left: 'center' } : { show: false },
    series: [{
      type: 'pie', roseType: 'radius',
      radius: ['16%', '72%'], center: ['50%', cfg.show_legend !== false ? '44%' : '50%'],
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 4 },
      label: { show: cfg.show_data_labels !== false, color: C.textSecondary, fontSize: 10.5, formatter: (p) => p.name },
      labelLine: { length: 8, length2: 6, lineStyle: { color: C.borderDark } },
      data: data.map(d => ({ name: d.name, value: d.value })),
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill ? (p) => drillTo?.(byName[p.name]?.rawValue) : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Radar: each series draws a polygon across the group-value axes.
function RadarWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows2d = result.aggregated2d || []
  if (!rows2d.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows2d, 8, 5)
  let maxV = 1
  groups.forEach(g => seriesNames.forEach(s => { const v = get(g, s)?.value || 0; if (v > maxV) maxV = v }))
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM },
    legend: cfg.show_legend !== false ? { type: 'scroll', bottom: 0, left: 'center' } : { show: false },
    radar: {
      indicator: groups.map(g => ({ name: g, max: maxV * 1.1 })),
      center: ['50%', '46%'], radius: '62%',
      axisName: { color: C.textSecondary, fontSize: 10.5 },
      splitLine: { lineStyle: { color: '#e4e9f2' } },
      splitArea: { areaStyle: { color: ['#ffffff', '#f7f9fc'] } },
      axisLine: { lineStyle: { color: '#d0d8e8' } },
    },
    series: [{
      type: 'radar',
      data: seriesNames.map(s => ({
        name: s,
        value: groups.map(g => get(g, s)?.value || 0),
        areaStyle: { opacity: 0.12 },
        lineStyle: { width: 2 },
        symbolSize: 5,
      })),
      tooltip: { formatter: (p) => `${p.name}<br/>` + groups.map((g, i) => `${g}: <b>${fmt(p.value[i])}</b>`).join('<br/>') },
    }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}

// Sunburst: two-ring hierarchy — inner = group, outer = its series split.
function SunburstWidget({ result, widget, canDrill, drillTo }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const rows2d = result.aggregated2d || []
  if (!rows2d.length) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set Group by and Series in the inspector.</div>
  const { groups, seriesNames, get } = pivot2D(rows2d, cfg.limit || 10, 10)
  const rawByPath = new Map()
  const data = groups.map(g => ({
    name: g,
    children: seriesNames
      .map(s => {
        const cell = get(g, s)
        if (!cell || !cell.value) return null
        rawByPath.set(`${g}>${s}`, cell.rawValue)
        return { name: s, value: cell.value }
      })
      .filter(Boolean),
  })).filter(n => n.children.length)
  const option = {
    animationDuration: 250,
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => `${p.treePathInfo?.map(t => t.name).filter(Boolean).join(' · ') || p.name}<br/><b>${fmt(p.value)}</b>` },
    series: [{
      type: 'sunburst', data, radius: ['12%', '85%'],
      itemStyle: { borderColor: '#ffffff', borderWidth: 2, borderRadius: 3 },
      label: { color: C.textPrimary, fontSize: 10, minAngle: 12 },
      nodeClick: false,
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  const onSeriesClick = canDrill
    ? (p) => {
        const path = p.treePathInfo?.map(t => t.name).filter(Boolean) || []
        drillTo?.(path.length === 2 ? rawByPath.get(`${path[0]}>${path[1]}`) : undefined)
      }
    : undefined
  return <LeapEChart option={option} onSeriesClick={onSeriesClick} />
}

// Box plot: min / Q1 / median / Q3 / max of a numeric field per category,
// computed client-side from the report rows.
function BoxPlotWidget({ result, widget, canDrill, drillWhole }) {
  const cfg = widget.dw_widget_config || {}
  const fmt = widgetFmt(cfg)
  const valCol = (result.columns || []).find(c => c.name === cfg.value_field)
  if (!valCol) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>Set a Value field in the inspector.</div>
  const groupCol = cfg.group_by ? (result.columns || []).find(c => c.name === cfg.group_by) : null

  const byGroup = new Map()
  for (const row of (result.rows || [])) {
    const n = parseFloat(getRowValue(row, valCol, result))
    if (!Number.isFinite(n)) continue
    const g = groupCol ? String(getRowValue(row, groupCol, result) ?? '—') : 'All'
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(n)
  }
  if (!byGroup.size) return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>No numeric values.</div>

  const quartile = (sorted, q) => {
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos), hi = Math.ceil(pos)
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
  }
  const cats = [...byGroup.keys()].slice(0, cfg.limit || 12)
  const boxes = cats.map(g => {
    const s = byGroup.get(g).sort((a, b) => a - b)
    return [s[0], quartile(s, 0.25), quartile(s, 0.5), quartile(s, 0.75), s[s.length - 1]]
  })
  const option = {
    animationDuration: 250,
    grid: { left: 8, right: 14, top: 12, bottom: 4, containLabel: true },
    tooltip: { ...TOOLTIP_ITEM, formatter: (p) => {
      const b = boxes[p.dataIndex] || []
      return `${cats[p.dataIndex]}<br/>max <b>${fmt(b[4])}</b><br/>Q3 <b>${fmt(b[3])}</b><br/>median <b>${fmt(b[2])}</b><br/>Q1 <b>${fmt(b[1])}</b><br/>min <b>${fmt(b[0])}</b>`
    } },
    xAxis: { type: 'category', data: cats, axisLabel: { interval: 0, overflow: 'truncate', width: 80, hideOverlap: true } },
    yAxis: { type: 'value', axisLabel: { formatter: (v) => formatAxisTick(v, cfg.number_format) } },
    series: [{
      type: 'boxplot', data: boxes,
      itemStyle: { color: '#d9f6e9', borderColor: '#2aab72', borderWidth: 1.5 },
      cursor: canDrill ? 'pointer' : 'default',
    }],
  }
  return <LeapEChart option={option} onSeriesClick={canDrill ? () => drillWhole?.() : undefined} />
}
