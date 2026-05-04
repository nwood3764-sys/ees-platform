import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, getRowValue } from '../data/reportsService'
import { evaluateRowExpression } from '../lib/reportFormulaEval'

// ─── Report Runner ────────────────────────────────────────────────────────
//
// Phase 2c.1: Tabular reports rendered as a flat table.
// Phase 2c.2: Summary reports (groupings + subtotals) and Matrix layout.
// Calculated fields evaluator wires in here.
//
// Loaded with a reportId. Calls runReport() once on mount; result drives
// the table render. "Run Again" reruns the same query (useful when the
// underlying data has changed).

export default function ReportRunner({ reportId, onClose, onEdit }) {
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const run = async () => {
    setLoading(true); setError(null)
    try {
      const r = await runReport(reportId)
      setResult(r)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={run} />
  if (!result) return null

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:C.page }}>
      {/* Header */}
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ fontSize:11, color:C.textMuted }}>Report</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>{result.name}</div>
          <div style={{ fontSize:11, color:C.textMuted }}>
            {result.rows.length.toLocaleString()} rows · {result.format} · {result.primaryObject}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={run}    style={btnSecondary()}>Run Again</button>
          <button onClick={() => exportCsv(result)} style={btnSecondary()}>Export CSV</button>
          <button onClick={onEdit} style={btnSecondary()}>Edit</button>
          <button onClick={onClose} style={btnSecondary()}>Close</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, overflow:'auto', padding:'16px 24px' }}>
        {result.format === 'tabular' && <TabularLayout result={result} />}
        {result.format === 'summary' && <SummaryLayout result={result} />}
        {result.format === 'matrix'  && <MatrixLayout  result={result} />}
      </div>
    </div>
  )
}

// ─── Tabular layout ───────────────────────────────────────────────────────

