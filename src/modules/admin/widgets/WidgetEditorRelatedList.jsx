import { useState, useEffect, useMemo, useRef } from 'react'
import { C } from '../../../data/constants'
import { Icon } from '../../../components/UI'
import { useToast } from '../../../components/Toast'
import { useIsMobile } from '../../../lib/useMediaQuery'
import { describeObject, describeIncomingFKs } from '../../../data/adminService'
import { updateWidget } from '../../../data/pageLayoutBuilderService'
import { deriveEesFieldType, humanizeColumnName } from './eesFieldTypes'
import {
  FormField,
  inputStyle,
  buttonPrimaryStyle, buttonSecondaryStyle,
  dangerBoxStyle, hintBoxStyle,
} from '../adminStyles'

// ---------------------------------------------------------------------------
// WidgetEditorRelatedList — modal for editing a related_list widget.
//
// User flow:
//   1. Pick a target table from describeIncomingFKs (tables with a FK
//      pointing at the object this widget lives on).
//   2. Pick the specific FK column to join on (filtered to FKs from the
//      chosen target table).
//   3. Pick the target columns to display (from describeObject on the target).
//   4. Optional: sort field + direction, is_deleted column name, widget title.
//
// Writes widget_config = { table, fk, columns, sort_field, sort_dir,
// is_deleted_col } via updateWidget.
// ---------------------------------------------------------------------------

