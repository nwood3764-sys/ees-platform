import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, getRowValue, getReportPrompts, cloneReport } from '../data/reportsService'
import { evaluateRowExpression, evaluateSummaryExpression, computeAggregates } from '../lib/reportFormulaEval'

// ─── Report Runner ────────────────────────────────────────────────────────
//
// Phase 2c.1: Tabular reports rendered as a flat table.
// Phase 2c.2: Summary reports (groupings + subtotals) and Matrix layout.
// Calculated fields evaluator wires in here.
//
// Loaded with a reportId. Calls runReport() once on mount; result drives
// the table render. "Run Again" reruns the same query (useful when the
// underlying data has changed).

export default function ReportRunner({ reportId, onClose, onEdit, onDuplicate }) {
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [prompts, setPrompts]   = useState(null)        // null = not yet checked, [] = none
  const [promptValues, setPromptValues] = useState({})  // collected user input
  const [duplicating, setDuplicating] = useState(false)
  const [duplicateError, setDuplicateError] = useState(null)

  const run = async (overrides = null) => {
    setLoading(true); setError(null)
    try {
      const r = await runReport(reportId, overrides)
      setResult(r)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  // Duplicate (Save As / Clone). Calls the clone_report RPC, and on
  // success hands the new id up to the parent so the user lands in the
  // Builder for the freshly-cloned record. Errors render as a small
  // banner below the toolbar — same place as runtime errors.
  const handleDuplicate = async () => {
    if (duplicating) return
    setDuplicating(true)
    setDuplicateError(null)
    try {
      const newId = await cloneReport(reportId)
      if (onDuplicate) onDuplicate(newId)
    } catch (err) {
      setDuplicateError(err.message || String(err))
    } finally {
      setDuplicating(false)
    }
  }

  // On mount: check whether the report has any runtime prompts. If yes,
  // surface them in a modal first; the user supplies values and then
  // we call run(). If no, run immediately.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    getReportPrompts(reportId)
      .then(p => {
        if (cancelled) return
        setPrompts(p)
        if (p.length === 0) {
          run(null)
        } else {
          // Initialize promptValues with saved defaults
          const init = {}
          for (const pr of p) init[pr.index] = pr.default_value ?? ''
          setPromptValues(init)
          setLoading(false)
        }
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId])

  // Prompt-collection modal: shown when prompts exist and we haven't run yet.
  const showingPrompts = prompts && prompts.length > 0 && !result && !loading && !error

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={() => run(promptValues)} />

  if (showingPrompts) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:C.page }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:20, width:480, maxWidth:'92vw' }}>
          <div style={{ fontSize:16, fontWeight:600, color:C.textPrimary, marginBottom:6 }}>Run with parameters</div>
          <div style={{ fontSize:12, color:C.textMuted, marginBottom:16 }}>
            This report has runtime prompts. Provide values, then click Run.
          </div>
          {prompts.map(pr => (
            <div key={pr.index} style={{ marginBottom:12 }}>
              <label style={{
                display:'block', fontSize:11, fontWeight:500, color:C.textSecondary,
                marginBottom:4, textTransform:'uppercase', letterSpacing:0.5,
              }}>
                {pr.label}
                <span style={{ color:C.textMuted, marginLeft:6, textTransform:'none' }}>
                  ({pr.field_name} {pr.operator})
                </span>
              </label>
              <PromptInput
                prompt={pr}
                value={promptValues[pr.index] ?? ''}
                onChange={(v) => setPromptValues(prev => ({ ...prev, [pr.index]: v }))}
              />
            </div>
          ))}
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
            <button onClick={onClose} style={btnSecondary()}>Cancel</button>
            <button
              onClick={() => run(promptValues)}
              style={{
                padding:'8px 14px', fontSize:13, fontWeight:500,
                background:C.emerald, color:'#fff',
                border:'none', borderRadius:6, cursor:'pointer',
              }}
            >Run</button>
          </div>
        </div>
      </div>
    )
  }

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
            {result.rows.length.toLocaleString()} rows
            {result.truncated && (
              <span style={{ color:C.amber, fontWeight:500, marginLeft:8 }}>
                · truncated at 50,000 — refine filters or export to see more
              </span>
            )}
            <span> · {result.format} · {result.primaryObject}</span>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button
            onClick={() => {
              if (prompts && prompts.length > 0) {
                // Clear result so the prompt modal shows again
                setResult(null)
              } else {
                run(null)
              }
            }}
            style={btnSecondary()}
          >Run Again</button>
          <button onClick={() => exportCsv(result)}   style={btnSecondary()}>CSV</button>
          <button onClick={() => exportExcel(result)} style={btnSecondary()}>Excel</button>
          <button onClick={() => exportPdf(result)}   style={btnSecondary()}>PDF</button>
          {onEdit && (
            <button onClick={onEdit}  style={btnSecondary()}>Edit</button>
          )}
          {/* Duplicate — Save As / Clone. Hidden when no parent is wired
              up to handle the new id (defensive for embedded usage). */}
          {onDuplicate && (
            <button
              onClick={handleDuplicate}
              disabled={duplicating}
              title="Create a copy of this report you can edit independently"
              style={{
                ...btnSecondary(),
                cursor: duplicating ? 'wait' : 'pointer',
                opacity: duplicating ? 0.6 : 1,
              }}
            >{duplicating ? 'Duplicating…' : 'Duplicate'}</button>
          )}
          <button onClick={onClose} style={btnSecondary()}>Close</button>
        </div>
      </div>

      {/* Duplicate-error banner. Sits between toolbar and body so it's
          impossible to miss but doesn't block the report content. */}
      {duplicateError && (
        <div style={{
          padding: '8px 24px', background: C.cardSecondary, color: C.danger,
          borderBottom: `1px solid ${C.border}`, fontSize: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Duplicate failed: {duplicateError}</span>
          <button
            onClick={() => setDuplicateError(null)}
            style={{ background:'transparent', border:'none', color:C.danger, cursor:'pointer', fontSize:12 }}
          >Dismiss</button>
        </div>
      )}

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
  const { rows, columns, groupings, calculatedFields } = result
  if (groupings.length === 0) {
    return <EmptyState message="Summary reports require at least one grouping. Edit the report to add groupings." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }

  // Summary-scope calculated fields show on group subtotal rows and the
  // grand total row. They use SUM_<field>/COUNT_<field>/AVG_<field>/
  // MIN_<field>/MAX_<field> aggregate identifiers, computed per group
  // before the expression is evaluated.
  const summaryCalcFields = (calculatedFields || []).filter(c => c.scope === 'summary')

  // Numeric column names (from the selected fields) used to build the
  // aggregates the summary expression can reference. Columns keep their
  // raw name regardless of label, since expressions reference column names.
  const aggregableColumnNames = columns.map(c => c.name)

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
          <SummaryTreeRows
            nodes={tree} columns={columns} groupings={groupings} depth={0}
            ctx={result} summaryCalcFields={summaryCalcFields}
            aggregableColumnNames={aggregableColumnNames}
          />
          <SummaryTotalRow
            rows={rows} columns={columns}
            summaryCalcFields={summaryCalcFields}
            aggregableColumnNames={aggregableColumnNames}
            ctx={result}
          />
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

function SummaryTreeRows({ nodes, columns, groupings, depth, ctx, summaryCalcFields, aggregableColumnNames }) {
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
    <SummaryGroupNode
      key={`g-${depth}-${ni}`}
      node={node} columns={columns} groupings={groupings} depth={depth}
      ctx={ctx} summaryCalcFields={summaryCalcFields}
      aggregableColumnNames={aggregableColumnNames}
    />
  ))
}

