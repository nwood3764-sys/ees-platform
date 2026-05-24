import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import {
  getEditableFieldsForTable,
  getPicklistOptions,
  searchLookupOptions,
  resolveLookupLabel,
  bulkUpdateRecords,
} from '../data/fieldMetadataService'

// =====================================================================
// EditableListView
//
// Salesforce-style list view with:
//   - Row checkboxes (header checkbox = select all visible, with
//     indeterminate state for partial selection)
//   - Inline edit: double-click a cell to enter edit mode; Enter to
//     save, Esc to cancel; tab to next editable cell
//   - Bulk edit toolbar: appears when 1+ rows are selected; choose a
//     field + new value + apply to all selected rows in one RPC call
//   - Per-cell error display when validation/RLS rejects a write
//   - Type-aware editors: text, number, date, datetime, boolean,
//     picklist (dropdown), lookup (typeahead picker)
//   - Column sort: click a header to sort, click again to reverse,
//     a third click to clear
//
// Props:
//   tableName        — required, the LEAP table to write back to
//   data             — array of row objects. Must include `_id` (the
//                      underlying record uuid).
//   columns          — column descriptors:
//                        { field, label, columnName?, editable?,
//                          type?, width?, render?(row), sortable? }
//                      field   = key on `data` rows used for display
//                      columnName = actual DB column name on the table
//                                   (defaults to field; required when
//                                   the display field is a derived/
//                                   joined value)
//                      editable: defaults to true when columnName is
//                                a user-editable field on the table
//   onRecordsUpdated — fired after a successful save; receives the
//                      RPC summary {records_total, records_updated,
//                      records_errored, errors[]}.
//   onOpenRecord     — opens RecordDetail; bound to the row's name
//                      link (separate from cell editing).
// =====================================================================

