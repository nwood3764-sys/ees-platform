import { useState, useEffect, useMemo } from 'react'
import { C } from '../../data/constants'
import { Icon, SectionTabs } from '../../components/UI'
import {
  describeObject, describeIncomingFKs,
  fetchPageLayoutsFor,
  fetchValidationsFor, fetchAutomationsFor,
  fetchPicklistsFor,
  fetchFieldMetadata,
} from '../../data/adminService'
import RecordTypesPane from './RecordTypesPane'
import LayoutsPane from './LayoutsPane'
import LayoutEditor from './LayoutEditor'
import FieldPicklistEditor from './FieldPicklistEditor'
import FieldCreateEditModal from './FieldCreateEditModal'

// ---------------------------------------------------------------------------
// Object Detail — per-object configuration page.
// Sub-tabs: Details, Fields & Relationships, Page Layouts, Record Types,
// Validation Rules, Automation Rules, Related Lookups (incoming FKs).
// ---------------------------------------------------------------------------

const SUB_TABS = [
  { id: 'details',     label: 'Details' },
  { id: 'fields',      label: 'Fields & Relationships' },
  { id: 'layouts',     label: 'Page Layouts' },
  { id: 'recordtypes', label: 'Record Types' },
  { id: 'validations', label: 'Validation Rules' },
  { id: 'automations', label: 'Automation Rules' },
  { id: 'related',     label: 'Related Lookups' },
]

