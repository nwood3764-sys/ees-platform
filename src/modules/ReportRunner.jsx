import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { runReport, getRowValue, getReportPrompts, cloneReport } from '../data/reportsService'
import { evaluateRowExpression, evaluateSummaryExpression, computeAggregates } from '../lib/reportFormulaEval'
import RecordLink from '../components/RecordLink'
import { getEditableFieldsForTable, getPicklistOptions, bulkUpdateRecords } from '../data/fieldMetadataService'

// ─── Report Runner ────────────────────────────────────────────────────────
//
// Phase 2c.1: Tabular reports rendered as a flat table.
// Phase 2c.2: Summary reports (groupings + subtotals) and Matrix layout.
// Calculated fields evaluator wires in here.
//
// Loaded with a reportId. Calls runReport() once on mount; result drives
// the table render. "Run Again" reruns the same query (useful when the
// underlying data has changed).

export default function ReportRunner({ reportId, onClose, onEdit, onDuplicate, extraFilters = null }) {
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
      const r = await runReport(reportId, overrides, extraFilters)
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

      {/* Body — render the report in its own format, scoped by any extraFilters
          from a clicked widget segment (Salesforce-style: a dashboard widget
          opens its source report, filtered to what was clicked). */}
      <div style={{ flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column', padding:'16px 24px' }}>
        {result.format === 'tabular' && <TabularLayout result={result} fill />}
        {result.format === 'summary' && <SummaryLayout result={result} fill />}
        {result.format === 'matrix'  && <MatrixLayout  result={result} fill />}
      </div>
    </div>
  )
}

// ─── Tabular layout ───────────────────────────────────────────────────────

export function TabularLayout({ result, fill = false }) {
  const { rows, columns, calculatedFields, primaryObject } = result
  // Row-scope calculated fields appear as additional columns alongside the
  // selected fields. Summary-scope calculated fields show on the totals
  // row in SummaryLayout — not relevant for tabular.
  const rowCalcFields = (calculatedFields || []).filter(c => c.scope === 'row')
  const allColumns = [
    ...columns,
    ...rowCalcFields.map(c => ({ ...c, _calc: true, label: c.label || '(calc)' })),
  ]

  // Inline editing: picklist columns on the primary object are editable
  // directly in the report row (double-click). Saves go through the same
  // bulk_update_records path the list views use; the new value lives in a
  // local overlay so the report doesn't re-run after every cell save.
  const [fieldMeta, setFieldMeta]     = useState(null)   // Map<columnName, meta>
  const [editingCell, setEditingCell] = useState(null)   // { rowId, colName }
  const [cellDraft, setCellDraft]     = useState(null)
  const [overlay, setOverlay]         = useState(() => new Map()) // `${rowId}::${col}` → { value, label }
  const [savingCell, setSavingCell]   = useState(null)
  const [editError, setEditError]     = useState(null)   // { key, message }

  // Viewer sort — click a header to sort by that column; shift-click adds a
  // secondary/tertiary sort key (Salesforce/Excel multi-sort). Sorting is on
  // the RESOLVED, displayed value (labels, not UUIDs) so what you sort is what
  // you see. Column-summarize aggregates recompute over the same rows.
  const [sortKeys, setSortKeys] = useState([])   // [{ col: <index>, dir: 'asc'|'desc' }]
  const toggleSort = (colIdx, additive) => {
    setSortKeys(prev => {
      const existing = prev.find(k => k.col === colIdx)
      if (additive) {
        if (existing) {
          if (existing.dir === 'asc') return prev.map(k => k.col === colIdx ? { ...k, dir: 'desc' } : k)
          return prev.filter(k => k.col !== colIdx)   // asc → desc → off
        }
        return [...prev, { col: colIdx, dir: 'asc' }]
      }
      if (existing && prev.length === 1) {
        if (existing.dir === 'asc') return [{ col: colIdx, dir: 'desc' }]
        return []   // asc → desc → off
      }
      return [{ col: colIdx, dir: 'asc' }]
    })
  }

  useEffect(() => {
    let cancelled = false
    if (!primaryObject) { setFieldMeta(new Map()); return undefined }
    getEditableFieldsForTable(primaryObject)
      .then(list => { if (!cancelled) setFieldMeta(new Map((list || []).map(m => [m.columnName, m]))) })
      .catch(() => { if (!cancelled) setFieldMeta(new Map()) })
    return () => { cancelled = true }
  }, [primaryObject])

  const saveCell = async (rowId, colName, newValue, newLabel) => {
    const key = `${rowId}::${colName}`
    setSavingCell(key)
    setEditError(null)
    try {
      const res = await bulkUpdateRecords(primaryObject, [rowId], { [colName]: newValue })
      if (res?.records_errored > 0) {
        setEditError({ key, message: res.errors?.[0]?.error || 'Update failed' })
        return
      }
      setOverlay(prev => {
        const next = new Map(prev)
        next.set(key, { value: newValue, label: newLabel })
        return next
      })
      setEditingCell(null)
    } catch (e) {
      setEditError({ key, message: e.message || String(e) })
    } finally {
      setSavingCell(null)
    }
  }

  if (allColumns.length === 0) {
    return <EmptyState message="No fields selected. Edit the report to add fields." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }

  // Resolve each column's displayed value for a row (calc fields evaluated,
  // FK/picklist labels resolved) — the basis for both sorting and summarize.
  const resolveDisplay = (row, c) => {
    if (c._calc) {
      const rr = {}
      for (const col of columns) rr[col.name] = getRowValue(row, col, result)
      return evaluateRowExpression(c.expression, rr)
    }
    const ov = overlay.get(`${row.id}::${c.name}`)
    if (ov) return ov.label ?? ov.value
    return getRowValue(row, c, result)
  }

  const sortedRows = applyViewerSort(rows, sortKeys, allColumns, resolveDisplay)

  // Column-summarize footer — only shows if at least one column has an
  // aggregate chosen in the report definition (col.summarize).
  const summaryRow = buildColumnSummaries(sortedRows, allColumns, resolveDisplay)

  return (
    <div style={{
      background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
      overflow:'auto', minHeight:0,
      ...(fill ? { flex:1 } : { maxHeight:'70vh' }),
    }}>
      <ReportViewerStyles />
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead style={{ background:C.cardSecondary, position:'sticky', top:0, zIndex:2 }}>
          <tr>
            {allColumns.map((c, idx) => {
              const sk = sortKeys.find(k => k.col === idx)
              const rank = sortKeys.length > 1 && sk ? sortKeys.findIndex(k => k.col === idx) + 1 : null
              return (
                <th key={`h-${idx}`} style={{ ...cellHeaderStyle(), background:C.cardSecondary, cursor:'pointer', userSelect:'none' }}
                    onClick={(e) => toggleSort(idx, e.shiftKey)}
                    title="Click to sort · Shift-click to add a sort level">
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                    {c.label}
                    {c._calc && <span style={{ fontSize:10, color:C.emerald }}>ƒ</span>}
                    {sk && <span style={{ fontSize:10, color:C.emerald }}>{sk.dir === 'asc' ? '▲' : '▼'}{rank ? <sup>{rank}</sup> : null}</span>}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIdx) => (
            <tr key={row.id || rowIdx} className="rpt-detail-row" style={{
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
                  const condStyle = conditionalCellStyle(v, c)
                  return (
                    <td key={`r-${rowIdx}-${idx}`} style={{ ...cellStyle(), ...(condStyle || {}) }}>
                      {formatReportValue(v, { ...c, type: c.data_type })}
                    </td>
                  )
                }

                const cellKey = `${row.id}::${c.name}`
                const ov = overlay.get(cellKey)
                const meta = fieldMeta?.get(c.name)
                const isDirect = !c.via_path || c.via_path.length === 0
                const isEditablePicklist = !!(row.id && isDirect && meta?.isEditable && meta.editorType === 'picklist')
                const isEditing = editingCell && editingCell.rowId === row.id && editingCell.colName === c.name
                const rawValue = ov ? ov.value : getRowValue(row, c, result)
                const display = ov
                  ? (ov.label ?? '—')
                  : formatReportValue(rawValue, c)
                const condStyle = conditionalCellStyle(rawValue, c)

                if (isEditing) {
                  return (
                    <td key={`r-${rowIdx}-${idx}`} style={cellStyle()}>
                      <ReportPicklistCellEditor
                        meta={meta}
                        value={cellDraft}
                        setValue={setCellDraft}
                        busy={savingCell === cellKey}
                        onCommit={(value, label) => saveCell(row.id, c.name, value, label)}
                        onCancel={() => { setEditingCell(null); setEditError(null) }}
                      />
                      {editError?.key === cellKey && (
                        <div style={{ fontSize:11, color:C.textSecondary, marginTop:2 }}>{editError.message}</div>
                      )}
                    </td>
                  )
                }

                // First column links to the underlying record — real anchor,
                // so new-tab / copy-link work like any record link.
                if (idx === 0 && row.id && primaryObject) {
                  return (
                    <td key={`r-${rowIdx}-${idx}`} style={cellStyle()}>
                      <RecordLink
                        table={primaryObject}
                        id={row.id}
                        title="Open record"
                        onActivate={() => {
                          window.history.pushState(null, '', `/${primaryObject}/${row.id}`)
                          window.dispatchEvent(new PopStateEvent('popstate'))
                        }}
                        style={{ color:'#1a5a8a', fontWeight:600 }}
                      >
                        {display}
                      </RecordLink>
                    </td>
                  )
                }

                return (
                  <td
                    key={`r-${rowIdx}-${idx}`}
                    style={{ ...cellStyle(), ...(condStyle || {}), ...(isEditablePicklist ? { cursor:'cell' } : null) }}
                    title={isEditablePicklist ? 'Double-click to edit' : undefined}
                    onDoubleClick={isEditablePicklist ? () => {
                      setEditError(null)
                      setCellDraft(ov ? ov.value : (row[c.name] ?? null))
                      setEditingCell({ rowId: row.id, colName: c.name })
                    } : undefined}
                  >
                    {display}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {summaryRow && (
          <tfoot>
            <tr style={{ background:C.cardSecondary, borderTop:`2px solid ${C.borderDark}` }}>
              {allColumns.map((c, idx) => (
                <td key={`sum-${idx}`} style={{ ...cellStyle(), fontWeight:600, color:C.textPrimary }}>
                  {idx === 0 && !summaryRow[idx] ? `${sortedRows.length} records` : (summaryRow[idx] || '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ─── Viewer sort + column summarize helpers ───────────────────────────────

// Compare two resolved cell values. Numbers sort numerically, ISO dates sort
// chronologically, everything else case-insensitive lexical. Null/blank sinks
// to the bottom regardless of direction.
function compareValues(a, b) {
  const aBlank = a == null || a === ''
  const bBlank = b == null || b === ''
  if (aBlank && bBlank) return 0
  if (aBlank) return 1
  if (bBlank) return -1
  const na = typeof a === 'number' ? a : parseFloat(a)
  const nb = typeof b === 'number' ? b : parseFloat(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    // Only treat as numeric when both fully parse (avoid "12 Main St" vs 12).
    if (String(na) === String(a).trim() && String(nb) === String(b).trim()) return na - nb
  }
  const da = Date.parse(a), db = Date.parse(b)
  if (Number.isFinite(da) && Number.isFinite(db) &&
      /^\d{4}-\d{2}-\d{2}/.test(String(a)) && /^\d{4}-\d{2}-\d{2}/.test(String(b))) {
    return da - db
  }
  return String(a).toLowerCase().localeCompare(String(b).toLowerCase())
}

function applyViewerSort(rows, sortKeys, columns, resolveDisplay) {
  if (!sortKeys || sortKeys.length === 0) return rows
  const decorated = rows.map(row => ({
    row,
    vals: sortKeys.map(k => resolveDisplay(row, columns[k.col])),
  }))
  decorated.sort((x, y) => {
    for (let i = 0; i < sortKeys.length; i++) {
      const cmp = compareValues(x.vals[i], y.vals[i])
      if (cmp !== 0) return sortKeys[i].dir === 'desc' ? -cmp : cmp
    }
    return 0
  })
  return decorated.map(d => d.row)
}

// Build the summarize footer. Each column may carry `summarize`
// ('sum'|'avg'|'min'|'max'|'count') set in the report definition; returns an
// array (index-aligned to columns) of formatted aggregate strings, or null
// when no column requests a summary.
function buildColumnSummaries(rows, columns, resolveDisplay) {
  const anySummary = columns.some(c => c.summarize)
  if (!anySummary) return null
  return columns.map(c => {
    if (!c.summarize) return ''
    const nums = []
    for (const row of rows) {
      const v = resolveDisplay(row, c)
      const n = typeof v === 'number' ? v : parseFloat(v)
      if (Number.isFinite(n)) nums.push(n)
    }
    let val
    switch (c.summarize) {
      case 'count': val = rows.length; break
      case 'sum':   val = nums.reduce((a, b) => a + b, 0); break
      case 'avg':   val = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break
      case 'min':   val = nums.length ? Math.min(...nums) : null; break
      case 'max':   val = nums.length ? Math.max(...nums) : null; break
      default: return ''
    }
    const label = { sum:'Σ', avg:'avg', min:'min', max:'max', count:'#' }[c.summarize]
    return val == null ? '—' : `${label} ${formatCellValue(val, c.type)}`
  })
}

// Inline picklist cell editor for tabular report rows. Loads the active
// picklist options for the column's (object, field) pair and commits the
// chosen value (with its label, for the local display overlay).
function ReportPicklistCellEditor({ meta, value, setValue, busy, onCommit, onCancel }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    getPicklistOptions(meta.picklistObject, meta.picklistField)
      .then(o => { if (!cancelled) { setOptions(o || []); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [meta.picklistObject, meta.picklistField])

  const commit = () => {
    if (busy) return
    const chosen = options.find(o => o.id === value)
    onCommit(value || null, chosen ? chosen.label : null)
  }

  return (
    <select
      autoFocus
      value={value || ''}
      disabled={busy}
      onChange={(e) => setValue(e.target.value || null)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      style={{
        width:'100%', minWidth:140, fontSize:13, padding:'3px 6px',
        border:`1px solid ${C.borderDark}`, borderRadius:6,
        background:'#fff', color:C.textPrimary,
      }}
    >
      <option value="">—</option>
      {loading && <option disabled>Loading…</option>}
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

// ─── Summary layout (Phase 2c.2) ──────────────────────────────────────────

export function SummaryLayout({ result, fill = false }) {
  const { rows, columns, groupings, calculatedFields } = result

  // Group collapse state lives here (not per node) so Expand/Collapse All can
  // drive every level at once, Salesforce-style. Keys are the group's path.
  const [collapsedKeys, setCollapsedKeys]   = useState(() => new Set())
  const [showDetailRows, setShowDetailRows] = useState(true)

  // Summary-scope calculated fields show on group subtotal rows and the
  // grand total row. They use SUM_<field>/COUNT_<field>/AVG_<field>/
  // MIN_<field>/MAX_<field> aggregate identifiers, computed per group
  // before the expression is evaluated.
  const summaryCalcFields = (calculatedFields || []).filter(c => c.scope === 'summary')

  // Numeric column names (from the selected fields) used to build the
  // aggregates the summary expression can reference. Columns keep their
  // raw name regardless of label, since expressions reference column names.
  // Aggregates always span EVERY selected column, including the ones the
  // detail rows no longer draw.
  const aggregableColumnNames = columns.map(c => c.name)

  // Salesforce parity: a grouped field belongs to its group header, not to
  // every detail row underneath it. Drop grouping fields from the detail
  // columns — unless that would leave the table with nothing to draw.
  const ungrouped = columns.filter(c => !groupings.some(g => isSameReportField(c, g)))
  const detailColumns = ungrouped.length > 0 ? ungrouped : columns

  // Group rows iteratively by each grouping level. Output is a tree of
  // { value, level, rows, children, subtotal }
  const tree = (groupings.length > 0 && rows.length > 0)
    ? buildGroupTree(rows, columns, groupings, 0, result)
    : null
  const allGroupKeys = tree ? collectGroupKeys(tree) : []
  const allCollapsed = allGroupKeys.length > 0 && allGroupKeys.every(k => collapsedKeys.has(k))

  const toggleGroup = (key) => setCollapsedKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  if (groupings.length === 0) {
    return <EmptyState message="Summary reports require at least one grouping. Edit the report to add groupings." />
  }
  if (rows.length === 0) {
    return <EmptyState message="No matching rows." />
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0, ...(fill ? { flex:1 } : null) }}>
      <ReportViewerStyles />

      {/* Display controls — Salesforce's Expand All / Detail Rows toggles. */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8, flexWrap:'wrap' }}>
        <button
          onClick={() => setCollapsedKeys(allCollapsed ? new Set() : new Set(allGroupKeys))}
          style={miniBtnStyle()}
        >{allCollapsed ? 'Expand All' : 'Collapse All'}</button>
        <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:C.textSecondary, cursor:'pointer' }}>
          <input
            type="checkbox"
            checked={showDetailRows}
            onChange={e => setShowDetailRows(e.target.checked)}
            style={{ accentColor:C.emerald, cursor:'pointer' }}
          />
          Detail rows
        </label>
        <span style={{ fontSize:12, color:C.textMuted }}>
          {allGroupKeys.length.toLocaleString()} groups · {rows.length.toLocaleString()} records
        </span>
      </div>

      <div style={{
        background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
        overflow:'auto', minHeight:0,
        ...(fill ? { flex:1 } : { maxHeight:'70vh' }),
      }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead style={{ background:C.cardSecondary, position:'sticky', top:0, zIndex:2 }}>
            <tr>
              {detailColumns.map((c, idx) => (
                <th key={`h-${idx}`} style={{ ...cellHeaderStyle(), background:C.cardSecondary }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SummaryTreeRows
              nodes={tree} columns={columns} renderColumns={detailColumns}
              groupings={groupings} depth={0}
              ctx={result} summaryCalcFields={summaryCalcFields}
              aggregableColumnNames={aggregableColumnNames}
              parentRows={rows} grandRows={rows}
              pathPrefix="" collapsedKeys={collapsedKeys} toggleGroup={toggleGroup}
              showDetailRows={showDetailRows}
            />
            <SummaryTotalRow
              rows={rows} columns={columns} renderColumns={detailColumns}
              summaryCalcFields={summaryCalcFields}
              aggregableColumnNames={aggregableColumnNames}
              ctx={result}
            />
          </tbody>
        </table>
      </div>
    </div>
  )
}

// A report column and a grouping point at the same field when both the column
// name and the FK hop path match.
function isSameReportField(col, g) {
  const gf = groupingFieldDef(g)
  if (!gf.name || !col?.name) return false
  return col.name === gf.name
    && (col.via_path || []).join('>') === (gf.via_path || []).join('>')
}

// Every group's path key, all levels deep — drives Expand/Collapse All.
function collectGroupKeys(node, prefix = '') {
  if (!node || !node.children) return []
  const out = []
  for (const child of node.children) {
    const key = `${prefix}/${child.level}:${String(child.value)}`
    out.push(key)
    out.push(...collectGroupKeys(child.child, key))
  }
  return out
}

/**
 * A grouping row from reportsService already carries everything getRowValue
 * needs (name, via_path, _is_picklist). This normalises the older
 * field_name/field_via_path spelling so a stale result shape still resolves.
 */
function groupingFieldDef(g) {
  if (!g) return { name: null, via_path: null }
  return {
    name:             g.name || g.field_name,
    via_path:         g.via_path || g.field_via_path || null,
    _is_picklist:     !!g._is_picklist,
    date_granularity: g.date_granularity || null,
  }
}

// Bucket a date/datetime value into a grain label (Salesforce date bucketing).
// Returns { key, sortKey } so buckets sort chronologically even though the
// display label is a friendly string.
function bucketDate(value, grain) {
  const d = new Date(value)
  if (isNaN(d.getTime())) return { key: '(blank)', sortKey: '' }
  const y = d.getFullYear()
  const m = d.getMonth()
  const pad = (n) => String(n).padStart(2, '0')
  switch (grain) {
    case 'year':
      return { key: String(y), sortKey: `${y}` }
    case 'quarter': {
      const q = Math.floor(m / 3) + 1
      return { key: `Q${q} ${y}`, sortKey: `${y}-${q}` }
    }
    case 'month':
      return { key: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), sortKey: `${y}-${pad(m + 1)}` }
    case 'week': {
      // ISO-ish: week starting Sunday. Label with the week-start date.
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
      return { key: `Week of ${start.toLocaleDateString()}`, sortKey: start.toISOString().slice(0, 10) }
    }
    case 'day':
    default:
      return { key: d.toLocaleDateString(), sortKey: `${y}-${pad(m + 1)}-${pad(d.getDate())}` }
  }
}

// The raw (unresolved) value at a grouping field — walks via_path but does NOT
// resolve picklist/FK labels, so a picklist grouping can look its sort order up
// by the underlying id.
function rawGroupValue(row, fieldDef) {
  if (!fieldDef.via_path || fieldDef.via_path.length === 0) return row[fieldDef.name] ?? null
  let nested = row
  for (const fk of fieldDef.via_path) { if (!nested) return null; nested = nested[fk] }
  return nested ? (nested[fieldDef.name] ?? null) : null
}

function buildGroupTree(rows, columns, groupings, level = 0, ctx = null) {
  if (level >= groupings.length) {
    return { leafRows: rows }
  }
  const g = groupings[level]
  const grain = g.date_granularity || null
  const isPicklist = !!g._is_picklist && !grain
  const buckets = new Map()      // key → rows
  const sortKeys = new Map()     // key → chronological/lexical sort key
  const orderKeys = new Map()    // key → picklist sort order (when applicable)
  // The grouping object IS the field descriptor — it carries name, via_path
  // and _is_picklist — so getRowValue resolves picklist and lookup group keys
  // to their labels instead of bucketing on raw UUIDs.
  const fieldDef = groupingFieldDef(g)
  for (const row of rows) {
    const raw = getRowValue(row, fieldDef, ctx)
    let k, sk
    if (grain && raw != null && raw !== '') {
      const b = bucketDate(raw, grain)
      k = b.key; sk = b.sortKey
    } else {
      k = raw ?? '(blank)'; sk = k
    }
    if (!buckets.has(k)) {
      buckets.set(k, []); sortKeys.set(k, sk)
      // Picklist groups order by the picklist's defined sort order (Salesforce
      // parity) — look up the raw value's sort order from the picklist map.
      if (isPicklist && ctx?.picklistMap) {
        const rawId = rawGroupValue(row, fieldDef)
        const entry = rawId != null ? ctx.picklistMap.get(rawId) : null
        orderKeys.set(k, entry && entry.sort_order != null ? entry.sort_order : Number.MAX_SAFE_INTEGER)
      }
    }
    buckets.get(k).push(row)
  }

  // Sort groups: by value (default), by record count, or by the report's
  // measure. Direction respected either way.
  const dir = g.sort_direction === 'desc' ? -1 : 1
  const sortBy = g.sort_by_aggregate || 'value'
  const measure = ctx?.measure || { type: 'count', field: null }

  // HAVING: drop groups whose measure fails the grouping's group filter
  // (e.g. keep only groups with count >= 5). Applied before sort/render.
  const havingOk = (groupRows) => {
    if (!g.group_filter_op || g.group_filter_value == null || g.group_filter_value === '') return true
    const m = applyMeasure(groupRows, measure, ctx)
    const target = parseFloat(g.group_filter_value)
    if (m == null || !Number.isFinite(target)) return true
    switch (g.group_filter_op) {
      case 'gt':  return m > target
      case 'gte': return m >= target
      case 'lt':  return m < target
      case 'lte': return m <= target
      case 'eq':  return m === target
      case 'ne':  return m !== target
      default:    return true
    }
  }

  // Picklist value-sort follows the picklist order, not the alphabet.
  if (isPicklist && sortBy === 'value' && orderKeys.size > 0) {
    const entries = Array.from(buckets.entries()).filter(([, rs]) => havingOk(rs))
    entries.sort((a, b) => ((orderKeys.get(a[0]) ?? 0) - (orderKeys.get(b[0]) ?? 0)) * dir)
    return {
      groupingLevel: level,
      children: entries.map(([key, group_rows]) => ({
        value: key, level, rows: group_rows,
        child: buildGroupTree(group_rows, columns, groupings, level + 1, ctx),
      })),
    }
  }
  const entries = Array.from(buckets.entries()).filter(([, rs]) => havingOk(rs))
  entries.sort((a, b) => {
    if (sortBy === 'count') return (a[1].length - b[1].length) * dir
    if (sortBy === 'measure') return (applyMeasure(a[1], measure, ctx) - applyMeasure(b[1], measure, ctx)) * dir
    const ka = sortKeys.get(a[0]), kb = sortKeys.get(b[0])
    if (ka === kb) return 0
    // Numeric-aware value sort (chronological for bucketed dates via sortKey).
    const na = parseFloat(ka), nb = parseFloat(kb)
    if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === String(ka) && String(nb) === String(kb)) {
      return (na - nb) * dir
    }
    return (String(ka) < String(kb) ? -1 : 1) * dir
  })
  return {
    groupingLevel: level,
    children: entries.map(([key, group_rows]) => ({
      value: key,
      level,
      rows: group_rows,
      child: buildGroupTree(group_rows, columns, groupings, level + 1, ctx),
    })),
  }
}

function SummaryTreeRows({ nodes, columns, renderColumns, groupings, depth, ctx, summaryCalcFields, aggregableColumnNames, parentRows, grandRows, pathPrefix, collapsedKeys, toggleGroup, showDetailRows }) {
  if (!nodes.children) {
    if (!showDetailRows) return null
    const primaryObject = ctx?.primaryObject
    return nodes.leafRows.map((row, idx) => (
      <tr key={`leaf-${idx}`} className="rpt-detail-row" style={{ borderTop:`1px solid ${C.border}` }}>
        {renderColumns.map((c, ci) => {
          const val = getRowValue(row, c, ctx)
          const cond = conditionalCellStyle(val, c)
          const display = formatReportValue(val, c)
          return (
            <td key={ci} style={{ ...cellStyle(), paddingLeft: ci === 0 ? 12 + depth * 18 : 12, ...(cond || {}) }}>
              {/* First column opens the record, same as a tabular report. */}
              {ci === 0 && row.id && primaryObject ? (
                <RecordLink
                  table={primaryObject}
                  id={row.id}
                  title="Open record"
                  onActivate={() => {
                    window.history.pushState(null, '', `/${primaryObject}/${row.id}`)
                    window.dispatchEvent(new PopStateEvent('popstate'))
                  }}
                  style={{ color:'#1a5a8a', fontWeight:600 }}
                >{display}</RecordLink>
              ) : display}
            </td>
          )
        })}
      </tr>
    ))
  }
  return nodes.children.map((node, ni) => (
    <SummaryGroupNode
      key={`g-${depth}-${ni}`}
      node={node} columns={columns} renderColumns={renderColumns}
      groupings={groupings} depth={depth}
      ctx={ctx} summaryCalcFields={summaryCalcFields}
      aggregableColumnNames={aggregableColumnNames}
      // Group-formula context: the previous peer group's rows (for prior-group
      // delta), this level's parent rows (for % of parent), and the grand-total
      // rows (for % of total).
      prevRows={ni > 0 ? nodes.children[ni - 1].rows : null}
      parentRows={parentRows}
      grandRows={grandRows}
      pathKey={`${pathPrefix}/${node.level}:${String(node.value)}`}
      collapsedKeys={collapsedKeys} toggleGroup={toggleGroup}
      showDetailRows={showDetailRows}
    />
  ))
}

function SummaryGroupNode({ node, columns, renderColumns, groupings, depth, ctx, summaryCalcFields, aggregableColumnNames, prevRows, parentRows, grandRows, pathKey, collapsedKeys, toggleGroup, showDetailRows }) {
  const grouping = groupings[depth]
  const collapsed = collapsedKeys.has(pathKey)
  const applicableCalc = (summaryCalcFields || []).filter(cf =>
    cf.grouping_level == null || cf.grouping_level === depth + 1
  )
  // A subtotal row only earns its place when it carries an aggregate — the
  // record count already sits on the group header, so a "subtotal" that only
  // repeats the group name is noise.
  const hasAggregates = renderColumns.some(c => c.summarize) || applicableCalc.length > 0
  const showSubtotal = grouping.show_subtotal !== false && hasAggregates
  return (
    <>
      <tr
        className="rpt-group-row"
        style={{
          background: depth === 0 ? '#e8eef7' : C.cardSecondary,
          borderTop:`2px solid ${C.borderDark}`, cursor:'pointer',
        }}
        onClick={() => toggleGroup(pathKey)}
      >
        <td colSpan={renderColumns.length} style={{ ...cellStyle(), padding:'9px 12px', paddingLeft: 12 + depth * 18 }}>
          <span style={{ display:'inline-block', width:16, color:C.textMuted, fontSize:11 }}>{collapsed ? '▸' : '▾'}</span>
          <span style={{ fontSize:11, fontWeight:600, color:C.textSecondary, textTransform:'uppercase', letterSpacing:0.5, marginRight:8 }}>
            {grouping.field_label}
          </span>
          <span style={{ fontWeight:600, color:C.textPrimary }}>{String(node.value)}</span>
          <span style={{
            marginLeft:8, padding:'1px 8px', borderRadius:10,
            background:C.card, border:`1px solid ${C.border}`,
            fontSize:11, fontWeight:500, color:C.textSecondary,
          }}>{node.rows.length.toLocaleString()}</span>
        </td>
      </tr>
      {!collapsed && (
        <SummaryTreeRows
          nodes={node.child} columns={columns} renderColumns={renderColumns}
          groupings={groupings} depth={depth + 1}
          ctx={ctx} summaryCalcFields={summaryCalcFields}
          aggregableColumnNames={aggregableColumnNames}
          parentRows={node.rows} grandRows={grandRows}
          pathPrefix={pathKey} collapsedKeys={collapsedKeys} toggleGroup={toggleGroup}
          showDetailRows={showDetailRows}
        />
      )}
      {showSubtotal && (
        <SummarySubtotalRow
          groupRows={node.rows}
          columns={columns} renderColumns={renderColumns} depth={depth} ctx={ctx}
          summaryCalcFields={applicableCalc}
          aggregableColumnNames={aggregableColumnNames}
          prevRows={prevRows} parentRows={parentRows} grandRows={grandRows}
        />
      )}
    </>
  )
}

// Aggregate one column over a set of resolved rows per its `summarize` mode.
// Returns a formatted string, or null when the column requests no summary.
function summarizeColumnValue(col, resolvedRows) {
  if (!col.summarize) return null
  const nums = []
  for (const rr of resolvedRows) {
    const v = rr[col.name]
    const n = typeof v === 'number' ? v : parseFloat(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  let val
  switch (col.summarize) {
    case 'count': val = resolvedRows.length; break
    case 'sum':   val = nums.reduce((a, b) => a + b, 0); break
    case 'avg':   val = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break
    case 'min':   val = nums.length ? Math.min(...nums) : null; break
    case 'max':   val = nums.length ? Math.max(...nums) : null; break
    default: return null
  }
  if (val == null) return '—'
  const tag = { sum:'Σ', avg:'avg', min:'min', max:'max', count:'#' }[col.summarize]
  return `${tag} ${formatCellValue(val, col.type)}`
}

// Rename an aggregate scope's keys with a prefix (SUM_x → PARENT_SUM_x) so a
// summary formula can reference parent/previous/grand-total aggregates.
function prefixAggs(aggs, prefix) {
  const out = {}
  for (const k of Object.keys(aggs)) out[`${prefix}${k}`] = aggs[k]
  return out
}

// Build the column-aligned cells for a subtotal / grand-total row: cell 0 is
// the label; each other column shows its own per-column summarize aggregate;
// summary calc-field values drop into the remaining empty rightmost cells so
// existing summary-formula reports keep working. Group formulas can reference
// PARENT_/PREV_/GRAND_-prefixed aggregates for % of total, % of parent, and
// prior-group delta.
function summaryRowCells({ label, rows, columns, renderColumns, ctx, calcFields, aggregableColumnNames, bold, indent, parentRows, prevRows, grandRows }) {
  const resolved = buildResolvedRows(rows, columns, ctx)
  const aggs = computeAggregates(resolved, aggregableColumnNames)
  const scope = { ...aggs }
  if (parentRows) Object.assign(scope, prefixAggs(computeAggregates(buildResolvedRows(parentRows, columns, ctx), aggregableColumnNames), 'PARENT_'))
  if (prevRows)   Object.assign(scope, prefixAggs(computeAggregates(buildResolvedRows(prevRows, columns, ctx), aggregableColumnNames), 'PREV_'))
  if (grandRows)  Object.assign(scope, prefixAggs(computeAggregates(buildResolvedRows(grandRows, columns, ctx), aggregableColumnNames), 'GRAND_'))
  const cells = renderColumns.map((c, i) => (i === 0 ? label : summarizeColumnValue(c, resolved)))
  // Place calc-field values into the empty trailing cells (right to left) so
  // per-column summaries keep their own columns and formulas fill the gaps.
  const calcVals = (calcFields || []).map(cf => ({
    text: formatCellValue(evaluateSummaryExpression(cf.expression, scope), cf.data_type),
    title: `${cf.label} (${cf.expression})`,
  }))
  const emptySlots = []
  for (let i = renderColumns.length - 1; i >= 1; i--) if (cells[i] == null) emptySlots.push(i)
  for (let k = calcVals.length - 1, s = 0; k >= 0 && s < emptySlots.length; k--, s++) {
    cells[emptySlots[s]] = calcVals[k]
  }
  return cells.map((cell, i) => {
    const isCalc = cell && typeof cell === 'object'
    return (
      <td key={i} style={{
        ...cellStyle(),
        fontWeight: bold ? 700 : 600,
        color: i === 0 ? C.textSecondary : C.textPrimary,
        ...(i === 0 && indent ? { paddingLeft: indent } : null),
      }} title={isCalc ? cell.title : undefined}>
        {isCalc ? cell.text : (cell || '')}
      </td>
    )
  })
}

function SummarySubtotalRow({ groupRows, columns, renderColumns, depth, ctx, summaryCalcFields, aggregableColumnNames, prevRows, parentRows, grandRows }) {
  return (
    <tr style={{ background:'#f0f3f8', borderTop:`1px solid ${C.borderDark}` }}>
      {summaryRowCells({
        label: 'Subtotal',
        rows: groupRows, columns, renderColumns, ctx,
        calcFields: summaryCalcFields, aggregableColumnNames, bold: false,
        indent: 12 + depth * 18 + 16,
        prevRows, parentRows, grandRows,
      })}
    </tr>
  )
}

function SummaryTotalRow({ rows, columns, renderColumns, summaryCalcFields, aggregableColumnNames, ctx }) {
  const grandTotalCalc = (summaryCalcFields || []).filter(cf => cf.grouping_level == null)
  return (
    <tr style={{ background: C.borderDark, borderTop:`2px solid ${C.textSecondary}` }}>
      {summaryRowCells({
        label: `Grand Total (${rows.length.toLocaleString()} records)`,
        rows, columns, renderColumns, ctx,
        calcFields: grandTotalCalc, aggregableColumnNames, bold: true,
        // At the grand total, parent and grand are itself; no previous group.
        parentRows: rows, grandRows: rows,
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

export function MatrixLayout({ result, fill = false }) {
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
  const rowAxis = buildAxisTree(rows, groupings.map(g => ({ ...groupingFieldDef(g), label: g.field_label, sort: g.sort_direction })), result, 0)
  const colAxis = buildAxisTree(rows, colGroupings.map(c => ({ ...groupingFieldDef(c), label: c.label || c.name, sort: c.sort_direction })), result, 0)

  // Flatten the leaf paths of both axes to drive the table layout
  const rowLeaves = flattenAxisLeaves(rowAxis)
  const colLeaves = flattenAxisLeaves(colAxis)

  // Row/col leaf membership — the rows that fall under each leaf path, so a
  // cell is the intersection and the totals are the marginals. Computed once.
  const rowLeafRows = rowLeaves.map(rl => rows.filter(row =>
    rl.values.every((val, i) => (getRowValue(row, groupingFieldDef(groupings[i]), result) ?? '(blank)') === val)))
  const colLeafRows = colLeaves.map(cl => rows.filter(row =>
    cl.values.every((val, i) => (getRowValue(row, groupingFieldDef(colGroupings[i]), result) ?? '(blank)') === val)))

  // Cell = measure over the intersection of a row leaf and a col leaf.
  const cellMap = new Map()
  for (let ri = 0; ri < rowLeaves.length; ri++) {
    const rlSet = new Set(rowLeafRows[ri])
    for (let ci = 0; ci < colLeaves.length; ci++) {
      const inter = colLeafRows[ci].filter(r => rlSet.has(r))
      cellMap.set(`${ri}##${ci}`, applyMeasure(inter, measure, result))
    }
  }
  // Marginals: row totals (per row leaf), column totals (per col leaf), grand.
  const rowTotals = rowLeafRows.map(rs => applyMeasure(rs, measure, result))
  const colTotals = colLeafRows.map(rs => applyMeasure(rs, measure, result))
  const grandTotal = applyMeasure(rows, measure, result)
  const fmt = (v) => v == null ? <span style={{ color:C.textMuted }}>—</span> : formatMeasureValue(v, measure)

  // Render
  const headerRowCount = colGroupings.length
  const labelColCount  = groupings.length
  const measureLabel = measure.type === 'count' ? 'Records'
    : `${measure.type.toUpperCase()}${measure.field ? ' ' + humanizeColumnLabel(measure.field) : ''}`

  return (
    <div style={{
      background:C.card, border:`1px solid ${C.border}`, borderRadius:8,
      overflow:'auto', minHeight:0,
      ...(fill ? { flex:1 } : { maxHeight:'70vh' }),
    }}>
      <div style={{ padding:'6px 12px', fontSize:11, color:C.textMuted, borderBottom:`1px solid ${C.border}` }}>
        Measure: <strong style={{ color:C.textSecondary }}>{measureLabel}</strong>
      </div>
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
              {/* Row-total column header spans all header rows */}
              {hLvl === 0 && (
                <th rowSpan={headerRowCount}
                    style={{ ...cellHeaderStyle(), textAlign:'right', background:C.cardSecondary, borderLeft:`2px solid ${C.borderDark}` }}>
                  Total
                </th>
              )}
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
              {colLeaves.map((cl, ci) => (
                <td key={`c-${ci}`} style={{ ...cellStyle(), textAlign:'right' }}>
                  {fmt(cellMap.get(`${ri}##${ci}`))}
                </td>
              ))}
              <td style={{ ...cellStyle(), textAlign:'right', fontWeight:600, background:'#f0f3f8', borderLeft:`2px solid ${C.borderDark}` }}>
                {fmt(rowTotals[ri])}
              </td>
            </tr>
          ))}
          {/* Column totals + grand total */}
          <tr style={{ borderTop:`2px solid ${C.borderDark}`, background:C.borderDark }}>
            <td colSpan={labelColCount} style={{ ...cellStyle(), fontWeight:700, color:C.textPrimary }}>Total</td>
            {colLeaves.map((cl, ci) => (
              <td key={`ct-${ci}`} style={{ ...cellStyle(), textAlign:'right', fontWeight:600, color:C.textPrimary }}>
                {fmt(colTotals[ci])}
              </td>
            ))}
            <td style={{ ...cellStyle(), textAlign:'right', fontWeight:700, color:C.textPrimary, borderLeft:`2px solid ${C.textSecondary}` }}>
              {fmt(grandTotal)}
            </td>
          </tr>
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

// Format a measure/aggregate number: integers show whole, fractions show up
// to two decimals, all with thousands separators.
function formatMeasureValue(v, measure) {
  if (v == null) return '—'
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!Number.isFinite(n)) return String(v)
  const isInt = Number.isInteger(n) || (measure && measure.type === 'count')
  return n.toLocaleString(undefined, isInt ? { maximumFractionDigits: 0 } : { maximumFractionDigits: 2 })
}

function humanizeColumnLabel(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Per-column number formatting. A selected field may carry `format`
// (number / currency / percent / compact) and `decimals`. When set and the
// value is numeric, format accordingly; otherwise fall back to the type-based
// formatter. Percent treats the stored value as already a percentage number
// (42 → "42%"), matching how report percentages are computed.
function formatReportValue(v, col) {
  const fmt = col && col.format
  if (fmt && fmt !== 'auto' && v != null && v !== '') {
    const n = typeof v === 'number' ? v : parseFloat(v)
    if (Number.isFinite(n)) {
      const decimals = col.decimals == null ? (fmt === 'currency' ? 2 : 0) : col.decimals
      if (fmt === 'currency') return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      if (fmt === 'percent')  return `${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`
      if (fmt === 'compact')  return n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: decimals || 1 })
      if (fmt === 'number')   return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    }
  }
  return formatCellValue(v, col ? col.type : undefined)
}

// Evaluate a column's conditional-format rules against a value; returns a
// style patch (background/color) or null. Rules: [{op, value, color}] where
// color ∈ emerald|sky|amber|navy (no red, per the LEAP palette). First match
// wins.
const COND_COLORS = {
  emerald: { background: '#e7f7ef', color: '#1c7a52' },
  sky:     { background: '#e8f1fb', color: '#2f6da3' },
  amber:   { background: '#fbf2df', color: '#8a6316' },
  navy:    { background: '#e6eaf2', color: '#1f3355' },
}
function conditionalCellStyle(v, col) {
  const rules = col && col.conditional_rules
  if (!rules || !rules.length) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  for (const r of rules) {
    const target = parseFloat(r.value)
    let hit = false
    switch (r.op) {
      case 'gt':  hit = Number.isFinite(n) && n > target; break
      case 'gte': hit = Number.isFinite(n) && n >= target; break
      case 'lt':  hit = Number.isFinite(n) && n < target; break
      case 'lte': hit = Number.isFinite(n) && n <= target; break
      case 'eq':  hit = String(v) === String(r.value); break
      case 'ne':  hit = String(v) !== String(r.value); break
      default: hit = false
    }
    if (hit) return COND_COLORS[r.color] || COND_COLORS.sky
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

// Header cells carry their own background: these tables use
// border-collapse:collapse, where a background set on the sticky <thead> is
// painted with the table and left behind, letting the scrolled rows show
// through the pinned header. The bottom rule is an inset shadow for the same
// reason (a collapsed border on a sticky cell scrolls away with the table).
function cellHeaderStyle() {
  return {
    padding:'10px 12px', fontSize:11, fontWeight:600, color:C.textSecondary,
    textTransform:'uppercase', letterSpacing:0.5, textAlign:'left',
    background:C.cardSecondary, boxShadow:`inset 0 -1px 0 ${C.border}`, whiteSpace:'nowrap',
  }
}

function cellStyle() {
  return {
    padding:'8px 12px', color:C.textPrimary, verticalAlign:'top',
    whiteSpace:'nowrap',
  }
}

function miniBtnStyle() {
  return {
    padding:'4px 10px', fontSize:12, fontWeight:500,
    background:C.card, color:C.textSecondary,
    border:`1px solid ${C.borderDark}`, borderRadius:6, cursor:'pointer',
  }
}

// Scoped stylesheet — inline styles can't express :hover, and a report table
// without row hover reads as a static dump rather than a record list.
function ReportViewerStyles() {
  return (
    <style>{`
      .rpt-detail-row:hover > td { background: ${C.cardSecondary}; }
      .rpt-group-row:hover > td  { filter: brightness(0.985); }
    `}</style>
  )
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