export function EditableListView({
  tableName,
  data: rawData,
  columns,
  onRecordsUpdated,
  onOpenRecord,
}) {
  // ---- field metadata ----
  const [fieldMeta, setFieldMeta] = useState(null)        // Map<columnName, meta>
  const [fieldMetaErr, setFieldMetaErr] = useState(null)
  useEffect(() => {
    let cancelled = false
    setFieldMeta(null); setFieldMetaErr(null)
    getEditableFieldsForTable(tableName)
      .then(rows => {
        if (cancelled) return
        const m = new Map(rows.map(r => [r.columnName, r]))
        setFieldMeta(m)
      })
      .catch(e => { if (!cancelled) setFieldMetaErr(e) })
    return () => { cancelled = true }
  }, [tableName])

  // ---- sort state ----
  const [sort, setSort] = useState(null) // { field, dir }
  const sortedData = useMemo(() => {
    if (!sort) return rawData
    const { field, dir } = sort
    const m = dir === 'asc' ? 1 : -1
    return [...rawData].sort((a, b) => {
      const av = a[field], bv = b[field]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * m
      return String(av).localeCompare(String(bv)) * m
    })
  }, [rawData, sort])

  // ---- selection state ----
  // Sets are keyed on the underlying record uuid (_id), not the display id.
  const [selected, setSelected] = useState(() => new Set())
  const visibleIds = useMemo(() => sortedData.map(r => r._id).filter(Boolean), [sortedData])
  const visibleSelected = useMemo(() => {
    let n = 0
    for (const id of visibleIds) if (selected.has(id)) n++
    return n
  }, [visibleIds, selected])
  const allVisibleSelected = visibleIds.length > 0 && visibleSelected === visibleIds.length
  const someVisibleSelected = visibleSelected > 0 && visibleSelected < visibleIds.length

  const toggleAllVisible = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }
  const toggleRow = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // ---- inline edit state ----
  // { rowId, columnName } | null
  const [editingCell, setEditingCell] = useState(null)
  const [editError, setEditError]     = useState(null)  // { rowId, columnName, message }
  const [savingCell, setSavingCell]   = useState(null)  // same shape as editingCell

  // Optimistic-write overlay so newly-saved values appear immediately
  // before the parent reloads from the server. Keyed by `${rowId}::${columnName}`.
  const [overlay, setOverlay] = useState(new Map())
  const getRowValue = (row, col) => {
    const k = `${row._id}::${col.columnName || col.field}`
    if (overlay.has(k)) return overlay.get(k)
    return row[col.field]
  }

  const saveSingleCell = async (rowId, columnName, newValue) => {
    setSavingCell({ rowId, columnName })
    setEditError(null)
    try {
      const result = await bulkUpdateRecords(tableName, [rowId], { [columnName]: newValue })
      if (result.records_errored > 0) {
        const errMsg = (result.errors?.[0]?.error) || 'Update failed'
        setEditError({ rowId, columnName, message: errMsg })
        return
      }
      // Overlay the new value so the cell shows it before the parent reloads.
      setOverlay(prev => {
        const next = new Map(prev)
        next.set(`${rowId}::${columnName}`, newValue)
        return next
      })
      setEditingCell(null)
      if (onRecordsUpdated) onRecordsUpdated(result)
    } catch (e) {
      setEditError({ rowId, columnName, message: e.message || String(e) })
    } finally {
      setSavingCell(null)
    }
  }

  // ---- bulk edit state ----
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false)

  // Clear stale overlay entries when raw data changes (parent reloaded).
  useEffect(() => { setOverlay(new Map()) }, [rawData])

  // ---- render ----
  if (fieldMetaErr) {
    return (
      <div style={{ padding: 20, color: '#a32626', fontSize: 13 }}>
        Failed to load field metadata for {tableName}: {fieldMetaErr.message}
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Bulk-edit toolbar */}
      {selected.size > 0 && (
        <div style={{
          padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 14,
          background: '#e8f8f2', borderBottom: `1px solid #2aab72`,
        }}>
          <div style={{ fontSize: 12.5, color: '#1a7a4e', fontWeight: 600 }}>
            {selected.size.toLocaleString()} selected
          </div>
          <button onClick={() => setBulkPanelOpen(true)}
            style={{
              padding: '6px 14px', fontSize: 12.5, fontWeight: 600,
              background: '#3ecf8e', border: '1px solid #2aab72', borderRadius: 6,
              color: '#fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <Icon path="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" size={13} color="#fff" />
            Edit selected
          </button>
          <button onClick={() => setSelected(new Set())}
            style={{
              padding: '6px 12px', fontSize: 12.5, fontWeight: 500,
              background: 'transparent', border: '1px solid #2aab72', borderRadius: 6,
              color: '#1a7a4e', cursor: 'pointer',
            }}>
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: C.card, zIndex: 5 }}>
              <th style={thCheckStyle}>
                <CheckboxCell
                  checked={allVisibleSelected}
                  indeterminate={someVisibleSelected}
                  onChange={toggleAllVisible}
                />
              </th>
              {columns.map(col => (
                <th key={col.field} style={{ ...thStyle, width: col.width, minWidth: col.width }}>
                  <SortHeader
                    column={col}
                    sort={sort}
                    onSort={() => {
                      if (col.sortable === false) return
                      setSort(s => {
                        if (!s || s.field !== col.field) return { field: col.field, dir: 'asc' }
                        if (s.dir === 'asc') return { field: col.field, dir: 'desc' }
                        return null
                      })
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.map(row => (
              <tr key={row._id} style={{
                background: selected.has(row._id) ? '#f0faf6' : 'transparent',
                borderBottom: `1px solid ${C.border}`,
              }}>
                <td style={tdCheckStyle}>
                  <CheckboxCell
                    checked={selected.has(row._id)}
                    onChange={() => toggleRow(row._id)}
                  />
                </td>
                {columns.map(col => {
                  const columnName = col.columnName || col.field
                  const meta       = fieldMeta?.get(columnName)
                  const isEditable = col.editable !== false && meta?.isEditable === true
                  const isEditing  = editingCell?.rowId === row._id && editingCell?.columnName === columnName
                  const isSaving   = savingCell?.rowId === row._id && savingCell?.columnName === columnName
                  const errorHere  = editError?.rowId === row._id && editError?.columnName === columnName
                                       ? editError.message : null
                  const displayValue = getRowValue(row, col)

                  return (
                    <td key={col.field}
                        onDoubleClick={() => {
                          if (!isEditable || isSaving) return
                          setEditingCell({ rowId: row._id, columnName })
                          setEditError(null)
                        }}
                        title={isEditable ? 'Double-click to edit' : 'System-managed — read only'}
                        style={{
                          ...tdStyle,
                          cursor: isEditable ? 'cell' : 'default',
                          background: errorHere ? '#fde8e8' : undefined,
                          position: 'relative',
                        }}>
                      {isEditing ? (
                        <CellEditor
                          meta={meta}
                          column={col}
                          initialValue={displayUnderlyingValue(row, col, meta)}
                          onCancel={() => { setEditingCell(null); setEditError(null) }}
                          onSave={(newValue) => saveSingleCell(row._id, columnName, newValue)}
                        />
                      ) : (
                        <CellDisplay
                          row={row} col={col} meta={meta}
                          value={displayValue}
                          isEditable={isEditable}
                          isSaving={isSaving}
                          isPrimaryColumn={col === columns[0] || col.field === 'name'}
                          onOpenRecord={onOpenRecord}
                        />
                      )}
                      {errorHere && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, zIndex: 10,
                          background: '#a32626', color: '#fff', fontSize: 11,
                          padding: '4px 8px', borderRadius: '0 0 4px 4px',
                          maxWidth: 280,
                        }}>{errorHere}</div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {sortedData.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: '40px 20px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                  No records to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        padding: '8px 18px', borderTop: `1px solid ${C.border}`,
        background: C.card, fontSize: 11.5, color: C.textSecondary,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span><b>{sortedData.length.toLocaleString()}</b> records</span>
        {selected.size > 0 && (
          <span style={{ color: '#1a7a4e', fontWeight: 600 }}>{selected.size.toLocaleString()} selected</span>
        )}
        <span style={{ marginLeft: 'auto', fontStyle: 'italic', color: C.textMuted }}>
          Double-click a cell to edit. Select rows to bulk-edit a field across all of them.
        </span>
      </div>

      {/* Bulk edit modal */}
      {bulkPanelOpen && (
        <BulkEditModal
          tableName={tableName}
          fieldMeta={fieldMeta}
          columns={columns}
          recordIds={[...selected]}
          onClose={() => setBulkPanelOpen(false)}
          onApplied={(summary) => {
            setBulkPanelOpen(false)
            if (onRecordsUpdated) onRecordsUpdated(summary)
            setSelected(new Set())
          }}
        />
      )}
    </div>
  )
}

// =====================================================================
// CellDisplay — the read-only render of a cell value.
// =====================================================================
function CellDisplay({ row, col, meta, value, isEditable, isSaving, isPrimaryColumn, onOpenRecord }) {
  if (col.render) {
    return <>{col.render(row)}</>
  }
  if (isSaving) {
    return <span style={{ color: C.textMuted, fontStyle: 'italic' }}>Saving…</span>
  }
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: C.textMuted }}>—</span>
  }
  if (meta?.editorType === 'boolean') {
    return value ? 'Yes' : 'No'
  }
  if (meta?.editorType === 'date' || meta?.editorType === 'datetime') {
    try {
      const s = String(value)
      return meta.editorType === 'date' ? s.slice(0, 10) : s.slice(0, 16).replace('T', ' ')
    } catch { return String(value) }
  }
  // Primary column → clickable to open the record
  if (isPrimaryColumn && onOpenRecord && row._id) {
    return (
      <a
        onClick={(e) => { e.stopPropagation(); onOpenRecord({ _id: row._id, name: row.name || value }) }}
        style={{ color: '#2aab72', cursor: 'pointer', fontWeight: 500, textDecoration: 'none' }}
        onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
        onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}>
        {String(value)}
      </a>
    )
  }
  return String(value)
}

// =====================================================================
// CellEditor — the in-place editor for whatever type the cell is.
// =====================================================================
function CellEditor({ meta, column, initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue ?? '')
  const editorType = meta?.editorType || 'text'

  const commit = () => {
    let toSend = value
    if (editorType === 'number' && value !== '' && value !== null) {
      const n = Number(value)
      if (Number.isNaN(n)) { onCancel(); return }
      toSend = n
    }
    if (value === '' || value === null) toSend = null
    onSave(toSend)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }

  if (editorType === 'boolean') {
    return (
      <select autoFocus value={String(value ?? '')}
        onBlur={commit}
        onChange={(e) => { setValue(e.target.value === 'true'); }}
        onKeyDown={onKeyDown}
        style={editorStyle}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (editorType === 'picklist' && meta?.picklistObject && meta?.picklistField) {
    return <PicklistEditor meta={meta} value={value} setValue={setValue} commit={commit} onCancel={onCancel} />
  }
  if (editorType === 'lookup' && meta?.referencesTable) {
    return <LookupEditor meta={meta} value={value} setValue={setValue} commit={commit} onCancel={onCancel} />
  }
  if (editorType === 'date') {
    return (
      <input autoFocus type="date" value={value || ''}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        style={editorStyle} />
    )
  }
  if (editorType === 'datetime') {
    return (
      <input autoFocus type="datetime-local" value={(value || '').slice(0, 16)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        style={editorStyle} />
    )
  }
  if (editorType === 'number') {
    return (
      <input autoFocus type="number" value={value ?? ''}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit} onKeyDown={onKeyDown}
        style={editorStyle} />
    )
  }
  return (
    <input autoFocus type="text" value={value ?? ''}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit} onKeyDown={onKeyDown}
      style={editorStyle} />
  )
}

// PicklistEditor — dropdown of active picklist_values options.
function PicklistEditor({ meta, value, setValue, commit, onCancel }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    getPicklistOptions(meta.picklistObject, meta.picklistField)
      .then(opts => { if (!cancelled) { setOptions(opts); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [meta.picklistObject, meta.picklistField])

  return (
    <select autoFocus value={value || ''}
      onChange={(e) => setValue(e.target.value || null)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }}
      style={editorStyle}>
      <option value="">—</option>
      {loading && <option disabled>Loading…</option>}
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

// LookupEditor — typeahead picker for foreign keys to entity tables.
function LookupEditor({ meta, value, setValue, commit, onCancel }) {
  const [query, setQuery]     = useState('')
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(true)

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true)
      searchLookupOptions(meta.referencesTable, query, { limit: 20 })
        .then(o => setOptions(o))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false))
    }, 180)
    return () => clearTimeout(t)
  }, [query, meta.referencesTable])

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input autoFocus type="text" value={query}
        placeholder={`Search ${meta.referencesTable}…`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
          if (e.key === 'Enter' && options[0]) {
            e.preventDefault()
            setValue(options[0].id)
            setTimeout(() => commit(), 0)
          }
        }}
        style={editorStyle}
      />
      {open && (options.length > 0 || loading) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
          maxHeight: 220, overflowY: 'auto',
          boxShadow: '0 6px 18px rgba(7,17,31,0.2)',
        }}>
          {loading && <div style={{ padding: 8, fontSize: 12, color: C.textMuted }}>Searching…</div>}
          {options.map(o => (
            <div key={o.id} onMouseDown={(e) => {
                  e.preventDefault()
                  setValue(o.id)
                  setOpen(false)
                  setTimeout(() => commit(), 0)
                }}
                style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// BulkEditModal — Salesforce-style "edit this field on all selected rows"
// =====================================================================
function BulkEditModal({ tableName, fieldMeta, columns, recordIds, onClose, onApplied }) {
  // Editable columns derived from the table's field metadata, not from
  // the visible column set — bulk edit can change fields that aren't
  // shown in the list.
  const editableFields = useMemo(() => {
    if (!fieldMeta) return []
    const out = []
    for (const [columnName, meta] of fieldMeta.entries()) {
      if (!meta.isEditable) continue
      const colDescriptor = columns.find(c => (c.columnName || c.field) === columnName)
      out.push({
        columnName,
        label: colDescriptor?.label || prettify(columnName),
        meta,
      })
    }
    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  }, [fieldMeta, columns])

  const [field, setField] = useState('')
  const [value, setValue] = useState('')
  const [working, setWorking] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)

  const selectedMeta = field ? fieldMeta.get(field) : null

  const apply = async () => {
    if (!field) return
    setWorking(true); setError(null); setResult(null)
    try {
      const sendValue = value === '' || value === null ? null
                       : selectedMeta?.editorType === 'number' ? Number(value)
                       : selectedMeta?.editorType === 'boolean' ? (value === 'true')
                       : value
      const summary = await bulkUpdateRecords(tableName, recordIds, { [field]: sendValue })
      setResult(summary)
      if (summary.records_errored === 0 && onApplied) onApplied(summary)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setWorking(false)
    }
  }

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(7,17,31,0.55)', zIndex:9000,
               display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background:C.card, borderRadius:10, width:'min(560px, 100%)', maxHeight:'90vh',
                 display:'flex', flexDirection:'column', overflow:'hidden',
                 boxShadow:'0 12px 40px rgba(7,17,31,0.4)' }}>
        <div style={{ padding:'14px 18px', borderBottom:`1px solid ${C.border}`,
                      display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:15, fontWeight:600, color:C.textPrimary }}>
            Edit field across {recordIds.length.toLocaleString()} record{recordIds.length === 1 ? '' : 's'}
          </div>
          <button onClick={onClose}
            style={{ background:'transparent', border:'none', cursor:'pointer', color:C.textMuted, fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:'14px 18px', overflowY:'auto', flex:1 }}>
          <div style={{ marginBottom:12 }}>
            <label style={modalLabelStyle}>Field</label>
            <select value={field} onChange={(e) => { setField(e.target.value); setValue('') }}
              style={modalInputStyle}>
              <option value="">— Select a field —</option>
              {editableFields.map(f => (
                <option key={f.columnName} value={f.columnName}>{f.label} <em>({f.meta.editorType})</em></option>
              ))}
            </select>
          </div>

          {field && (
            <div style={{ marginBottom:12 }}>
              <label style={modalLabelStyle}>New value</label>
              <BulkValueEditor meta={selectedMeta} value={value} setValue={setValue} />
              <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
                Leave blank to clear the field on all selected records.
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding:'10px 12px', background:'#fde8e8', color:'#a32626', fontSize:12, borderRadius:6, marginBottom:12 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ padding:'12px 14px', background: result.records_errored > 0 ? '#fef3e7' : '#e8f8f2',
                          color: result.records_errored > 0 ? '#a35a18' : '#1a7a4e',
                          fontSize:12.5, borderRadius:6, marginBottom:12 }}>
              <div style={{ fontWeight:600, marginBottom:6 }}>
                {result.records_updated} updated, {result.records_errored} errored, of {result.records_total} total
              </div>
              {Array.isArray(result.errors) && result.errors.length > 0 && (
                <details>
                  <summary style={{ cursor:'pointer', fontWeight:600 }}>{result.errors.length} error{result.errors.length === 1 ? '' : 's'}</summary>
                  <pre style={{ fontSize:10.5, fontFamily:'JetBrains Mono, monospace', marginTop:6, whiteSpace:'pre-wrap', maxHeight:140, overflow:'auto' }}>
                    {JSON.stringify(result.errors, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>

        <div style={{ padding:'12px 18px', borderTop:`1px solid ${C.border}`,
                      display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose}
            style={modalSecondaryBtn}>Close</button>
          <button onClick={apply} disabled={!field || working}
            style={{ ...modalPrimaryBtn,
                     background: (!field || working) ? C.border : '#3ecf8e',
                     cursor: (!field || working) ? 'not-allowed' : 'pointer' }}>
            {working ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkValueEditor({ meta, value, setValue }) {
  if (!meta) return null
  if (meta.editorType === 'boolean') {
    return (
      <select value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  if (meta.editorType === 'picklist') {
    return <BulkPicklistValue meta={meta} value={value} setValue={setValue} />
  }
  if (meta.editorType === 'lookup') {
    return <BulkLookupValue meta={meta} value={value} setValue={setValue} />
  }
  if (meta.editorType === 'date') {
    return <input type="date" value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle} />
  }
  if (meta.editorType === 'datetime') {
    return <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle} />
  }
  if (meta.editorType === 'number') {
    return <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle} />
  }
  return <input type="text" value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle} />
}

function BulkPicklistValue({ meta, value, setValue }) {
  const [options, setOptions] = useState([])
  useEffect(() => {
    getPicklistOptions(meta.picklistObject, meta.picklistField)
      .then(setOptions).catch(() => setOptions([]))
  }, [meta.picklistObject, meta.picklistField])
  return (
    <select value={value} onChange={(e) => setValue(e.target.value)} style={modalInputStyle}>
      <option value="">—</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  )
}

function BulkLookupValue({ meta, value, setValue }) {
  const [query, setQuery] = useState('')
  const [opts, setOpts]   = useState([])
  const [picked, setPicked] = useState(null)
  useEffect(() => {
    const t = setTimeout(() => {
      searchLookupOptions(meta.referencesTable, query, { limit: 20 })
        .then(setOpts).catch(() => setOpts([]))
    }, 180)
    return () => clearTimeout(t)
  }, [query, meta.referencesTable])

  if (picked) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ flex:1, padding:'8px 10px', background:'#e8f8f2', border:'1px solid #2aab72', borderRadius:6, fontSize:12, color:'#1a7a4e' }}>
          {picked.label}
        </div>
        <button onClick={() => { setPicked(null); setValue('') }}
          style={{ background:'transparent', border:'none', cursor:'pointer', color:C.textMuted, fontSize:14, padding:4 }}>✕</button>
      </div>
    )
  }
  return (
    <div>
      <input type="text" value={query} placeholder={`Search ${meta.referencesTable}…`}
        onChange={(e) => setQuery(e.target.value)} style={modalInputStyle} />
      {opts.length > 0 && (
        <div style={{
          marginTop:4, maxHeight:180, overflowY:'auto',
          border:`1px solid ${C.border}`, borderRadius:6, background:C.page,
        }}>
          {opts.map(o => (
            <div key={o.id} onClick={() => { setPicked(o); setValue(o.id); setQuery('') }}
              style={{ padding:'7px 10px', fontSize:12, cursor:'pointer', borderBottom:`1px solid ${C.border}` }}>
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Bits
// =====================================================================

function SortHeader({ column, sort, onSort }) {
  const active = sort?.field === column.field
  return (
    <div onClick={onSort}
      style={{ display:'flex', alignItems:'center', gap:5, cursor: column.sortable === false ? 'default' : 'pointer', userSelect:'none' }}>
      <span>{column.label}</span>
      {active && (
        <Icon
          path={sort.dir === 'asc' ? "M12 5v14M5 12l7-7 7 7" : "M12 19V5M5 12l7 7 7-7"}
          size={11} color={C.textSecondary} />
      )}
    </div>
  )
}

function CheckboxCell({ checked, indeterminate, onChange }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])
  return (
    <input ref={ref} type="checkbox" checked={!!checked} onChange={onChange}
      style={{ cursor:'pointer', width:14, height:14, accentColor:'#3ecf8e' }} />
  )
}

// Pull the actual underlying value the editor should start with — for
// joined-display columns the row.field shows a label (e.g. account
// name) but the underlying column holds a uuid. The columnName
// indicates which field on the row carries the editable value, when
// it differs from the display field.
function displayUnderlyingValue(row, col, meta) {
  if (!col.columnName || col.columnName === col.field) return row[col.field]
  if (row[col.columnName] !== undefined) return row[col.columnName]
  return row[col.field]
}

function prettify(s) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ---- styles ----
const thStyle = {
  textAlign:'left', padding:'9px 12px',
  borderBottom:`1px solid ${C.border}`,
  fontSize:10.5, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5,
  color:C.textMuted, background:C.card, whiteSpace:'nowrap',
}
const thCheckStyle = { ...thStyle, width:34, padding:'9px 0 9px 14px' }
const tdStyle = {
  padding:'9px 12px', fontSize:12, color:C.textPrimary, verticalAlign:'middle',
  minWidth:80,
}
const tdCheckStyle = { ...tdStyle, padding:'9px 0 9px 14px', width:34 }
const editorStyle = {
  width:'100%', padding:'5px 8px', fontSize:12,
  border:'1.5px solid #2aab72', borderRadius:4,
  background:C.card, color:C.textPrimary, outline:'none',
}
const modalLabelStyle = { fontSize:11, color:C.textMuted, fontWeight:500, display:'block', marginBottom:4, textTransform:'uppercase', letterSpacing:0.3 }
const modalInputStyle = { width:'100%', padding:'8px 10px', fontSize:13, border:`1px solid ${C.border}`, borderRadius:6, background:C.card, color:C.textPrimary }
const modalPrimaryBtn = { padding:'8px 16px', fontSize:12.5, fontWeight:600, color:'#fff', border:'none', borderRadius:6 }
const modalSecondaryBtn = { padding:'8px 14px', fontSize:12.5, fontWeight:500, background:C.page, border:`1px solid ${C.border}`, borderRadius:6, color:C.textSecondary, cursor:'pointer' }