const SORT_DIRECTIONS = [
  { value: 'asc',  label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]

// Columns we hide from the target-columns picker — system plumbing.
const HIDDEN_TARGET_COLUMNS = new Set([
  'created_at', 'updated_at',
  'created_by', 'updated_by',
  'deletion_reason',
])

export default function WidgetEditorRelatedList({
  widget, objectName, onClose, onSaved,
}) {
  const toast = useToast()
  const isMobile = useIsMobile()

  const cfg = widget.widget_config || {}

  // Form state
  const [title, setTitle]         = useState(widget.widget_title || '')
  const [targetTable, setTargetTable] = useState(cfg.table || '')
  const [fkColumn, setFkColumn]   = useState(cfg.fk || '')
  const [selectedCols, setSelectedCols] = useState(
    Array.isArray(cfg.columns) ? cfg.columns : [],
  )
  const [sortField, setSortField] = useState(cfg.sort_field || '')
  const [sortDir, setSortDir]     = useState(cfg.sort_dir || 'asc')
  const [isDeletedCol, setIsDeletedCol] = useState(cfg.is_deleted_col ?? 'is_deleted')

  // Lookup data
  const [incomingFKs, setIncomingFKs] = useState([])
  const [loadingFKs, setLoadingFKs]   = useState(true)
  const [targetColumns, setTargetColumns] = useState([])
  const [loadingTarget, setLoadingTarget] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Load all FKs pointing at this object
  useEffect(() => {
    let cancelled = false
    setLoadingFKs(true)
    describeIncomingFKs(objectName)
      .then(fks => { if (!cancelled) setIncomingFKs(fks || []) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingFKs(false) })
    return () => { cancelled = true }
  }, [objectName])

  // When the target table changes, load its columns and reset downstream
  // selections that no longer make sense.
  useEffect(() => {
    if (!targetTable) {
      setTargetColumns([])
      return
    }
    let cancelled = false
    setLoadingTarget(true)
    describeObject(targetTable)
      .then(cols => { if (!cancelled) setTargetColumns(cols || []) })
      .catch(err => { if (!cancelled) setError(err.message || String(err)) })
      .finally(() => { if (!cancelled) setLoadingTarget(false) })
    return () => { cancelled = true }
  }, [targetTable])

  // ESC → cancel
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // Distinct target tables from incoming FKs
  const targetTables = useMemo(() => {
    const seen = new Map()
    for (const fk of incomingFKs) {
      if (!seen.has(fk.referencing_table)) seen.set(fk.referencing_table, [])
      seen.get(fk.referencing_table).push(fk)
    }
    return Array.from(seen.entries())
      .map(([table, fks]) => ({ table, fks }))
      .sort((a, b) => a.table.localeCompare(b.table))
  }, [incomingFKs])

  // FKs available for the currently selected target
  const fkChoices = useMemo(
    () => incomingFKs.filter(fk => fk.referencing_table === targetTable),
    [incomingFKs, targetTable],
  )

  // Auto-pick the FK if only one option
  useEffect(() => {
    if (targetTable && fkChoices.length === 1 && !fkColumn) {
      setFkColumn(fkChoices[0].referencing_column)
    }
    // If current fkColumn doesn't exist on the new target, clear it
    if (fkColumn && !fkChoices.some(fk => fk.referencing_column === fkColumn)) {
      setFkColumn('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetTable, fkChoices])

  // Selectable columns on the target table (filtering out system columns and
  // columns that definitely shouldn't be shown).
  const selectableTargetColumns = useMemo(() => {
    return targetColumns
      .filter(c => !HIDDEN_TARGET_COLUMNS.has(c.column_name) && !c.is_primary_key)
      .sort((a, b) => a.column_name.localeCompare(b.column_name))
  }, [targetColumns])

  function toggleColumn(name) {
    setSelectedCols(prev =>
      prev.includes(name)
        ? prev.filter(c => c !== name)
        : [...prev, name],
    )
  }

  // Columns available as sort fields — same pool as selectable target columns
  // plus created_at / updated_at (common sort keys).
  const sortableColumns = useMemo(() => {
    const commonSort = targetColumns
      .filter(c => ['created_at', 'updated_at'].includes(c.column_name))
    return [
      ...selectableTargetColumns,
      ...commonSort,
    ]
  }, [selectableTargetColumns, targetColumns])

  function validate() {
    if (!title.trim()) return 'Widget title is required'
    if (!targetTable) return 'Pick a target table'
    if (!fkColumn) return 'Pick the FK column that joins to this object'
    if (selectedCols.length === 0) return 'Pick at least one column to display'
    return null
  }

  async function save() {
    const err = validate()
    if (err) { setError(err); return }
    setBusy(true)
    setError(null)
    try {
      const config = {
        table: targetTable,
        fk: fkColumn,
        columns: selectedCols,
      }
      if (sortField)  config.sort_field = sortField
      if (sortField)  config.sort_dir = sortDir
      if (isDeletedCol && isDeletedCol.trim()) config.is_deleted_col = isDeletedCol.trim()
      await updateWidget(widget.id, {
        title: title.trim(),
        config,
      })
      toast.success('Widget saved')
      onSaved()
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
        role="dialog" aria-modal="true" aria-label="Edit related list"
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
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Edit Related List</div>
            <span style={{
              background: '#e8f3fb', color: '#1a5a8a',
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 3,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}>related_list</span>
            <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
              {widget.page_layout_widget_record_number}
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <FormField label="Widget Title" required>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
              placeholder="Related Buildings"
              style={inputStyle}
            />
          </FormField>

          <FormField label="Target Table" hint="Tables with a foreign key pointing at this object." required>
            <select
              value={targetTable}
              onChange={e => setTargetTable(e.target.value)}
              disabled={busy || loadingFKs}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">— Select a table —</option>
              {targetTables.map(t => (
                <option key={t.table} value={t.table}>{t.table}</option>
              ))}
            </select>
            {!loadingFKs && targetTables.length === 0 && (
              <div style={{ ...hintBoxStyle, marginTop: 6, marginBottom: 0 }}>
                No tables have foreign keys pointing at <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{objectName}</code>,
                so there's nothing a related list can show. Add a FK on another table first.
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
              hint={`${selectedCols.length} selected · click to toggle`}
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
                          {deriveEesFieldType(c)}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </FormField>
          )}

          {/* Sort */}
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
                  {sortableColumns.map(c => (
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

          {targetTable && (
            <FormField
              label="Soft-delete Column"
              hint="Column on the target to filter out deleted rows. Leave blank if the target has no soft-delete."
            >
              <input
                value={isDeletedCol}
                onChange={e => setIsDeletedCol(e.target.value)}
                disabled={busy}
                placeholder="is_deleted"
                style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5 }}
              />
            </FormField>
          )}
        </div>

        {/* Footer */}
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
            <button onClick={save} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? 'Saving…' : 'Save Widget'}
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
