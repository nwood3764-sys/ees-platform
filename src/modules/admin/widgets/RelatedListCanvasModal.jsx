import { useState, useEffect, useMemo } from 'react'
import { C } from '../../../data/constants'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { describeObject, describeIncomingFKs } from '../../../data/adminService'
import { humanizeColumnName } from './eesFieldTypes'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle,
  dangerBoxStyle, hintBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// RelatedListCanvasModal — configure a related_list widget for the canvas
// page-layout builder (LayoutCanvasEditor). Purely local: collects
// { title, config } and hands it back via onApply — nothing is written to
// the database until the admin saves the whole layout.
//
// Emits config.columns in the shape the live renderer (RecordDetail's
// RelatedListWidget + fetchRelatedRecords) expects: an array of
// { name, type, label } entries, where FK columns become
//   type 'picklist' when they reference picklist_values, or
//   type 'lookup' with { fk_column, lookup_table, lookup_field } so the
//   list shows the referenced record's display name instead of a UUID.
// The lookup_field is resolved from the referenced table's columns (first
// *_name column, else falls back to a plain text cell).
//
// The DB trigger trg_validate_page_layout_widget_config re-validates
// table / fk / columns on insert, so a stale schema can't slip through.
// ---------------------------------------------------------------------------

const SORT_DIRECTIONS = [
  { value: 'asc',  label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]

// System plumbing columns hidden from the display-columns picker.
const HIDDEN_TARGET_COLUMNS = new Set([
  'created_at', 'updated_at',
  'created_by', 'updated_by',
  'is_deleted', 'deleted_at', 'deleted_by', 'deletion_reason',
])

// Renderer-facing type for a describeObject column row (related-list cells).
function relatedColumnType(col) {
  const dt = col.data_type || ''
  if (col.is_foreign_key && dt === 'uuid') {
    return col.references_table === 'picklist_values' ? 'picklist' : 'lookup'
  }
  if (dt === 'date') return 'date'
  if (dt === 'timestamp with time zone' || dt === 'timestamp without time zone') return 'datetime'
  if (dt === 'boolean') return 'boolean'
  if (['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'].includes(dt)) return 'number'
  return 'text'
}

// Pick the display column on a lookup's referenced table: prefer the first
// *_name column, then a literal `name`, else null (caller degrades to text).
function pickDisplayField(columns) {
  const named = columns.find(c => /_name$/.test(c.column_name))
  if (named) return named.column_name
  const plain = columns.find(c => c.column_name === 'name')
  return plain ? plain.column_name : null
}

export default function RelatedListCanvasModal({
  objectName,           // parent object the layout belongs to
  initial,              // { title, config } when editing, null when adding
  onClose,
  onApply,              // ({ title, config }) => void
}) {
  const isMobile = useIsMobile()
  const cfg = initial?.config || {}

  const [title, setTitle]             = useState(initial?.title || '')
  const [targetTable, setTargetTable] = useState(cfg.table || '')
  const [fkColumn, setFkColumn]       = useState(cfg.fk || '')
  const [selectedCols, setSelectedCols] = useState(
    Array.isArray(cfg.columns) ? cfg.columns.map(c => c.name).filter(Boolean) : [],
  )
  const [sortField, setSortField] = useState(cfg.sort_field || '')
  const [sortDir, setSortDir]     = useState(cfg.sort_dir || 'asc')

  const [incomingFKs, setIncomingFKs]     = useState([])
  const [loadingFKs, setLoadingFKs]       = useState(true)
  const [targetColumns, setTargetColumns] = useState([])
  const [loadingTarget, setLoadingTarget] = useState(false)

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoadingFKs(true)
    describeIncomingFKs(objectName)
      .then(fks => { if (!cancelled) setIncomingFKs(fks || []) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingFKs(false) })
    return () => { cancelled = true }
  }, [objectName])

  useEffect(() => {
    if (!targetTable) { setTargetColumns([]); return }
    let cancelled = false
    setLoadingTarget(true)
    describeObject(targetTable)
      .then(cols => { if (!cancelled) setTargetColumns(cols || []) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingTarget(false) })
    return () => { cancelled = true }
  }, [targetTable])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const targetTables = useMemo(() => {
    const seen = new Set()
    for (const fk of incomingFKs) seen.add(fk.referencing_table)
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [incomingFKs])

  const fkChoices = useMemo(
    () => incomingFKs.filter(fk => fk.referencing_table === targetTable),
    [incomingFKs, targetTable],
  )

  // Auto-pick the FK when the target has exactly one; clear a stale pick.
  useEffect(() => {
    if (targetTable && fkChoices.length === 1 && !fkColumn) {
      setFkColumn(fkChoices[0].referencing_column)
    }
    if (fkColumn && fkChoices.length > 0 && !fkChoices.some(fk => fk.referencing_column === fkColumn)) {
      setFkColumn('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTable, fkChoices])

  const selectableTargetColumns = useMemo(() => (
    targetColumns
      .filter(c => !HIDDEN_TARGET_COLUMNS.has(c.column_name) && !c.is_primary_key)
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
  ), [targetColumns])

  function toggleColumn(name) {
    setSelectedCols(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name],
    )
  }

  function validate() {
    if (!title.trim()) return 'Title is required'
    if (!targetTable) return 'Pick a target table'
    if (!fkColumn) return 'Pick the foreign key column that joins to this object'
    if (selectedCols.length === 0) return 'Pick at least one column to display'
    return null
  }

  async function apply() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const byName = new Map(targetColumns.map(c => [c.column_name, c]))

      // Resolve display fields for lookup columns up front (cached RPC).
      const lookupTables = [...new Set(
        selectedCols
          .map(n => byName.get(n))
          .filter(c => c && relatedColumnType(c) === 'lookup')
          .map(c => c.references_table),
      )]
      const displayFieldByTable = {}
      await Promise.all(lookupTables.map(async (t) => {
        const cols = await describeObject(t).catch(() => [])
        displayFieldByTable[t] = pickDisplayField(cols || [])
      }))

      // Preserve prior column entries verbatim (they may carry hand-authored
      // labels or lookup wiring); build fresh entries for new picks.
      const priorByName = new Map(
        (Array.isArray(cfg.columns) ? cfg.columns : []).map(c => [c.name, c]),
      )
      const columns = selectedCols.map(name => {
        const prior = priorByName.get(name)
        if (prior && cfg.table === targetTable) return prior
        const col = byName.get(name)
        const type = col ? relatedColumnType(col) : 'text'
        const entry = { name, type, label: humanizeColumnName(name) }
        if (type === 'lookup') {
          const lookupField = displayFieldByTable[col.references_table]
          if (lookupField) {
            entry.fk_column    = name
            entry.lookup_table = col.references_table
            entry.lookup_field = lookupField
          } else {
            entry.type = 'text' // no display column to embed — show raw value
          }
        }
        return entry
      })

      // Carry forward any extra config keys (editable, picker, order_field,
      // hide_when_empty, …) the layout may already have on this widget.
      const config = { ...cfg, table: targetTable, fk: fkColumn, columns }
      if (sortField) { config.sort_field = sortField; config.sort_dir = sortDir }
      else { delete config.sort_field; delete config.sort_dir }
      if (config.is_deleted_col === undefined) config.is_deleted_col = 'is_deleted'

      onApply({ title: title.trim(), config })
    } catch (e) {
      setError(e.message || String(e))
      setBusy(false)
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 700,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label={initial ? 'Edit related list' : 'Add related list'}
        style={{
          background: C.card,
          borderRadius: isMobile ? '12px 12px 0 0' : 10,
          width: isMobile ? '100%' : 640,
          maxWidth: '100%',
          maxHeight: isMobile ? '92vh' : '88vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>
              {initial ? 'Edit Related List' : 'Add Related List'}
            </div>
            <span style={{
              background: '#e8f3fb', color: '#1a5a8a',
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>related_list</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4 }}>
            Changes apply to the canvas — save the layout to make them live.
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <FormField label="Title" hint="Displayed as the card heading on the record page's Related tab." required>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
              placeholder="e.g. Related Buildings"
              style={inputStyle}
            />
          </FormField>

          <FormField label="Target Table" hint="Tables with a foreign key pointing at this object." required>
            <select
              value={targetTable}
              onChange={e => setTargetTable(e.target.value)}
              disabled={busy || loadingFKs}
              style={{ ...inputStyle, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
            >
              <option value="">— Select a table —</option>
              {targetTables.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {!loadingFKs && targetTables.length === 0 && (
              <div style={{ ...hintBoxStyle, marginTop: 6, marginBottom: 0 }}>
                No tables have foreign keys pointing at <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{objectName}</code>,
                so there is nothing a related list can show.
              </div>
            )}
          </FormField>

          {targetTable && (
            <FormField
              label="Foreign Key Column"
              hint={fkChoices.length > 1
                ? `${targetTable} has multiple foreign keys to ${objectName}. Pick which one this list joins on.`
                : 'The column on the target table that references this object.'}
              required
            >
              <select
                value={fkColumn}
                onChange={e => setFkColumn(e.target.value)}
                disabled={busy}
                style={{ ...inputStyle, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
              >
                <option value="">— Select FK —</option>
                {fkChoices.map(fk => (
                  <option key={fk.referencing_column} value={fk.referencing_column}>
                    {fk.referencing_column} → {objectName}.{fk.referenced_column}
                  </option>
                ))}
              </select>
            </FormField>
          )}

          {targetTable && (
            <FormField
              label="Columns to Display"
              hint={`${selectedCols.length} selected · click to toggle · shown in selection order`}
              required
            >
              <div style={{
                border: `1px solid ${C.borderDark || C.border}`,
                borderRadius: 6, overflow: 'hidden',
                maxHeight: 260, overflowY: 'auto',
                background: '#fafbfd',
              }}>
                {loadingTarget ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>Loading columns…</div>
                ) : selectableTargetColumns.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>
                    No selectable columns.
                  </div>
                ) : (
                  selectableTargetColumns.map(c => {
                    const checked = selectedCols.includes(c.column_name)
                    return (
                      <label
                        key={c.column_name}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 12px',
                          borderBottom: `1px solid ${C.border}`,
                          background: checked ? '#f0f9f5' : 'transparent',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleColumn(c.column_name)}
                          disabled={busy}
                        />
                        <span style={{
                          fontFamily: 'JetBrains Mono, monospace',
                          color: C.textPrimary,
                          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          flex: 1,
                        }}>
                          {c.column_name}
                        </span>
                        <span style={{
                          background: C.card, color: C.textSecondary, fontSize: 9.5, fontWeight: 600,
                          padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.04em',
                          border: `1px solid ${C.border}`, flexShrink: 0,
                        }}>
                          {relatedColumnType(c)}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </FormField>
          )}

          {targetTable && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 12 }}>
              <FormField label="Sort Field" hint="Optional — pick a column to sort by.">
                <select
                  value={sortField}
                  onChange={e => setSortField(e.target.value)}
                  disabled={busy}
                  style={{ ...inputStyle, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
                >
                  <option value="">— No sort —</option>
                  {targetColumns
                    .filter(c => !c.is_primary_key)
                    .map(c => (
                      <option key={c.column_name} value={c.column_name}>{c.column_name}</option>
                    ))}
                </select>
              </FormField>
              <FormField label="Direction">
                <select
                  value={sortDir}
                  onChange={e => setSortDir(e.target.value)}
                  disabled={busy || !sortField}
                  style={{ ...inputStyle, cursor: 'pointer' }}
                >
                  {SORT_DIRECTIONS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </FormField>
            </div>
          )}
        </div>

        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${C.border}`,
          background: '#fafbfd',
          display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            {selectedCols.length} column{selectedCols.length === 1 ? '' : 's'} selected.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} disabled={busy} style={buttonSecondaryStyle}>Cancel</button>
            <button onClick={apply} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? 'Applying…' : initial ? 'Apply Changes' : 'Add to Section'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 20px 12px' }}>
            <div style={dangerBoxStyle}>{error}</div>
          </div>
        )}
      </div>
    </div>
  )
}
