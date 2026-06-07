import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { addCustomField, upsertFieldMetadata, fetchFieldMetadata } from '../../data/adminService'
import { OBJECT_CATALOG } from './objectCatalog'

// ---------------------------------------------------------------------------
// FieldCreateEditModal — two modes:
//   mode='create' : add a brand-new field. Picks data type; for 'lookup' picks
//                   a target object. Calls admin_add_custom_field (real ALTER
//                   TABLE via whitelisted RPC) then records metadata.
//   mode='edit'   : edit metadata for an existing column (label, help text,
//                   description, example, financial tier, history flag). The
//                   column itself isn't altered. Calls admin_upsert_field_metadata.
// ---------------------------------------------------------------------------

const DATA_TYPES = [
  { id: 'text',      label: 'Text' },
  { id: 'number',    label: 'Number (decimal)' },
  { id: 'integer',   label: 'Number (whole)' },
  { id: 'date',      label: 'Date' },
  { id: 'timestamp', label: 'Date/Time' },
  { id: 'boolean',   label: 'Checkbox (true/false)' },
  { id: 'picklist',  label: 'Picklist' },
  { id: 'lookup',    label: 'Lookup (relationship)' },
]

const TIERS = [
  { id: 1, label: 'Tier 1 — Standard' },
  { id: 2, label: 'Tier 2 — Sensitive' },
  { id: 3, label: 'Tier 3 — Financial / Restricted' },
]

function labelToColumn(label) {
  return label.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 58)
}

export default function FieldCreateEditModal({ mode, object, objectLabel, column, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = mode === 'edit'

  const [label, setLabel] = useState('')
  const [colName, setColName] = useState('')
  const [colTouched, setColTouched] = useState(false)
  const [dataType, setDataType] = useState('text')
  const [fkTable, setFkTable] = useState('')
  const [helpText, setHelpText] = useState('')
  const [description, setDescription] = useState('')
  const [exampleValue, setExampleValue] = useState('')
  const [financialTier, setFinancialTier] = useState(1)
  const [trackHistory, setTrackHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(isEdit)

  // In edit mode, prefill from existing metadata (if any).
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    fetchFieldMetadata(object).then(map => {
      if (cancelled) return
      const m = map[column]
      if (m) {
        setLabel(m.label || column)
        setHelpText(m.helpText || '')
        setDescription(m.description || '')
        setExampleValue(m.exampleValue || '')
        setFinancialTier(m.financialTier || 1)
        setTrackHistory(!!m.trackHistory)
      } else {
        setLabel(column)
      }
      setLoadingMeta(false)
    }).catch(() => { if (!cancelled) { setLabel(column); setLoadingMeta(false) } })
    return () => { cancelled = true }
  }, [isEdit, object, column])

  // Auto-derive column name from label until the user edits it directly.
  useEffect(() => {
    if (isEdit || colTouched) return
    setColName(labelToColumn(label))
  }, [label, colTouched, isEdit])

  const lookupTargets = OBJECT_CATALOG
    .filter(o => o.table !== object)
    .map(o => ({ table: o.table, label: o.pluralLabel || o.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const colValid = isEdit || /^[a-z][a-z0-9_]{1,57}$/.test(colName)
  const canSave = label.trim() && (isEdit || colValid) && (dataType !== 'lookup' || fkTable)

  async function save() {
    setBusy(true)
    try {
      if (isEdit) {
        await upsertFieldMetadata({ object, column, label, helpText, description, exampleValue, financialTier, trackHistory })
        toast.success('Field details saved')
      } else {
        await addCustomField({ object, column: colName, label, dataType, helpText, description, exampleValue, financialTier, trackHistory, fkTable: dataType === 'lookup' ? fkTable : null })
        toast.success(`Field "${label}" created`)
      }
      onSaved && onSaved()
      onClose && onClose()
    } catch (e) {
      toast.error(`${isEdit ? 'Save' : 'Create'} failed: ${e.message || e}`)
    } finally { setBusy(false) }
  }

  const field = (lbl, node, hint) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>{lbl}</div>
      {node}
      {hint && <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 3 }}>{hint}</div>}
    </div>
  )
  const inputStyle = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, background: C.page, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 12, width: 560, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
            {isEdit ? `Edit Field — ${column}` : `New Field on ${objectLabel}`}
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: C.textMuted }}><Icon path="M6 18L18 6M6 6l12 12" size={16} color="currentColor" /></div>
        </div>

        <div style={{ padding: '18px 22px' }}>
          {loadingMeta ? (
            <div style={{ padding: 20, fontSize: 12.5, color: C.textMuted }}>Loading field details…</div>
          ) : (
          <>
            {field('Field Label', <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Annual Income" style={inputStyle} />, 'Shown to users on layouts and lists.')}

            {!isEdit && field('API / Column Name',
              <input value={colName} onChange={e => { setColName(e.target.value); setColTouched(true) }} placeholder="annual_income"
                style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', borderColor: colName && !colValid ? '#b03a2e' : C.border }} />,
              colName && !colValid ? 'Use lower snake_case: start with a letter, letters/digits/underscore, 2–58 chars.' : 'Database column name. Auto-filled from the label; edit if needed. Cannot be changed later.')}

            {!isEdit && field('Data Type',
              <select value={dataType} onChange={e => setDataType(e.target.value)} style={inputStyle}>
                {DATA_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>,
              dataType === 'picklist' ? 'After creating, add the picklist values on the field editor.' : (dataType === 'lookup' ? 'Creates a relationship to another object.' : null))}

            {!isEdit && dataType === 'lookup' && field('Related Object',
              <select value={fkTable} onChange={e => setFkTable(e.target.value)} style={inputStyle}>
                <option value="">Select an object…</option>
                {lookupTargets.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
              </select>)}

            {field('Help Text', <input value={helpText} onChange={e => setHelpText(e.target.value)} placeholder="Short guidance shown near the field" style={inputStyle} />)}
            {field('Description', <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Internal description of what this field captures" style={{ ...inputStyle, resize: 'vertical' }} />)}
            {field('Example Value', <input value={exampleValue} onChange={e => setExampleValue(e.target.value)} placeholder="e.g. 48000" style={inputStyle} />)}
            {field('Financial / Sensitivity Tier',
              <select value={financialTier} onChange={e => setFinancialTier(Number(e.target.value))} style={inputStyle}>
                {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>)}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer', marginTop: 4 }}>
              <input type="checkbox" checked={trackHistory} onChange={e => setTrackHistory(e.target.checked)} style={{ accentColor: C.emerald, width: 15, height: 15 }} />
              Track field history (record changes to this field over time)
            </label>
          </>
          )}
        </div>

        <div style={{ padding: '14px 22px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 12.5, cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={busy || !canSave}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: (busy || !canSave) ? '#cfe9da' : C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: (busy || !canSave) ? 'default' : 'pointer' }}>
            {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create Field')}
          </button>
        </div>
      </div>
    </div>
  )
}