function SummaryGroupNode({ node, columns, groupings, depth, ctx, summaryCalcFields, aggregableColumnNames }) {
  const grouping = groupings[depth]
  const showSubtotal = grouping.show_subtotal !== false
  return (
    <>
      <tr style={{ background: C.cardSecondary, borderTop:`2px solid ${C.borderDark}` }}>
        <td colSpan={columns.length} style={{ ...cellStyle(), fontWeight:600, paddingLeft: 12 + depth * 16 }}>
          {grouping.field_label}: {String(node.value)} <span style={{ color:C.textMuted, fontWeight:400 }}>({node.rows.length})</span>
        </td>
      </tr>
      <SummaryTreeRows
        nodes={node.child} columns={columns} groupings={groupings} depth={depth + 1}
        ctx={ctx} summaryCalcFields={summaryCalcFields}
        aggregableColumnNames={aggregableColumnNames}
      />
      {showSubtotal && (
        <SummarySubtotalRow
          groupValue={node.value} grouping={grouping} groupRows={node.rows}
          columns={columns} depth={depth} ctx={ctx}
          summaryCalcFields={summaryCalcFields}
          aggregableColumnNames={aggregableColumnNames}
          // Per-grouping-level calc fields: only render those with no
          // grouping_level filter, OR those whose grouping_level matches.
          gradeLevel={depth + 1}
        />
      )}
    </>
  )
}

