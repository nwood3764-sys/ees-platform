import { useState, useEffect } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  FunnelChart, Funnel,
} from 'recharts'
import { C, CHART_COLORS } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, loadDashboard, getRowValue } from '../data/reportsService'

// ─── Dashboard Runner ─────────────────────────────────────────────────────
//
// Loads a dashboard, fetches every widget's underlying report in parallel,
// and renders the widgets in a grid. Each widget chooses its own viz
// (table / metric / bar / line / pie / donut / funnel / gauge).

export default function DashboardRunner({ dashboardId, onClose, onEdit, onOpenReport }) {
  const [data, setData]       = useState(null)        // { dashboard, widgets, filters }
  const [results, setResults] = useState({})          // widget.id → run result
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      const d = await loadDashboard(dashboardId)
      if (!d) throw new Error('Dashboard not found')
      setData(d)
      // Fan out report runs in parallel. Slow widgets don't block fast ones.
      const widgetResults = await Promise.all(
        (d.widgets || []).map(async w => {
          try {
            const r = await runReport(w.dw_report_id)
            return [w.id, r]
          } catch (err) {
            return [w.id, { error: err }]
          }
        })
      )
      setResults(Object.fromEntries(widgetResults))
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={refresh} />
  if (!data)   return null

  const cols = data.dashboard.dash_columns || 3

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

function MetricWidget({ result }) {
  // Single big number — count of rows by default. Custom numeric column
  // via widget_config.metric_column (sums it).
  const count = result.rows.length
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%' }}>
      <div style={{ fontSize:48, fontWeight:700, color:C.textPrimary, lineHeight:1 }}>
        {count.toLocaleString()}
      </div>
      <div style={{ fontSize:12, color:C.textMuted, marginTop:6, textTransform:'uppercase', letterSpacing:0.5 }}>
        rows
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

// Group rows for a chart by their first selected field, count by default.
function buildChartData(result, widget) {
  const cfg = widget.dw_widget_config || {}
  const groupCol = cfg.group_by || (result.columns?.[0]?.name) || null
  if (!groupCol) return []
  const groupCount = new Map()
  for (const row of result.rows) {
    const v = getRowValue(row, { name: groupCol }, result) ?? '—'
    groupCount.set(v, (groupCount.get(v) || 0) + 1)
  }
  return Array.from(groupCount, ([name, value]) => ({ name: String(name), value }))
}

function BarWidget({ result, widget }) {
  const data = buildChartData(result, widget)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize:10 }} />
        <YAxis tick={{ fontSize:10 }} />
        <Tooltip />
        <Bar dataKey="value" fill={C.emerald} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function LineWidget({ result, widget }) {
  const data = buildChartData(result, widget)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize:10 }} />
        <YAxis tick={{ fontSize:10 }} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={C.emerald} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function PieWidget({ result, widget, donut }) {
  const data = buildChartData(result, widget)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
          outerRadius={80} innerRadius={donut ? 40 : 0}
          label={(e) => e.name}>
          {data.map((_, i) => (
            <Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  )
}

function FunnelWidget({ result, widget }) {
  const data = buildChartData(result, widget).sort((a, b) => b.value - a.value)
  return (
    <ResponsiveContainer width="100%" height={240}>
      <FunnelChart>
        <Tooltip />
        <Funnel data={data} dataKey="value" nameKey="name" isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={(CHART_COLORS && CHART_COLORS[i % CHART_COLORS.length]) || C.emerald} />
          ))}
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  )
}

function GaugeWidget({ result, widget }) {
  // Simple "progress toward target" gauge. widget_config.target sets the
  // denominator; numerator is the row count.
  const cfg = widget.dw_widget_config || {}
  const target = cfg.target || 100
  const value = result.rows.length
  const pct = Math.min(100, (value / target) * 100)
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%' }}>
      <div style={{ fontSize:32, fontWeight:700, color:C.textPrimary, lineHeight:1 }}>
        {value.toLocaleString()} / {target.toLocaleString()}
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