export default function ObjectDetail({ obj, onBack, initialSubTab = 'details', initialLayoutId = null }) {
  const [sub, setSub] = useState(initialSubTab)
  const [selectedField, setSelectedField] = useState(null)
  const [columns, setColumns] = useState([])
  const [incomingFKs, setIncomingFKs] = useState([])
  const [pageLayouts, setPageLayouts] = useState([])
  const [validations, setValidations] = useState([])
  const [automations, setAutomations] = useState([])
  const [picklists,   setPicklists]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [selectedLayoutId, setSelectedLayoutId] = useState(initialLayoutId)
  // Live counts — updated by the relevant pane when it creates/deletes items,
  // so the tab badge stays in sync without a full parent refetch. Null until
  // the pane reports.
  const [recordTypesCount, setRecordTypesCount] = useState(null)
  const [layoutsCount, setLayoutsCount] = useState(null)
  // Field create/edit modal: { mode:'create'|'edit', column? } | null
  const [fieldModal, setFieldModal] = useState(null)
  const [fieldMeta, setFieldMeta] = useState({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSub(initialLayoutId ? 'layouts' : (initialSubTab || 'details'))
    setSelectedLayoutId(initialLayoutId || null)
    setRecordTypesCount(null)
    setLayoutsCount(null)

    Promise.all([
      describeObject(obj.table),
      describeIncomingFKs(obj.table),
      fetchPageLayoutsFor(obj.table).catch(() => []),
      fetchValidationsFor(obj.table).catch(() => []),
      fetchAutomationsFor(obj.table).catch(() => []),
      fetchPicklistsFor(obj.table).catch(() => []),
      fetchFieldMetadata(obj.table).catch(() => ({})),
    ])
      .then(([cols, fks, layouts, vals, autos, pls, meta]) => {
        if (cancelled) return
        setColumns(cols)
        setIncomingFKs(fks)
        setPageLayouts(layouts)
        setValidations(vals)
        setAutomations(autos)
        setPicklists(pls)
        setFieldMeta(meta)
      })
      .catch(err => { if (!cancelled) setError(err) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [obj.table, initialSubTab, initialLayoutId, refreshKey])

  // Count badges for tabs.
  const counts = {
    fields:      columns.length,
    layouts:     layoutsCount ?? pageLayouts.length,
    recordtypes: recordTypesCount ?? picklists.filter(p => p.field === 'record_type').length,
    validations: validations.length,
    automations: automations.length,
    related:     incomingFKs.length,
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sticky header — object name, back link, metadata */}
      <div style={{
        padding: '14px 24px 12px',
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div
          onClick={onBack}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11.5, color: C.textMuted, cursor: 'pointer', marginBottom: 8,
          }}
          onMouseEnter={e => e.currentTarget.style.color = C.emerald}
          onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
        >
          <Icon path="M15 19l-7-7 7-7" size={12} color="currentColor" /> Object Manager
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary }}>{obj.pluralLabel}</div>
          <div style={{ fontSize: 12, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>
            API Name: {obj.table}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>·</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>{obj.module}</div>
        </div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 5 }}>{obj.description}</div>
      </div>

      <SectionTabs sections={SUB_TABS} active={sub} onChange={(id) => { setSub(id); setSelectedLayoutId(null); setSelectedField(null) }} counts={counts} />

      <div style={{ flex: 1, overflow: 'auto', background: C.page }}>
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            Loading schema for {obj.table}…
          </div>
        )}
        {error && !loading && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ color: '#b03a2e', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
              Could not load {obj.table}
            </div>
            <div style={{ color: C.textMuted, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
              {String(error.message || error)}
            </div>
          </div>
        )}
        {!loading && !error && (
          <>
            {sub === 'details'     && <DetailsPane obj={obj} columns={columns} />}
            {sub === 'fields'      && (
              selectedField
                ? <FieldPicklistEditor
                    objectName={obj.table}
                    objectLabel={obj.pluralLabel || obj.label}
                    field={selectedField}
                    onBack={() => setSelectedField(null)}
                  />
                : <FieldsPane
                    columns={columns}
                    picklistFields={new Set(picklists.filter(p => p.field !== 'record_type').map(p => p.field))}
                    fieldMeta={fieldMeta}
                    onOpenField={setSelectedField}
                    onNewField={() => setFieldModal({ mode: 'create' })}
                    onEditField={(col) => setFieldModal({ mode: 'edit', column: col })}
                  />
            )}
            {sub === 'layouts' && (
              selectedLayoutId
                ? <LayoutEditor
                    layoutId={selectedLayoutId}
                    objectLabel={obj.pluralLabel || obj.label}
                    onBack={() => setSelectedLayoutId(null)}
                  />
                : <LayoutsPane
                    objectName={obj.table}
                    objectLabel={obj.pluralLabel || obj.label}
                    onSelectLayout={setSelectedLayoutId}
                    onCountChange={setLayoutsCount}
                  />
            )}
            {sub === 'recordtypes' && <RecordTypesPane objectName={obj.table} objectLabel={obj.pluralLabel || obj.label} onCountChange={setRecordTypesCount} />}
            {sub === 'validations' && <ValidationsPane rules={validations} />}
            {sub === 'automations' && <AutomationsPane rules={automations} />}
            {sub === 'related'     && <RelatedPane fks={incomingFKs} />}
          </>
        )}
      </div>

      {fieldModal && (
        <FieldCreateEditModal
          mode={fieldModal.mode}
          object={obj.table}
          objectLabel={obj.pluralLabel || obj.label}
          column={fieldModal.column}
          onClose={() => setFieldModal(null)}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  )
}

// ─── Panes ──────────────────────────────────────────────────────────────

function DetailsPane({ obj, columns }) {
  const requiredCount = columns.filter(c => c.is_nullable === 'NO').length
  const fkCount       = columns.filter(c => c.is_foreign_key).length
  const pkCount       = columns.filter(c => c.is_primary_key).length
  return (
    <div style={{ padding: '16px 24px' }}>
      <Card title="Object Information">
        <KV label="Label"         value={obj.label} />
        <KV label="Plural Label"  value={obj.pluralLabel} />
        <KV label="API Name"      value={obj.table} mono />
        <KV label="Module"        value={obj.module} />
        <KV label="Description"   value={obj.description} />
      </Card>
      <Card title="Data Profile">
        <KV label="Total Columns"    value={columns.length}  mono />
        <KV label="Required Columns" value={requiredCount}   mono />
        <KV label="Primary Keys"     value={pkCount}         mono />
        <KV label="Foreign Keys"     value={fkCount}         mono />
      </Card>
    </div>
  )
}

function PaneSearch({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', width: 300, marginBottom: 12 }}>
      <input
        type="text"
        placeholder={placeholder || 'Quick Find'}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '7px 12px 7px 32px',
          border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 13,
          background: C.page, color: C.textPrimary, outline: 'none', boxSizing: 'border-box',
        }}
        onFocus={e => e.currentTarget.style.borderColor = C.emerald}
        onBlur={e => e.currentTarget.style.borderColor = C.border}
      />
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </span>
    </div>
  )
}