function SummarySubtotalRow({ groupValue, grouping, groupRows, columns, depth, ctx, summaryCalcFields, aggregableColumnNames, gradeLevel }) {
  // Subtotal label spans roughly the leftmost cells; calc-field values
  // populate trailing columns in the order they appear in summaryCalcFields.
  const applicableCalc = (summaryCalcFields || []).filter(cf =>
    cf.grouping_level == null || cf.grouping_level === gradeLevel
  )
  const aggs = computeAggregates(buildResolvedRows(groupRows, columns, ctx), aggregableColumnNames)
  return (
    <tr style={{ background: '#f0f3f8', borderTop:`1px solid ${C.borderDark}` }}>
      <td style={{ ...cellStyle(), fontWeight:500, fontStyle:'italic', color:C.textSecondary, paddingLeft: 12 + depth * 16 }}>
        Subtotal — {grouping.field_label}: {String(groupValue)} ({groupRows.length} rows)
      </td>
      {/* Fill across remaining columns. Calc-field values fill rightmost
          cells; intermediate cells stay blank. */}
      {Array.from({ length: Math.max(0, columns.length - 1 - applicableCalc.length) }, (_, i) => (
        <td key={`fill-${i}`} style={cellStyle()} />
      ))}
      {applicableCalc.map((cf, idx) => {
        const v = evaluateSummaryExpression(cf.expression, aggs)
        return (
          <td key={`calc-${idx}`} style={{ ...cellStyle(), fontWeight:500, color:C.textPrimary }} title={`${cf.label} (${cf.expression})`}>
            {formatCellValue(v, cf.data_type)}
          </td>
        )
      })}
    </tr>
  )
}

