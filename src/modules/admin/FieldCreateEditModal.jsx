import { useState, useEffect, lazy, Suspense } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  addCustomField, updateFieldDefinition, fetchFieldMetadata,
  describeObject, describeIncomingFKs, upsertInheritedField,
} from '../../data/adminService'
import { validateFormula } from '../../lib/formula/engine'
import { OBJECT_CATALOG } from './objectCatalog'
import { backdropDismissProps } from '../../lib/modalDismiss'

const FormulaEditor = lazy(() => import('../../lib/formula/FormulaEditor'))

// ---------------------------------------------------------------------------
// FieldCreateEditModal — Salesforce-parity field editor.
//   mode='create' : add a brand-new field. Picks a type; a real column is
//                   created via admin_add_custom_field (whitelisted ALTER
//                   TABLE), then its logical definition is recorded.
//   mode='edit'   : change an EXISTING field's type / formula / rollup, plus
//                   its label/help/tier/history. The physical column is never
//                   altered — type is metadata over storage (Salesforce model),
//                   and formula/rollup fields are computed at read.
//
// Field types are a logical layer over the physical Postgres column:
//   • display types (currency, percent, email, phone, url, textarea, …) just
//     change how the value renders/validates — no column change.
//   • formula     — read-only, evaluated by the shared formula engine over the
//                   record's own fields plus cross-object (related) references.
//   • rollup      — read-only aggregate (COUNT/SUM/AVG/MIN/MAX) of child records.
// ---------------------------------------------------------------------------

// Type options grouped for the picker. Each carries the logical `kind` and the
// stored `display` type. `physical` is the Postgres type used when CREATING a
// backing column (create mode only); edit mode never retypes the column.
const TYPE_OPTIONS = [
  { group: 'Basic', items: [
    { id: 'text',      label: 'Text',            kind: 'standard', display: 'text',     physical: 'text' },
    { id: 'textarea',  label: 'Text Area (long)',kind: 'standard', display: 'textarea', physical: 'text' },
    { id: 'number',    label: 'Number',          kind: 'standard', display: 'number',   physical: 'number' },
    { id: 'currency',  label: 'Currency',        kind: 'standard', display: 'currency', physical: 'number' },
    { id: 'percent',   label: 'Percent',         kind: 'standard', display: 'percent',  physical: 'number' },
    { id: 'integer',   label: 'Number (whole)',  kind: 'standard', display: 'integer',  physical: 'integer' },
    { id: 'boolean',   label: 'Checkbox',        kind: 'standard', display: 'boolean',  physical: 'boolean' },
    { id: 'date',      label: 'Date',            kind: 'standard', display: 'date',      physical: 'date' },
    { id: 'datetime',  label: 'Date/Time',       kind: 'standard', display: 'datetime',  physical: 'timestamp' },
    { id: 'email',     label: 'Email',           kind: 'standard', display: 'email',     physical: 'text' },
    { id: 'phone',     label: 'Phone',           kind: 'standard', display: 'phone',     physical: 'text' },
    { id: 'url',       label: 'URL',             kind: 'standard', display: 'url',       physical: 'text' },
  ] },
  { group: 'Relationship', items: [
    { id: 'picklist',  label: 'Picklist',        kind: 'standard', display: 'picklist', physical: 'picklist' },
    { id: 'lookup',    label: 'Lookup (relationship)', kind: 'standard', display: 'lookup', physical: 'lookup' },
    { id: 'inherited', label: 'Inherited Field (from parent)', kind: 'inherited', display: 'text', physical: null },
  ] },
  { group: 'Advanced', items: [
    { id: 'formula',   label: 'Formula (calculated)',   kind: 'formula', display: 'formula', physical: 'text' },
    { id: 'rollup',    label: 'Roll-Up Summary',        kind: 'rollup',  display: 'rollup',  physical: 'number' },
  ] },
]
const TYPE_BY_ID = Object.fromEntries(TYPE_OPTIONS.flatMap(g => g.items.map(i => [i.id, i])))

const RETURN_TYPES = [
  { id: 'text',     label: 'Text' },
  { id: 'number',   label: 'Number' },
  { id: 'currency', label: 'Currency' },
  { id: 'percent',  label: 'Percent' },
  { id: 'date',     label: 'Date' },
  { id: 'datetime', label: 'Date/Time' },
  { id: 'boolean',  label: 'Checkbox' },
]

