// Inline report widget for record-detail page layouts.
//
// Configuration shape (widget.widget_config):
//   { report_id: <uuid>,                  // which saved report to render
//     filter_field: 'project_id',         // (optional) field on the report's
//                                         //   primary object to filter by
//                                         //   the current record's id —
//                                         //   makes the widget context-aware
//     max_rows: 50 }                      // (optional) row cap; default 50
//
// Renders an inline scrollable table of the report results, with a
// "Open Report" link to jump into the full Report Runner. Designed to
// be lightweight — uses the same runReport() service the runner uses,
// just with smaller display footprint.

import { useState, useEffect } from 'react'
import { runReport, getRowValue } from '../data/reportsService'
import { C } from '../data/constants'

export function ReportWidget({ widget, parentTable, parentRecordId, onOpenRecord }) {
  const cfg = widget.widget_config || {}
  const reportId = cfg.report_id
  const filterField = cfg.filter_field
  const maxRows = cfg.max_rows || 50

  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!reportId) { setLoading(false); return }
    let cancelled = false

    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await runReport(reportId)
        // Apply context filter if configured: only show rows where
        // row[filter_field] === parentRecordId. This makes a generic
        // 'All Tasks' report act as 'Tasks for THIS record' when embedded.
        let filtered = r.rows
        if (filterField && parentRecordId) {
          filtered = (r.rows || []).filter(row => {
            const v = row[filterField]
            return v === parentRecordId
          })
        }
        if (cancelled) return
        setResult({ ...r, rows: filtered.slice(0, maxRows), totalRows: filtered.length })
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [reportId, filterField, parentRecordId, maxRows])

  if (!reportId) {
    return (
      <div style={containerStyle()}>
        <div style={headerStyle()}>{widget.widget_title || 'Report'}</div>
        <div style={{ padding: 12, fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>
          No report configured. Edit this widget to select a report.
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle()}>
      <div style={{ ...headerStyle(), display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span>{widget.widget_title || result?.name || 'Report'}</span>
        <button
          onClick={() => onOpenRecord?.({ table: 'reports', id: reportId })}
          style={{
            background: 'transparent', border: 'none', color: C.emerald,
            fontSize: 12, fontWeight: 500, cursor: 'pointer', padding: 0,
          }}
        >
          Open Report →
        </button>
      </div>

      {loading && (
        <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>Loading…</div>
      )}
      {error && (
        <div style={{ padding: 12, fontSize: 12, color: '#c33' }}>
          Failed to load: {error.message}
        </div>
      )}
      {result && !loading && !error && (
        <ReportWidgetTable result={result} maxRows={maxRows} />
      )}
    </div>
  )
}

function ReportWidgetTable({ result, maxRows }) {
  const { rows, columns, totalRows } = result
  if (!columns || columns.length === 0) {
    return <div style={{ padding: 12, fontSize: 12, color: C.textMuted }}>Report has no fields configured.</div>
  }
  if (rows.length === 0) {
    return <div style={{ padding: 12, fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>No matching rows.</div>
  }
  return (
    <>
      <div style={{ overflow:'auto', maxHeight: 320 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
          <thead style={{ background:C.cardSecondary, position:'sticky', top:0 }}>
            <tr>
              {columns.map((c, idx) => (
                <th key={idx} style={{
                  padding:'6px 10px', fontSize:10, fontWeight:600, color:C.textSecondary,
                  textTransform:'uppercase', letterSpacing:0.5, textAlign:'left', whiteSpace:'nowrap',
                  borderBottom:`1px solid ${C.border}`,
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id || ri} style={{ borderTop:`1px solid ${C.border}` }}>
                {columns.map((c, ci) => {
                  const v = getRowValue(row, c, result)
                  return (
                    <td key={ci} style={{ padding:'6px 10px', whiteSpace:'nowrap', color:C.textPrimary }}>
                      {formatWidgetCell(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > maxRows && (
        <div style={{
          padding:'6px 12px', fontSize:11, color:C.textMuted,
          borderTop:`1px solid ${C.border}`, background:C.cardSecondary,
        }}>
          Showing {maxRows.toLocaleString()} of {totalRows.toLocaleString()} rows. Open the report to see all results.
        </div>
      )}
    </>
  )
}

function formatWidgetCell(v) {
  if (v == null) return <span style={{ color:C.textMuted }}>—</span>
  if (typeof v === 'object') return <span style={{ color:C.textMuted }}>[obj]</span>
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:10, color:C.textMuted }}>{v.slice(0, 8)}…</span>
  }
  return String(v)
}

function containerStyle() {
  return {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
    overflow: 'hidden', marginBottom: 16,
  }
}
function headerStyle() {
  return {
    padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.textPrimary,
    borderBottom: `1px solid ${C.border}`, background: C.cardSecondary,
  }
}