function TabularLayout({ result }) {
  const { rows, columns, calculatedFields } = result
  // Row-scope calculated fields appear as additional columns alongside the
  // selected fields. Summary-scope calculated fields show on the totals
  // row in SummaryLayout — not relevant for tabular.
  const rowCalcFields = (calculatedFields || []).filter(c => c.scope === 'row')
  const allColumns = [
    ...columns,
    ...rowCalcFields.map(c => ({ ...c, _calc: true, label: c.label || '(calc)' })),
  ]

  if (allColumns.length === 0) {
    return <EmptyState message="No fields selected. Edit the report to add fields." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead style={{ background:C.cardSecondary, position:'sticky', top:0, zIndex:1 }}>
          <tr>
            {allColumns.map((c, idx) => (
              <th key={`h-${idx}`} style={cellHeaderStyle()}>
                {c.label}
                {c._calc && <span style={{ marginLeft:4, fontSize:10, color:C.emerald }}>ƒ</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={row.id || rowIdx} style={{
              borderTop: `1px solid ${C.border}`,
            }}>
              {allColumns.map((c, idx) => {
                if (c._calc) {
                  // Build a flat row of resolved values and evaluate the
                  // expression. Field names in the expression match the
                  // column.name (i.e. the original SQL column name).
                  const resolvedRow = {}
                  for (const col of columns) {
                    resolvedRow[col.name] = getRowValue(row, col, result)
                  }
                  const v = evaluateRowExpression(c.expression, resolvedRow)
                  return (
                    <td key={`r-${rowIdx}-${idx}`} style={cellStyle()}>
                      {formatCellValue(v, c.data_type)}
                    </td>
                  )
                }
                const v = getRowValue(row, c, result)
                return (
                  <td key={`r-${rowIdx}-${idx}`} style={cellStyle()}>
                    {formatCellValue(v, c.type)}
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

// ─── Summary layout (Phase 2c.2) ──────────────────────────────────────────

function SummaryLayout({ result }) {
  const { rows, columns, groupings } = result
  if (groupings.length === 0) {
    return <EmptyState message="Summary reports require at least one grouping. Edit the report to add groupings." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }

  // Group rows iteratively by each grouping level. Output is a tree of
  // { value, level, rows, children, subtotal }
  const tree = buildGroupTree(rows, columns, groupings, 0, result)

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead style={{ background:C.cardSecondary, position:'sticky', top:0, zIndex:1 }}>
          <tr>
            {columns.map((c, idx) => (
              <th key={`h-${idx}`} style={cellHeaderStyle()}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <SummaryTreeRows nodes={tree} columns={columns} groupings={groupings} depth={0} ctx={result} />
          <SummaryTotalRow rows={rows} columns={columns} />
        </tbody>
      </table>
    </div>
  )
}

function buildGroupTree(rows, columns, groupings, level = 0, ctx = null) {
  if (level >= groupings.length) {
    return { leafRows: rows }
  }
  const g = groupings[level]
  const buckets = new Map()
  for (const row of rows) {
    // Lookup the grouping field's value. via_path resolved by getRowValue.
    const fieldDef = { name: g.field_name, via_path: g.field_via_path }
    const key = getRowValue(row, fieldDef, ctx)
    const k = key ?? '(blank)'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(row)
  }
  // Sort group keys
  const sorted = Array.from(buckets.entries()).sort((a, b) => {
    const dir = g.sort_direction === 'desc' ? -1 : 1
    if (a[0] === b[0]) return 0
    return a[0] < b[0] ? -1 * dir : 1 * dir
  })
  return {
    groupingLevel: level,
    children: sorted.map(([key, group_rows]) => ({
      value: key,
      level,
      rows: group_rows,
      child: buildGroupTree(group_rows, columns, groupings, level + 1, ctx),
    })),
  }
}

function SummaryTreeRows({ nodes, columns, groupings, depth, ctx }) {
  if (!nodes.children) {
    return nodes.leafRows.map((row, idx) => (
      <tr key={`leaf-${idx}`} style={{ borderTop:`1px solid ${C.border}` }}>
        {columns.map((c, ci) => (
          <td key={ci} style={{ ...cellStyle(), paddingLeft: 12 + depth * 16 }}>
            {formatCellValue(getRowValue(row, c, ctx), c.type)}
          </td>
        ))}
      </tr>
    ))
  }
  return nodes.children.map((node, ni) => (
    <SummaryGroupNode key={`g-${depth}-${ni}`}
      node={node} columns={columns} groupings={groupings} depth={depth} ctx={ctx} />
  ))
}

function SummaryGroupNode({ node, columns, groupings, depth, ctx }) {
  const grouping = groupings[depth]
  const showSubtotal = grouping.show_subtotal !== false
  return (
    <>
      <tr style={{ background: C.cardSecondary, borderTop:`2px solid ${C.borderDark}` }}>
        <td colSpan={columns.length} style={{ ...cellStyle(), fontWeight:600, paddingLeft: 12 + depth * 16 }}>
          {grouping.field_label}: {String(node.value)} <span style={{ color:C.textMuted, fontWeight:400 }}>({node.rows.length})</span>
        </td>
      </tr>
      <SummaryTreeRows nodes={node.child} columns={columns} groupings={groupings} depth={depth + 1} ctx={ctx} />
      {showSubtotal && (
        <tr style={{ background: '#f0f3f8', borderTop:`1px solid ${C.borderDark}` }}>
          <td colSpan={columns.length} style={{ ...cellStyle(), fontWeight:500, fontStyle:'italic', color:C.textSecondary, paddingLeft: 12 + depth * 16 }}>
            Subtotal — {grouping.field_label}: {String(node.value)} ({node.rows.length} rows)
          </td>
        </tr>
      )}
    </>
  )
}

function SummaryTotalRow({ rows, columns }) {
  return (
    <tr style={{ background: C.borderDark, borderTop:`2px solid ${C.textSecondary}` }}>
      <td colSpan={columns.length} style={{ ...cellStyle(), fontWeight:700, color:C.textPrimary }}>
        Grand Total — {rows.length} rows
      </td>
    </tr>
  )
}

// ─── Matrix layout (Phase 2c.2 — minimal) ────────────────────────────────

function MatrixLayout({ result }) {
  return (
    <EmptyState message="Matrix reports — full row × column pivot rendering coming in the next pass. For now, switch the report to Summary or Tabular format to view results." />
  )
}

// ─── Cell formatting ──────────────────────────────────────────────────────

function formatCellValue(v, type) {
  if (v == null) return <span style={{ color:C.textMuted }}>—</span>
  if (typeof v === 'object') {
    // Nested object that didn't get unwrapped — common for unresolved FKs
    return <span style={{ color:C.textMuted }}>[obj]</span>
  }
  if (type === 'boolean' || type === 'bool') {
    return v ? 'Yes' : 'No'
  }
  if (type === 'timestamp with time zone' || type === 'timestamptz' || type === 'timestamp') {
    try { return new Date(v).toLocaleString() } catch { return String(v) }
  }
  if (type === 'date') {
    try { return new Date(v).toLocaleDateString() } catch { return String(v) }
  }
  if (typeof v === 'number') {
    return v.toLocaleString()
  }
  // UUIDs make ugly cells; truncate with mono font
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, color:C.textMuted }}>
      {v.slice(0, 8)}…
    </span>
  }
  return String(v)
}

// ─── CSV export ───────────────────────────────────────────────────────────

function exportCsv(result) {
  const { rows, columns, name } = result
  if (!rows || rows.length === 0) return

  const escape = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }

  const header = columns.map(c => escape(c.label)).join(',')
  const dataRows = rows.map(row =>
    columns.map(c => escape(getRowValue(row, c, result))).join(',')
  )
  const csv = [header, ...dataRows].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name || 'report').replace(/[^a-z0-9_-]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Style helpers ────────────────────────────────────────────────────────

function cellHeaderStyle() {
  return {
    padding:'10px 12px', fontSize:11, fontWeight:600, color:C.textSecondary,
    textTransform:'uppercase', letterSpacing:0.5, textAlign:'left',
    borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap',
  }
}

function cellStyle() {
  return {
    padding:'8px 12px', color:C.textPrimary, verticalAlign:'top',
    whiteSpace:'nowrap',
  }
}

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