const ROLLUP_FUNCTIONS = [
  { id: 'COUNT', label: 'Count of records' },
  { id: 'SUM',   label: 'Sum of a field' },
  { id: 'AVG',   label: 'Average of a field' },
  { id: 'MIN',   label: 'Minimum of a field' },
  { id: 'MAX',   label: 'Maximum of a field' },
]

const TIERS = [
  { id: 1, label: 'Tier 1 — Standard' },
  { id: 2, label: 'Tier 2 — Sensitive' },
  { id: 3, label: 'Tier 3 — Financial / Restricted' },
]

// Columns a user should never reference / aggregate / see in a picker.
const HIDDEN_COL_RE = /^(id)$|(_record_number|_created_at|_created_by|_updated_at|_updated_by|_deleted_at|_deleted_by|_is_deleted|_deletion_reason)$/
const NUMERIC_DTS = new Set(['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision'])

function labelToColumn(label) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 58)
}
function humanize(name) {
  return (name || '').split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}
function safeAlias(s) {
  let a = String(s || '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1')
  if (!/^[A-Za-z_]/.test(a)) a = '_' + a
  return a.slice(0, 60)
}
// Logical editor type for a column (mirror of the DB overlay) — labels the
// formula reference pickers.
function colType(c) {
  if (c.field_kind === 'formula') return 'formula'
  if (c.field_kind === 'rollup') return 'rollup'
  if (c.field_kind === 'inherited') return 'inherited'
  if (c.display_type) return c.display_type
  if (c.is_foreign_key && c.references_table === 'picklist_values') return 'picklist'
  if (c.is_foreign_key) return 'lookup'
  if (c.data_type === 'boolean') return 'boolean'
  if (NUMERIC_DTS.has(c.data_type)) return 'number'
  if (c.data_type === 'date') return 'date'
  if ((c.data_type || '').startsWith('timestamp')) return 'datetime'
  return 'text'
}