function SummaryTotalRow({ rows, columns, summaryCalcFields, aggregableColumnNames, ctx }) {
  // Grand total — apply summary calc fields with grouping_level === null
  // (or unspecified) since they apply at the top level.
  const grandTotalCalc = (summaryCalcFields || []).filter(cf => cf.grouping_level == null)
  const aggs = computeAggregates(buildResolvedRows(rows, columns, ctx), aggregableColumnNames)
  return (
    <tr style={{ background: C.borderDark, borderTop:`2px solid ${C.textSecondary}` }}>
      <td style={{ ...cellStyle(), fontWeight:700, color:C.textPrimary }}>
        Grand Total — {rows.length} rows
      </td>
      {Array.from({ length: Math.max(0, columns.length - 1 - grandTotalCalc.length) }, (_, i) => (
        <td key={`gfill-${i}`} style={cellStyle()} />
      ))}
      {grandTotalCalc.map((cf, idx) => {
        const v = evaluateSummaryExpression(cf.expression, aggs)
        return (
          <td key={`gcalc-${idx}`} style={{ ...cellStyle(), fontWeight:700, color:C.textPrimary }} title={`${cf.label} (${cf.expression})`}>
            {formatCellValue(v, cf.data_type)}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * Build flat row objects keyed by column.name with resolved values.
 * Used as input to computeAggregates so that expressions can reference
 * the underlying column names regardless of via_path.
 */
function buildResolvedRows(rows, columns, ctx) {
  return rows.map(row => {
    const out = {}
    for (const c of columns) {
      out[c.name] = getRowValue(row, c, ctx)
    }
    return out
  })
}

// ─── Matrix layout (row × column pivot) ──────────────────────────────────

function MatrixLayout({ result }) {
  const { rows, groupings, primaryObject } = result
  // Column groupings live on the report's rpt_column_groupings jsonb;
  // result includes rpt_column_groupings on result.report.rpt_column_groupings,
  // but we only thread the result through the runner — so look it up there.
  // The runner attaches it as result.columnGroupings in the patch below.
  const colGroupings = result.columnGroupings || []
  const measure = result.measure || { type: 'count', field: null }

  if (groupings.length === 0) {
    return <EmptyState message="Matrix reports need at least one row grouping." />
  }
  if (colGroupings.length === 0) {
    return <EmptyState message="Matrix reports need at least one column grouping. Edit the report and add one in the Groupings tab." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }

  // Build the row-axis tree and column-axis tree using getRowValue so FK
  // labels and picklist labels are reflected in headers.
  const rowAxis = buildAxisTree(rows, groupings.map(g => ({ name: g.field_name, via_path: g.field_via_path, label: g.field_label, sort: g.sort_direction })), result, 0)
  const colAxis = buildAxisTree(rows, colGroupings.map(c => ({ name: c.name, via_path: c.via_path, label: c.label || c.name, sort: c.sort_direction })), result, 0)

  // Flatten the leaf paths of both axes to drive the table layout
  const rowLeaves = flattenAxisLeaves(rowAxis)
  const colLeaves = flattenAxisLeaves(colAxis)

  // Compute cell values: for each (rowLeaf, colLeaf), filter rows that
  // match all axis values, then apply the measure.
  const cellMap = new Map()
  for (const rl of rowLeaves) {
    for (const cl of colLeaves) {
      const cellRows = rows.filter(row => {
        for (let i = 0; i < rl.values.length; i++) {
          const v = getRowValue(row, { name: groupings[i].field_name, via_path: groupings[i].field_via_path }, result)
          if ((v ?? '(blank)') !== rl.values[i]) return false
        }
        for (let i = 0; i < cl.values.length; i++) {
          const v = getRowValue(row, { name: colGroupings[i].name, via_path: colGroupings[i].via_path }, result)
          if ((v ?? '(blank)') !== cl.values[i]) return false
        }
        return true
      })
      const key = rl.values.join('||') + '###' + cl.values.join('||')
      cellMap.set(key, applyMeasure(cellRows, measure, result))
    }
  }

  // Render
  const headerRowCount = colGroupings.length
  const labelColCount  = groupings.length

  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'auto' }}>
      <table style={{ borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          {/* Column header rows — one row per column-grouping level */}
          {Array.from({ length: headerRowCount }, (_, hLvl) => (
            <tr key={`ch-${hLvl}`}>
              {/* Empty corner cells for the row-grouping label columns */}
              {hLvl === 0 && (
                <th colSpan={labelColCount} rowSpan={headerRowCount}
                    style={{ ...cellHeaderStyle(), borderRight:`1px solid ${C.border}`, background:C.cardSecondary }}>
                  {groupings.map(g => g.field_label || g.field_name).join(' / ')}
                </th>
              )}
              {/* Walk the column axis at this level */}
              {emitAxisHeaderCells(colAxis, hLvl)}
            </tr>
          ))}
        </thead>
        <tbody>
          {rowLeaves.map((rl, ri) => (
            <tr key={`rl-${ri}`} style={{ borderTop:`1px solid ${C.border}` }}>
              {rl.values.map((v, vi) => (
                <td key={vi} style={{ ...cellStyle(), fontWeight:500, background:C.cardSecondary }}>
                  {String(v)}
                </td>
              ))}
              {colLeaves.map((cl, ci) => {
                const key = rl.values.join('||') + '###' + cl.values.join('||')
                const cellVal = cellMap.get(key)
                return (
                  <td key={`c-${ci}`} style={{ ...cellStyle(), textAlign:'right' }}>
                    {cellVal == null ? <span style={{ color:C.textMuted }}>—</span> : formatCellValue(cellVal, 'number')}
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

function buildAxisTree(rows, groupings, ctx, level) {
  if (level >= groupings.length) {
    return { leafRows: rows }
  }
  const g = groupings[level]
  const buckets = new Map()
  for (const row of rows) {
    const v = getRowValue(row, { name: g.name, via_path: g.via_path }, ctx)
    const k = v ?? '(blank)'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(row)
  }
  const sorted = Array.from(buckets.entries()).sort((a, b) => {
    const dir = g.sort === 'desc' ? -1 : 1
    if (a[0] === b[0]) return 0
    return a[0] < b[0] ? -1 * dir : 1 * dir
  })
  return {
    level,
    children: sorted.map(([key, rs]) => ({
      key, level, child: buildAxisTree(rs, groupings, ctx, level + 1),
    })),
  }
}

function flattenAxisLeaves(node, prefix = []) {
  if (node.leafRows) return [{ values: prefix }]
  if (!node.children) return [{ values: prefix }]
  const out = []
  for (const c of node.children) {
    out.push(...flattenAxisLeaves(c.child, [...prefix, c.key]))
  }
  return out
}

function emitAxisHeaderCells(node, targetLevel) {
  // Returns React elements: at the targetLevel, emit a <th> per node with
  // colSpan = number of leaf descendants. Above the target level, recurse.
  if (!node.children) return null
  if (node.children[0]?.level === targetLevel) {
    return node.children.map((c, i) => {
      const span = countLeaves(c.child)
      return (
        <th key={`hh-${targetLevel}-${i}`} colSpan={span} style={{
          ...cellHeaderStyle(),
          borderLeft:`1px solid ${C.border}`,
          textAlign:'center',
        }}>
          {String(c.key)}
        </th>
      )
    })
  }
  // Recurse deeper
  return node.children.flatMap((c, i) =>
    emitAxisHeaderCells(c.child, targetLevel)?.map((el, j) => ({ ...el, key: `hh-${targetLevel}-${i}-${j}` })) || []
  )
}

function countLeaves(node) {
  if (node.leafRows) return 1
  if (!node.children) return 1
  return node.children.reduce((sum, c) => sum + countLeaves(c.child), 0)
}

function applyMeasure(cellRows, measure, ctx) {
  if (cellRows.length === 0) return null
  if (measure.type === 'count') return cellRows.length
  const values = cellRows
    .map(r => {
      const v = ctx ? getRowValue(r, { name: measure.field }, ctx) : r[measure.field]
      const n = typeof v === 'number' ? v : parseFloat(v)
      return Number.isFinite(n) ? n : null
    })
    .filter(v => v != null)
  if (values.length === 0) return null
  switch (measure.type) {
    case 'sum': return values.reduce((a, b) => a + b, 0)
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
    case 'min': return Math.min(...values)
    case 'max': return Math.max(...values)
  }
  return null
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
  triggerDownload(blob, `${slugify(name || 'report')}_${todayStr()}.csv`)
}

// ─── Excel export ─────────────────────────────────────────────────────────

async function exportExcel(result) {
  const XLSX = await import('xlsx')
  const { rows, columns, name } = result
  if (!rows || rows.length === 0) return

  const aoa = [columns.map(c => c.label)]
  for (const row of rows) {
    aoa.push(columns.map(c => {
      const v = getRowValue(row, c, result)
      if (v == null) return ''
      if (typeof v === 'object') return JSON.stringify(v)
      return v
    }))
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetSafe(name || 'Report'))
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  triggerDownload(blob, `${slugify(name || 'report')}_${todayStr()}.xlsx`)
}

// ─── PDF export ───────────────────────────────────────────────────────────

async function exportPdf(result) {
  const { default: jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const { rows, columns, name, primaryObject, format } = result
  if (!rows || rows.length === 0) return

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  doc.setFontSize(14)
  doc.text(name || 'Report', 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(`${rows.length.toLocaleString()} rows · ${format} · ${primaryObject} · ${new Date().toLocaleString()}`, 40, 56)

  autoTable(doc, {
    startY: 70,
    head: [columns.map(c => c.label)],
    body: rows.map(row =>
      columns.map(c => {
        const v = getRowValue(row, c, result)
        if (v == null) return ''
        if (typeof v === 'object') return JSON.stringify(v)
        return String(v)
      })
    ),
    styles:    { fontSize: 8, cellPadding: 4 },
    headStyles:{ fillColor: [41, 51, 71], textColor: 255 },
    margin:    { left: 40, right: 40 },
  })
  doc.save(`${slugify(name || 'report')}_${todayStr()}.pdf`)
}

// ─── Export helpers ───────────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
function slugify(s)   { return String(s).replace(/[^a-z0-9_-]/gi, '_') }
function todayStr()   { return new Date().toISOString().slice(0, 10) }
function sheetSafe(s) { return String(s).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) }

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

// ─── Runtime-prompt input ────────────────────────────────────────────────
//
// Renders the right input control for a runtime prompt's input_type.
// All variants emit a string value via onChange so the rest of the
// runner can treat prompt values uniformly.
//
// Supported input_types (configured in the Builder per-filter):
//   text      — plain text input (default)
//   number    — numeric input, value emitted as string
//   date      — HTML5 date picker (YYYY-MM-DD)
//   datetime  — HTML5 datetime-local picker (YYYY-MM-DDTHH:MM)
//   select    — <select> populated from prompt.options[]

function PromptInput({ prompt, value, onChange }) {
  const inputType = prompt?.input_type || 'text'
  const baseStyle = {
    width:'100%', padding:'8px 10px', fontSize:13,
    background:C.card, color:C.textPrimary,
    border:`1px solid ${C.border}`, borderRadius:6, font:'inherit',
    boxSizing:'border-box',
  }

  if (inputType === 'select') {
    const opts = Array.isArray(prompt.options) ? prompt.options : []
    return (
      <select value={value} onChange={e => onChange(e.target.value)} style={baseStyle}>
        <option value="">— Select —</option>
        {opts.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }

  // Native input. Map our input_type to the right HTML input type.
  const htmlType = inputType === 'datetime' ? 'datetime-local'
    : (inputType === 'date' || inputType === 'number' || inputType === 'text') ? inputType
    : 'text'

  return (
    <input
      type={htmlType}
      value={value}
      onChange={e => onChange(e.target.value)}
      style={baseStyle}
    />
  )
}