function FieldsPane({ columns, picklistFields = new Set(), fieldMeta = {}, onOpenField, onNewField, onEditField }) {
  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState('ordinal')   // 'ordinal' | 'name'
  const [sortDir, setSortDir] = useState('asc')        // 'asc' | 'desc'
  const needle = q.trim().toLowerCase()

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const shown = useMemo(() => {
    let list = needle
      ? columns.filter(c =>
          (c.column_name || '').toLowerCase().includes(needle) ||
          (fieldMeta[c.column_name]?.label || '').toLowerCase().includes(needle) ||
          fmtType(c).toLowerCase().includes(needle) ||
          (c.references_table ? `${c.references_table}.${c.references_column}` : '').toLowerCase().includes(needle)
        )
      : [...columns]
    list.sort((a, b) => {
      let cmp
      if (sortKey === 'name') cmp = (a.column_name || '').localeCompare(b.column_name || '')
      else cmp = (a.ordinal_position || 0) - (b.ordinal_position || 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [columns, needle, sortKey, sortDir, fieldMeta])

  const Arrow = ({ active }) => (
    <span style={{ marginLeft: 4, opacity: active ? 1 : 0.25, fontSize: 9 }}>
      {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
    </span>
  )

  const GRID = '32px 1.6fr 1.4fr 1.1fr 0.6fr 0.5fr 1.2fr 70px'

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1 }}><PaneSearch value={q} onChange={setQ} placeholder="Search fields…" /></div>
        <button onClick={onNewField}
          style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" /> New Field
        </button>
      </div>
      <Card title={`Fields & Relationships (${shown.length}${needle ? ` of ${columns.length}` : ''})`} noBody>
        <div style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          gap: 0,
          fontSize: 11, fontWeight: 600, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.04em',
          padding: '10px 14px', background: '#fafbfd',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <div onClick={() => toggleSort('ordinal')} style={{ cursor: 'pointer', userSelect: 'none' }}># <Arrow active={sortKey === 'ordinal'} /></div>
          <div onClick={() => toggleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>Field Name <Arrow active={sortKey === 'name'} /></div>
          <div>Label</div>
          <div>Data Type</div>
          <div style={{ textAlign: 'center' }}>Required</div>
          <div style={{ textAlign: 'center' }}>PK/FK</div>
          <div>References</div>
          <div style={{ textAlign: 'right' }}>Actions</div>
        </div>
        {shown.map(c => {
          const isPicklist = picklistFields.has(c.column_name)
          const meta = fieldMeta[c.column_name]
          return (
          <div key={c.column_name} style={{
            display: 'grid',
            gridTemplateColumns: GRID,
            gap: 0,
            alignItems: 'center',
            padding: '9px 14px',
            fontSize: 12.5,
            borderBottom: `1px solid ${C.border}`,
          }}>
            <div style={{ color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
              {c.ordinal_position}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {isPicklist ? (
                <span
                  onClick={() => onOpenField && onOpenField(c.column_name)}
                  style={{ color: C.emerald, fontWeight: 500, cursor: 'pointer' }}
                  title="Manage picklist values & per-record-type availability"
                >
                  {c.column_name}
                </span>
              ) : (
                <span style={{ color: C.textPrimary }}>{c.column_name}</span>
              )}
              {isPicklist && (
                <span
                  onClick={() => onOpenField && onOpenField(c.column_name)}
                  style={{ cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: '#e8f3fb', color: '#1a5a8a' }}
                  title="Manage picklist values & per-record-type availability"
                >
                  PICKLIST
                </span>
              )}
              {meta?.isCustom && (
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: '#eef0fb', color: '#4a4a9a' }} title="Custom field">CUSTOM</span>
              )}
            </div>
            <div style={{ color: meta?.label ? C.textPrimary : C.textMuted, fontSize: 11.5 }}>
              {meta?.label || '—'}
            </div>
            <div style={{ color: C.textSecondary, fontSize: 11.5 }}>
              {fmtType(c)}
            </div>
            <div style={{ textAlign: 'center' }}>
              {c.is_nullable === 'NO' ? (
                <span style={{ background: '#fdecec', color: '#c04040', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>
                  Required
                </span>
              ) : (
                <span style={{ color: C.textMuted, fontSize: 11 }}>—</span>
              )}
            </div>
            <div style={{ textAlign: 'center' }}>
              {c.is_primary_key && (
                <span style={{ background: '#e8f8f2', color: '#1a7a4e', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>PK</span>
              )}
              {c.is_foreign_key && !c.is_primary_key && (
                <span style={{ background: '#e8f3fb', color: '#1a5a8a', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3 }}>FK</span>
              )}
              {!c.is_primary_key && !c.is_foreign_key && (
                <span style={{ color: C.textMuted, fontSize: 11 }}>—</span>
              )}
            </div>
            <div style={{ color: C.textSecondary, fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace' }}>
              {c.references_table ? `${c.references_table}.${c.references_column}` : <span style={{ color: C.textMuted, fontFamily: 'inherit' }}>—</span>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span onClick={() => onEditField && onEditField(c.column_name)}
                style={{ cursor: 'pointer', fontSize: 11, color: C.emerald, fontWeight: 600 }}
                title="Edit field label, help text, description, tier, history">
                Edit
              </span>
            </div>
          </div>
          )
        })}
      </Card>
    </div>
  )
}


function ValidationsPane({ rules }) {
  const [q, setQ] = useState('')
  if (rules.length === 0) {
    return <EmptyPane label="Validation Rules" hint="No validation rules defined for this object. Add rows to validation_rules with related_object set to this table name." />
  }
  const needle = q.trim().toLowerCase()
  const shown = needle ? rules.filter(r => JSON.stringify(r).toLowerCase().includes(needle)) : rules
  return (
    <div style={{ padding: '16px 24px' }}>
      <PaneSearch value={q} onChange={setQ} placeholder="Search validation rules…" />
      <Card title={`Validation Rules (${shown.length}${needle ? ` of ${rules.length}` : ''})`} noBody>
        <SimpleTable
          columns={[
            { label: 'Name',          field: 'name',           width: '1.6fr' },
            { label: 'Blocks On',     field: 'blockOnEvent',   width: '100px' },
            { label: 'At Status',     field: 'blockOnStatus',  width: '1.2fr' },
            { label: 'Error Message', field: 'errorMessage',   width: '2fr' },
            { label: 'Active',        field: 'status',         width: '90px' },
          ]}
          rows={shown}
        />
      </Card>
    </div>
  )
}

function AutomationsPane({ rules }) {
  const [q, setQ] = useState('')
  if (rules.length === 0) {
    return <EmptyPane label="Automation Rules" hint="No automation rules trigger on this object. Add rows to automation_rules with trigger_object set to this table name." />
  }
  const needle = q.trim().toLowerCase()
  const shown = needle ? rules.filter(r => JSON.stringify(r).toLowerCase().includes(needle)) : rules
  return (
    <div style={{ padding: '16px 24px' }}>
      <PaneSearch value={q} onChange={setQ} placeholder="Search automation rules…" />
      <Card title={`Automation Rules (${shown.length}${needle ? ` of ${rules.length}` : ''})`} noBody>
        <SimpleTable
          columns={[
            { label: '#',          field: 'executionOrder', width: '40px', center: true, mono: true },
            { label: 'Name',       field: 'name',           width: '1.6fr' },
            { label: 'Event',      field: 'triggerEvent',   width: '1fr' },
            { label: 'At Status',  field: 'triggerStatus',  width: '1.2fr' },
            { label: 'Action',     field: 'actionType',     width: '1fr' },
            { label: 'Target',     field: 'targetObject',   width: '1fr' },
            { label: 'Active',     field: 'status',         width: '90px' },
          ]}
          rows={shown}
        />
      </Card>
    </div>
  )
}

function RelatedPane({ fks }) {
  const [q, setQ] = useState('')
  if (fks.length === 0) {
    return <EmptyPane label="Related Lookups" hint="No other tables have foreign keys pointing to this object." />
  }
  const needle = q.trim().toLowerCase()
  const shown = needle ? fks.filter(r => JSON.stringify(r).toLowerCase().includes(needle)) : fks
  return (
    <div style={{ padding: '16px 24px' }}>
      <PaneSearch value={q} onChange={setQ} placeholder="Search related tables…" />
      <Card title={`Related Lookups — Child Tables (${shown.length}${needle ? ` of ${fks.length}` : ''})`} noBody>
        <SimpleTable
          columns={[
            { label: 'Referencing Table',  field: 'referencing_table',  width: '1.6fr', mono: true },
            { label: 'Referencing Column', field: 'referencing_column', width: '1.6fr', mono: true },
            { label: 'References Our',     field: 'referenced_column',  width: '1fr',   mono: true },
          ]}
          rows={shown}
          noMap
        />
      </Card>
      <div style={{ padding: '10px 2px', fontSize: 11, color: C.textMuted }}>
        Each row represents a foreign-key relationship — these tables hold records that belong to this object.
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────

function Card({ title, children, noBody }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      marginBottom: 14, overflow: 'hidden',
    }}>
      <div style={{
        padding: '11px 14px',
        fontSize: 12.5, fontWeight: 600, color: C.textPrimary,
        borderBottom: `1px solid ${C.border}`, background: '#fafbfd',
      }}>
        {title}
      </div>
      {noBody ? children : <div style={{ padding: '4px 14px 8px' }}>{children}</div>}
    </div>
  )
}

function KV({ label, value, mono }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12,
      padding: '8px 0',
      borderBottom: `1px dashed ${C.border}`,
      fontSize: 12.5,
    }}>
      <div style={{ color: C.textMuted, fontWeight: 500 }}>{label}</div>
      <div style={{
        color: C.textPrimary,
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
        fontSize: mono ? 11.5 : 12.5,
      }}>{value ?? '—'}</div>
    </div>
  )
}

function SimpleTable({ columns, rows, noMap }) {
  const gridCols = columns.map(c => c.width || '1fr').join(' ')
  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: gridCols, gap: 0,
        fontSize: 11, fontWeight: 600, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        padding: '10px 14px', background: '#fafbfd',
        borderBottom: `1px solid ${C.border}`,
      }}>
        {columns.map(c => (
          <div key={c.field} style={{ textAlign: c.center ? 'center' : 'left' }}>{c.label}</div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={noMap ? i : (r._id || r.id || i)} style={{
          display: 'grid', gridTemplateColumns: gridCols, gap: 0,
          padding: '9px 14px', fontSize: 12.5, alignItems: 'center',
          borderBottom: `1px solid ${C.border}`,
        }}>
          {columns.map(c => (
            <div key={c.field} style={{
              textAlign: c.center ? 'center' : 'left',
              color: C.textPrimary,
              fontFamily: c.mono ? 'JetBrains Mono, monospace' : 'inherit',
              fontSize: c.mono ? 11.5 : 12.5,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {r[c.field] ?? '—'}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function EmptyPane({ label, hint }) {
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center' }}>
      <div style={{ color: C.textPrimary, fontWeight: 500, fontSize: 14, marginBottom: 6 }}>
        No {label} yet
      </div>
      <div style={{ color: C.textMuted, fontSize: 12, maxWidth: 560, margin: '0 auto', lineHeight: 1.5 }}>
        {hint}
      </div>
    </div>
  )
}

// Render "text", "uuid → users.id", "timestamp with time zone" etc.
function fmtType(col) {
  const t = col.data_type
  if (col.character_maximum_length != null) return `${t}(${col.character_maximum_length})`
  if (col.numeric_precision != null && col.numeric_scale != null && (col.numeric_precision !== 32 || col.numeric_scale !== 0)) {
    return `${t}(${col.numeric_precision},${col.numeric_scale})`
  }
  return t
}