export default function FieldCreateEditModal({ mode, object, objectLabel, column, onClose, onSaved }) {
  const toast = useToast()
  const isEdit = mode === 'edit'

  // Presentation metadata
  const [label, setLabel] = useState('')
  const [colName, setColName] = useState('')
  const [colTouched, setColTouched] = useState(false)
  const [typeId, setTypeId] = useState('text')
  const [fkTable, setFkTable] = useState('')
  const [helpText, setHelpText] = useState('')
  const [description, setDescription] = useState('')
  const [exampleValue, setExampleValue] = useState('')
  const [financialTier, setFinancialTier] = useState(1)
  const [trackHistory, setTrackHistory] = useState(false)

  // Formula config
  const [formulaExpr, setFormulaExpr] = useState('')
  const [formulaReturn, setFormulaReturn] = useState('text')
  const [refs, setRefs] = useState([])   // [{alias, kind, column, fk_column?, table?, column_type?}]
  const [relFk, setRelFk] = useState('') // selected outgoing FK column for the related picker
  const [relParentCols, setRelParentCols] = useState({}) // fkColumn -> parent column list

  // Rollup config
  const [rollupChildKey, setRollupChildKey] = useState('') // `${table}|${fk}`
  const [rollupFn, setRollupFn] = useState('COUNT')
  const [rollupField, setRollupField] = useState('')
  const [rollupReturn, setRollupReturn] = useState('number')
  const [rollupChildCols, setRollupChildCols] = useState({}) // table -> column list

  // Inherited-field config: a chain of hops (self → … → base) + the source column
  // on the base table. inheritCols caches each table's column list for the pickers.
  const [inheritHops, setInheritHops] = useState([]) // [{fk, table}]
  const [inheritSource, setInheritSource] = useState('')      // column on base table
  const [inheritDisplay, setInheritDisplay] = useState('text')
  const [inheritSourceType, setInheritSourceType] = useState('text') // physical data_type of source
  const [inheritCols, setInheritCols] = useState({}) // table -> full column list

  // Schema context
  const [ownCols, setOwnCols] = useState([])         // this object's columns
  const [incomingFks, setIncomingFks] = useState([]) // child tables (for rollup)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const selType = TYPE_BY_ID[typeId] || TYPE_BY_ID.text
  const isFormula = selType.kind === 'formula'
  const isRollup = selType.kind === 'rollup'
  const isInherited = selType.kind === 'inherited'
  // The "tip" of the inherited chain: the table whose fields/FKs the pickers show.
  // Starts at this object; each hop advances it to the FK's target table.
  const inheritTipTable = inheritHops.length ? inheritHops[inheritHops.length - 1].table : object

  // Load schema + (edit) existing definition on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cols, meta, inc] = await Promise.all([
          describeObject(object),
          isEdit ? fetchFieldMetadata(object) : Promise.resolve({}),
          describeIncomingFKs(object).catch(() => []),
        ])
        if (cancelled) return
        setOwnCols(cols || [])
        setIncomingFks(inc || [])
        if (isEdit) {
          const cur = (cols || []).find(c => c.column_name === column)
          const m = meta[column]
          setLabel(m?.label || cur?.field_label || column)
          setHelpText(m?.helpText || '')
          setDescription(m?.description || '')
          setExampleValue(m?.exampleValue || '')
          setFinancialTier(m?.financialTier || 1)
          setTrackHistory(!!m?.trackHistory)
          // Resolve the current type id from the metadata/overlay.
          const t = cur ? colType(cur) : 'text'
          setTypeId(TYPE_BY_ID[t] ? t : 'text')
          if (m?.fieldKind === 'formula') {
            setFormulaExpr(m.formulaExpression || '')
            setFormulaReturn(m.formulaReturnType || 'text')
            setRefs(Array.isArray(m.formulaRefs) ? m.formulaRefs : [])
          }
          if (m?.fieldKind === 'rollup' && m.rollupConfig) {
            const rc = m.rollupConfig
            setRollupChildKey(`${rc.child_table}|${rc.child_fk}`)
            setRollupFn((rc.function || 'COUNT').toUpperCase())
            setRollupField(rc.field || '')
            setRollupReturn(rc.return_type || 'number')
          }
          if (m?.fieldKind === 'inherited' && m.inheritConfig) {
            const ic = m.inheritConfig
            setInheritHops(Array.isArray(ic.hops) ? ic.hops : [])
            setInheritSource(ic.source_column || '')
            setInheritDisplay(ic.display_type || 'text')
            setInheritSourceType(ic.source_data_type || 'text')
          }
        }
      } catch (e) {
        if (!cancelled) toast.error(`Could not load field details: ${e.message || e}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, object, column])

  // Auto-derive column name from label (create mode only).
  useEffect(() => {
    if (isEdit || colTouched) return
    setColName(labelToColumn(label))
  }, [label, colTouched, isEdit])

  // Outgoing FKs on this object (for cross-object formula references). Exclude
  // audit FKs to users.
  const outgoingFks = ownCols.filter(c =>
    c.is_foreign_key && c.references_table && c.references_table !== 'picklist_values'
    && !/(_created_by|_updated_by|_deleted_by|_owner)$/.test(c.column_name))

  // Same-object columns selectable in a formula.
  const selectableOwnCols = ownCols.filter(c => !HIDDEN_COL_RE.test(c.column_name) && c.column_name !== column)

  const lookupTargets = OBJECT_CATALOG
    .filter(o => o.table !== object)
    .map(o => ({ table: o.table, label: o.pluralLabel || o.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  // Lazily fetch a parent table's columns when a related FK is chosen.
  useEffect(() => {
    if (!isFormula || !relFk) return
    const fk = outgoingFks.find(c => c.column_name === relFk)
    if (!fk || relParentCols[relFk]) return
    describeObject(fk.references_table).then(cols => {
      setRelParentCols(prev => ({ ...prev, [relFk]: (cols || []).filter(c => !HIDDEN_COL_RE.test(c.column_name)) }))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relFk, isFormula])

  // Lazily fetch a rollup child table's columns when chosen.
  const rollupChild = rollupChildKey ? { table: rollupChildKey.split('|')[0], fk: rollupChildKey.split('|')[1] } : null
  useEffect(() => {
    if (!isRollup || !rollupChild?.table || rollupChildCols[rollupChild.table]) return
    describeObject(rollupChild.table).then(cols => {
      setRollupChildCols(prev => ({ ...prev, [rollupChild.table]: (cols || []).filter(c => NUMERIC_DTS.has(c.data_type) && !HIDDEN_COL_RE.test(c.column_name)) }))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollupChildKey, isRollup])

  // Lazily fetch the inherited tip table's columns for the FK / source pickers.
  useEffect(() => {
    if (!isInherited || inheritCols[inheritTipTable]) return
    describeObject(inheritTipTable).then(cols => {
      setInheritCols(prev => ({ ...prev, [inheritTipTable]: cols || [] }))
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInherited, inheritTipTable])

  const tipCols = inheritCols[inheritTipTable] || []
  // Outgoing FKs on the tip table (to add another hop), audit FKs excluded.
  const tipFks = tipCols.filter(c =>
    c.is_foreign_key && c.references_table && c.references_table !== 'picklist_values'
    && !/(_created_by|_updated_by|_deleted_by|_owner)$/.test(c.column_name))
  // Scalar columns on the tip table that can be shown (v1: no picklist/lookup/uuid).
  const tipSourceCols = tipCols.filter(c =>
    !HIDDEN_COL_RE.test(c.column_name) && !c.is_foreign_key
    && c.data_type !== 'uuid' && c.field_kind !== 'inherited'
    && c.field_kind !== 'formula' && c.field_kind !== 'rollup')

  // Physical data type → a scalar display type for an inherited source column.
  function displayForColumn(c) {
    if (c.display_type && ['text','textarea','number','integer','currency','percent','date','datetime','boolean','email','phone','url'].includes(c.display_type)) return c.display_type
    if (c.data_type === 'boolean') return 'boolean'
    if (c.data_type === 'date') return 'date'
    if ((c.data_type || '').startsWith('timestamp')) return 'datetime'
    if (NUMERIC_DTS.has(c.data_type)) return 'number'
    if (/_email$/.test(c.column_name)) return 'email'
    if (/_phone$/.test(c.column_name)) return 'phone'
    return 'text'
  }
  function addInheritHop(fkCol) {
    const c = tipFks.find(x => x.column_name === fkCol)
    if (!c) return
    setInheritHops(prev => [...prev, { fk: c.column_name, table: c.references_table }])
    setInheritSource(''); setInheritDisplay('text'); setInheritSourceType('text')
  }
  function removeLastHop() {
    setInheritHops(prev => prev.slice(0, -1))
    setInheritSource(''); setInheritDisplay('text'); setInheritSourceType('text')
  }
  function pickInheritSource(colName) {
    const c = tipSourceCols.find(x => x.column_name === colName)
    if (!c) return
    setInheritSource(c.column_name)
    setInheritDisplay(displayForColumn(c))
    setInheritSourceType(c.data_type || 'text')
  }

  const aliasList = refs.map(r => r.alias)

  function addExpr(token) {
    setFormulaExpr(prev => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + token)
  }
  function addOwnRef(col) {
    if (!col) return
    const alias = safeAlias(col.column_name)
    setRefs(prev => prev.some(r => r.alias === alias) ? prev : [...prev, { alias, kind: 'field', column: col.column_name, column_type: colType(col) }])
    addExpr(alias)
  }
  function addRelatedRef(col) {
    if (!relFk || !col) return
    const fk = outgoingFks.find(c => c.column_name === relFk)
    let alias = safeAlias(`${relFk}_${col.column_name}`)
    let n = 2
    while (refs.some(r => r.alias === alias && !(r.kind === 'related' && r.fk_column === relFk && r.column === col.column_name))) { alias = safeAlias(`${relFk}_${col.column_name}_${n++}`) }
    const ref = {
      alias, kind: 'related', fk_column: relFk, table: fk.references_table,
      column: col.column_name, column_type: colType(col),
    }
    setRefs(prev => prev.some(r => r.alias === alias) ? prev : [...prev, ref])
    addExpr(alias)
  }
  function removeRef(alias) { setRefs(prev => prev.filter(r => r.alias !== alias)) }

  // Validation
  const colValid = isEdit || /^[a-z][a-z0-9_]{1,57}$/.test(colName)
  let canSave = label.trim() && (isEdit || colValid)
  if (!isEdit && selType.display === 'lookup' && !fkTable) canSave = false
  if (isFormula && !formulaExpr.trim()) canSave = false
  if (isRollup) {
    if (!rollupChild) canSave = false
    if (rollupFn !== 'COUNT' && !rollupField) canSave = false
  }
  if (isInherited && (inheritHops.length === 0 || !inheritSource)) canSave = false

  async function save() {
    // Formula syntax gate before hitting the server.
    if (isFormula) {
      const v = validateFormula(formulaExpr, aliasList)
      if (!v.ok) { toast.error(`Formula error: ${v.error}`); return }
    }
    setBusy(true)
    try {
      // Inherited fields have NO physical column — the whole definition lives in
      // field_metadata and resolves at read. Separate save path (no addCustomField).
      if (isInherited) {
        const col = isEdit ? column : colName
        await upsertInheritedField({
          object, column: col, label,
          config: {
            hops: inheritHops.map(h => ({ fk: h.fk, table: h.table })),
            source_column: inheritSource,
            source_data_type: inheritSourceType,
            display_type: inheritDisplay,
          },
          displayType: inheritDisplay,
          helpText, financialTier,
        })
        toast.success(isEdit ? 'Field saved' : `Inherited field "${label}" created`)
        onSaved && onSaved()
        onClose && onClose()
        setBusy(false)
        return
      }
      let col = column
      if (!isEdit) {
        col = colName
        // Create the backing column with a safe physical type first.
        await addCustomField({
          object, column: col, label,
          dataType: selType.physical === 'text' && isFormula ? physicalForReturn(formulaReturn) : selType.physical,
          helpText, description, exampleValue, financialTier, trackHistory,
          fkTable: selType.display === 'lookup' ? fkTable : null,
        })
      }
      // Record the logical definition (type / formula / rollup).
      const params = {
        object, column: col, label, helpText, description, exampleValue,
        financialTier, trackHistory,
        displayType: selType.display,
        fieldKind: selType.kind,
      }
      if (isFormula) {
        params.formulaExpression = formulaExpr
        params.formulaReturnType = formulaReturn
        params.formulaRefs = refs
      }
      if (isRollup) {
        params.rollupConfig = {
          child_table: rollupChild.table, child_fk: rollupChild.fk,
          function: rollupFn, field: rollupFn === 'COUNT' ? null : rollupField,
          return_type: rollupFn === 'COUNT' ? 'number' : rollupReturn,
        }
      }
      await updateFieldDefinition(params)
      toast.success(isEdit ? 'Field saved' : `Field "${label}" created`)
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
    <div {...backdropDismissProps(onClose)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px', overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: 12, width: 600, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ padding: '16px 22px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>
            {isEdit ? `Edit Field — ${column}` : `New Field on ${objectLabel}`}
          </div>
          <div onClick={onClose} style={{ cursor: 'pointer', color: C.textMuted }}><Icon path="M6 18L18 6M6 6l12 12" size={16} color="currentColor" /></div>
        </div>

        <div style={{ padding: '18px 22px' }}>
          {loading ? (
            <div style={{ padding: 20, fontSize: 12.5, color: C.textMuted }}>Loading field details…</div>
          ) : (
          <>
            {field('Field Label', <input autoFocus value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. IRA Income Code" style={inputStyle} />, 'Shown to users on layouts and lists.')}

            {!isEdit && field('API / Column Name',
              <input value={colName} onChange={e => { setColName(e.target.value); setColTouched(true) }} placeholder="ira_income_code"
                style={{ ...inputStyle, fontFamily: 'JetBrains Mono, monospace', borderColor: colName && !colValid ? '#1a5a8a' : C.border }} />,
              colName && !colValid ? 'Use lower snake_case: start with a letter, letters/digits/underscore, 2–58 chars.' : 'Database column name. Auto-filled from the label; cannot be changed later.')}

            {field('Field Type',
              <select value={typeId} onChange={e => setTypeId(e.target.value)} style={inputStyle}>
                {TYPE_OPTIONS.map(g => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>,
              isEdit
                ? 'Type is metadata over storage — changing it re-renders the field without altering the column or its data.'
                : (selType.display === 'picklist' ? 'After creating, add the picklist values on the field editor.' : (selType.display === 'lookup' ? 'Creates a relationship to another object.' : null)))}

            {!isEdit && selType.display === 'lookup' && field('Related Object',
              <select value={fkTable} onChange={e => setFkTable(e.target.value)} style={inputStyle}>
                <option value="">Select an object…</option>
                {lookupTargets.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
              </select>)}

            {/* ── Formula configuration ── */}
            {isFormula && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14, background: C.cardSecondary }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>Formula</div>
                {field('Return Type',
                  <select value={formulaReturn} onChange={e => setFormulaReturn(e.target.value)} style={{ ...inputStyle, background: C.card }}>
                    {RETURN_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>)}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <select value="" onChange={e => { const c = selectableOwnCols.find(x => x.column_name === e.target.value); if (c) addOwnRef(c); e.target.value = '' }}
                    style={{ ...inputStyle, background: C.card, flex: 1, minWidth: 180 }}>
                    <option value="">Insert this object's field…</option>
                    {selectableOwnCols.map(c => <option key={c.column_name} value={c.column_name}>{c.field_label || humanize(c.column_name)}</option>)}
                  </select>
                </div>

                {outgoingFks.length > 0 && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    <select value={relFk} onChange={e => setRelFk(e.target.value)} style={{ ...inputStyle, background: C.card, flex: 1, minWidth: 150 }}>
                      <option value="">Related object (via lookup)…</option>
                      {outgoingFks.map(c => <option key={c.column_name} value={c.column_name}>{humanize(c.references_table)} · via {humanize(c.column_name)}</option>)}
                    </select>
                    <select value="" disabled={!relFk || !relParentCols[relFk]} onChange={e => { const c = (relParentCols[relFk] || []).find(x => x.column_name === e.target.value); if (c) addRelatedRef(c); e.target.value = '' }}
                      style={{ ...inputStyle, background: C.card, flex: 1, minWidth: 150 }}>
                      <option value="">{relFk && !relParentCols[relFk] ? 'Loading…' : 'Insert related field…'}</option>
                      {(relParentCols[relFk] || []).map(c => <option key={c.column_name} value={c.column_name}>{c.field_label || humanize(c.column_name)}</option>)}
                    </select>
                  </div>
                )}

                <Suspense fallback={<div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>Loading formula editor…</div>}>
                  <FormulaEditor value={formulaExpr} onChange={setFormulaExpr} fields={aliasList}
                    placeholder='e.g. property_ira_income_qualification_number  (or IF(amount > 1000, "High", "Std"))' />
                </Suspense>

                {refs.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: C.textSecondary, marginBottom: 5 }}>Referenced fields</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {refs.map(r => (
                        <span key={r.alias} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace', background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 6px', color: C.textPrimary }}>
                          {r.alias}
                          <span style={{ color: C.textMuted }}>{r.kind === 'related' ? `→ ${humanize(r.table)}.${r.column}` : ''}</span>
                          <span onClick={() => removeRef(r.alias)} style={{ cursor: 'pointer', color: C.textMuted, fontWeight: 700 }}>×</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Rollup configuration ── */}
            {isRollup && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14, background: C.cardSecondary }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>Roll-Up Summary</div>
                {field('Child Records',
                  <select value={rollupChildKey} onChange={e => { setRollupChildKey(e.target.value); setRollupField('') }} style={{ ...inputStyle, background: C.card }}>
                    <option value="">Select the related child object…</option>
                    {incomingFks.map(fk => (
                      <option key={`${fk.referencing_table}|${fk.referencing_column}`} value={`${fk.referencing_table}|${fk.referencing_column}`}>
                        {humanize(fk.referencing_table)} · via {humanize(fk.referencing_column)}
                      </option>
                    ))}
                  </select>,
                  'Aggregates records from another object that point back at this one.')}
                {field('Calculation',
                  <select value={rollupFn} onChange={e => setRollupFn(e.target.value)} style={{ ...inputStyle, background: C.card }}>
                    {ROLLUP_FUNCTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select>)}
                {rollupFn !== 'COUNT' && field('Field to Aggregate',
                  <select value={rollupField} onChange={e => setRollupField(e.target.value)} style={{ ...inputStyle, background: C.card }} disabled={!rollupChild || !rollupChildCols[rollupChild.table]}>
                    <option value="">{rollupChild && !rollupChildCols[rollupChild.table] ? 'Loading…' : 'Select a numeric field…'}</option>
                    {(rollupChild ? rollupChildCols[rollupChild.table] || [] : []).map(c => <option key={c.column_name} value={c.column_name}>{c.field_label || humanize(c.column_name)}</option>)}
                  </select>,
                  'Only numeric fields can be summed, averaged, or min/maxed.')}
                {rollupFn !== 'COUNT' && field('Display As',
                  <select value={rollupReturn} onChange={e => setRollupReturn(e.target.value)} style={{ ...inputStyle, background: C.card }}>
                    {RETURN_TYPES.filter(t => ['number', 'currency', 'percent'].includes(t.id)).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>)}
              </div>
            )}

            {/* ── Inherited-field configuration ── */}
            {isInherited && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 14, background: C.cardSecondary }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.textPrimary, marginBottom: 4 }}>Inherit from a parent record</div>
                <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 10 }}>
                  Follow a relationship up to a base record and show one of its fields — read-only, never re-entered here. Edit the value on the base record.
                </div>

                {/* Current chain */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 11 }}>
                  <span style={{ fontWeight: 600, color: C.textSecondary }}>{humanize(object)}</span>
                  {inheritHops.map((h, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: C.textMuted }}>→</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 6px', color: C.textPrimary }}>
                        {humanize(h.table)} <span style={{ color: C.textMuted }}>· via {humanize(h.fk)}</span>
                      </span>
                    </span>
                  ))}
                  {inheritHops.length > 0 && (
                    <span onClick={removeLastHop} title="Remove last hop"
                      style={{ cursor: 'pointer', color: C.textMuted, fontWeight: 700, marginLeft: 2 }}>×</span>
                  )}
                </div>

                {field(inheritHops.length ? `Go deeper from ${humanize(inheritTipTable)} (optional)` : 'Relationship to follow',
                  <select value="" disabled={!inheritCols[inheritTipTable]} onChange={e => { addInheritHop(e.target.value); e.target.value = '' }} style={{ ...inputStyle, background: C.card }}>
                    <option value="">{!inheritCols[inheritTipTable] ? 'Loading…' : (tipFks.length ? 'Add a relationship hop…' : 'No relationships available')}</option>
                    {tipFks.map(c => <option key={c.column_name} value={c.column_name}>{humanize(c.references_table)} · via {humanize(c.column_name)}</option>)}
                  </select>,
                  inheritHops.length ? 'Add another hop to reach a further-up base record (e.g. Property → Account).' : 'Pick the parent this field inherits through.')}

                {inheritHops.length > 0 && field(`Field to show from ${humanize(inheritTipTable)}`,
                  <select value={inheritSource} disabled={!inheritCols[inheritTipTable]} onChange={e => pickInheritSource(e.target.value)} style={{ ...inputStyle, background: C.card }}>
                    <option value="">{!inheritCols[inheritTipTable] ? 'Loading…' : 'Select the field to inherit…'}</option>
                    {tipSourceCols.map(c => <option key={c.column_name} value={c.column_name}>{c.field_label || humanize(c.column_name)}</option>)}
                  </select>,
                  'The base record\'s field whose value shows here (scalar fields only for now).')}

                {inheritSource && field('Display As',
                  <select value={inheritDisplay} onChange={e => setInheritDisplay(e.target.value)} style={{ ...inputStyle, background: C.card }}>
                    {['text','textarea','number','integer','currency','percent','date','datetime','boolean','email','phone','url'].map(d => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>)}
              </div>
            )}

            {field('Help Text', <input value={helpText} onChange={e => setHelpText(e.target.value)} placeholder="Short guidance shown near the field" style={inputStyle} />)}
            {field('Description', <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Internal description of what this field captures" style={{ ...inputStyle, resize: 'vertical' }} />)}
            {!isFormula && !isRollup && !isInherited && field('Example Value', <input value={exampleValue} onChange={e => setExampleValue(e.target.value)} placeholder="e.g. 48000" style={inputStyle} />)}
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
          <button onClick={save} disabled={busy || !canSave || loading}
            style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: (busy || !canSave || loading) ? '#cfe9da' : C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: (busy || !canSave || loading) ? 'default' : 'pointer' }}>
            {busy ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create Field')}
          </button>
        </div>
      </div>
    </div>
  )
}

// Physical Postgres type to back a formula field of a given return type (create
// mode only). The stored column stays null — the value is computed at read —
// but a matching type keeps things clean if a value is ever persisted.
function physicalForReturn(returnType) {
  switch (returnType) {
    case 'number': case 'currency': case 'percent': return 'number'
    case 'date': return 'date'
    case 'datetime': return 'timestamp'
    case 'boolean': return 'boolean'
    default: return 'text'
  }
}
