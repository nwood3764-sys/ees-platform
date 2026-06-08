import { useState, useEffect } from 'react'
import { useRecharts } from '../lib/RechartsLazy'
import { C, CHART_COLORS } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, loadDashboard, getRowValue } from '../data/reportsService'

// ─── Dashboard Runner ─────────────────────────────────────────────────────
//
// Loads a dashboard, fetches every widget's underlying report in parallel,
// and renders the widgets in a grid. Each widget chooses its own viz
// (table / metric / bar / line / pie / donut / funnel / gauge).

export default function DashboardRunner({ dashboardId, onClose, onEdit, onOpenReport }) {
  const [data, setData]                 = useState(null)        // { dashboard, widgets, filters }
  const [results, setResults]           = useState({})          // widget.id → run result
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filterValues, setFilterValues] = useState({})          // dfilt id → current value

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
    const widgetResults = await Promise.all(
      (dashboardData.widgets || []).map(async w => {
        try {
          const r = await runReport(w.dw_report_id, null, extra)
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
          <button onClick={onEdit}  style={btnSecondary()}>Edit</button>
          <button onClick={onClose} style={btnSecondary()}>Close</button>
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
              <input type="text"
                value={filterValues[f.id] ?? ''}
                onChange={e => setFilterValues(prev => ({ ...prev, [f.id]: e.target.value }))}
                style={{
                  padding:'6px 8px', fontSize:12,
                  background:C.card, color:C.textPrimary,
                  border:`1px solid ${C.border}`, borderRadius:4, font:'inherit',
                }} />
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
          <div style={{
            display:'grid',
            gridTemplateColumns:`repeat(${cols}, 1fr)`,
            gap:16,
          }}>
            {data.widgets.map(w => (
              <DashboardWidgetTile
                key={w.id}
                widget={w}
                result={results[w.id]}
                onOpenReport={onOpenReport}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Widget tile ──────────────────────────────────────────────────────────

function DashboardWidgetTile({ widget, result, onOpenReport }) {
  const span = widget.dw_width || 1
  return (
    <div style={{
      gridColumn: `span ${span}`,
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      overflow: 'hidden', minHeight: 240,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding:'10px 12px', borderBottom:`1px solid ${C.border}`,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        background:C.cardSecondary,
      }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>
          {widget.dw_title || result?.name || 'Widget'}
        </div>
        <button
          onClick={() => onOpenReport?.(widget.dw_report_id)}
          style={{
            background:'transparent', border:'none', color:C.emerald,
            fontSize:11, fontWeight:500, cursor:'pointer', padding:0,
          }}
        >Open Report →</button>
      </div>
      <div style={{ flex:1, padding:12, overflow:'hidden' }}>
        {!result ? (
          <div style={{ fontSize:12, color:C.textMuted }}>Loading…</div>
        ) : result.error ? (
          <div style={{ fontSize:12, color:'#c33' }}>Failed: {result.error.message}</div>
        ) : (
          <WidgetBody widget={widget} result={result} />
        )}
      </div>
    </div>
  )
}

function WidgetBody({ widget, result }) {
  const type = widget.dw_widget_type || 'table'
  const rows = result?.rows || []
  const cols = result?.columns || []

  if (rows.length === 0) {
    return <div style={{ fontSize:12, color:C.textMuted, fontStyle:'italic' }}>No matching rows.</div>
  }

  switch (type) {
    case 'metric':
      return <MetricWidget result={result} widget={widget} />
    case 'bar':
      return <BarWidget result={result} widget={widget} />
    case 'line':
      return <LineWidget result={result} widget={widget} />
    case 'pie':
      return <PieWidget result={result} widget={widget} />
    case 'donut':
      return <PieWidget result={result} widget={widget} donut />
    case 'funnel':
      return <FunnelWidget result={result} widget={widget} />
    case 'gauge':
      return <GaugeWidget result={result} widget={widget} />
    case 'table':
    default:
      return <TableWidget result={result} widget={widget} />
  }
}

// ─── Widget renderers ─────────────────────────────────────────────────────

function MetricWidget({ result, widget }) {
  // Configurable single number. With no measure config, defaults to row count.
  // widget_config: { measure_type, measure_field, label }
  const cfg          = widget.dw_widget_config || {}
  const measureType  = cfg.measure_type  || 'count'
  const measureField = cfg.measure_field || null

  let value, displayLabel
  if (measureType === 'count' || !measureField) {
    value = result.rows.length
    displayLabel = cfg.label || 'rows'
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
    displayLabel = cfg.label || `${measureType} of ${measureField}`
  }

  // Format integers cleanly, decimals to 1 place
  const isInt = Number.isInteger(value)
  const display = isInt
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 })

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%' }}>
      <div style={{ fontSize:48, fontWeight:700, color:C.textPrimary, lineHeight:1 }}>
        {display}
      </div>
      <div style={{ fontSize:12, color:C.textMuted, marginTop:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        {displayLabel}
      </div>
    </div>
  )
}

function TableWidget({ result }) {
  const { rows, columns } = result
  return (
    <div style={{ overflow:'auto', maxHeight:240 }}>
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
function buildChartData(result, widget) {
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
  // labels already substituted by getRowValue).
  const buckets = new Map()
  for (const row of result.rows) {
    const k = getRowValue(row, groupField, result) ?? '—'
    const key = String(k)
    if (!buckets.has(key)) buckets.set(key, [])
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
    aggregated.push({ name, value })
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

function BarWidget({ result, widget }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.BarChart data={data}>
        <R.XAxis dataKey="name" tick={{ fontSize:10 }} />
        <R.YAxis tick={{ fontSize:10 }} />
        <R.Tooltip />
        <R.Bar dataKey="value" fill={C.emerald} />
      </R.BarChart>
    </R.ResponsiveContainer>
  )
}

function LineWidget({ result, widget }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.LineChart data={data}>
        <R.XAxis dataKey="name" tick={{ fontSize:10 }} />
        <R.YAxis tick={{ fontSize:10 }} />
        <R.Tooltip />
        <R.Line type="monotone" dataKey="value" stroke={C.emerald} strokeWidth={2} />
      </R.LineChart>
    </R.ResponsiveContainer>
  )
}

function PieWidget({ result, widget, donut }) {
  const R = useRecharts()
  const data = buildChartData(result, widget)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.PieChart>
        <R.Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={80} innerRadius={donut ? 40 : 0}
          label={(e) => e.name}>
          {data.map((_, i) => (
            <R.Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </R.Pie>
        <R.Tooltip />
      </R.PieChart>
    </R.ResponsiveContainer>
  )
}

function FunnelWidget({ result, widget }) {
  const R = useRecharts()
  const data = buildChartData(result, widget).sort((a, b) => b.value - a.value)
  if (!R) return <div style={{ fontSize:12, color:C.textMuted }}>Loading chart…</div>
  return (
    <R.ResponsiveContainer width="100%" height={240}>
      <R.FunnelChart>
        <R.Tooltip />
        <R.Funnel data={data} dataKey="value" nameKey="name" isAnimationActive={false}>
          {data.map((_, i) => (
            <R.Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </R.Funnel>
      </R.FunnelChart>
    </R.ResponsiveContainer>
  )
}

function GaugeWidget({ result, widget }) {
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
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%' }}>
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
