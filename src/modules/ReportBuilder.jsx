import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from '../components/UI'
import {
  loadReport, saveReport,
  loadFieldTree, loadRelatedObjectFields,
  listPrimaryObjectOptions,
} from '../data/reportsService'
import { supabase } from '../lib/supabase'

// ─── Top-level Report Builder ─────────────────────────────────────────────
//
// Loads a report (or initialises a new one) and renders five tabs over a
// shared state object: Fields, Filters, Groupings, Calculated Fields,
// Settings. Save persists the entire shape via reportsService.saveReport.
// The runner (executing the query and rendering tabular/summary/matrix
// output) is a separate screen — Phase 2c.

const TABS = [
  { id: 'fields',      label: 'Fields' },
  { id: 'filters',     label: 'Filters' },
  { id: 'groupings',   label: 'Groupings' },
  { id: 'calc_fields', label: 'Calculated Fields' },
  { id: 'settings',    label: 'Settings' },
]

const FORMAT_OPTIONS = [
  { value: 'tabular', label: 'Tabular' },
  { value: 'summary', label: 'Summary' },
  { value: 'matrix',  label: 'Matrix' },
]

export default function ReportBuilder({ reportId, onClose, onSaved }) {
  const isNew = !reportId || reportId === 'new'

  const [tab, setTab]               = useState('fields')
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [primaryOptions, setPrimaryOptions] = useState([])
  const [folders, setFolders]       = useState([])

  // Report state — single shape matching saveReport's parameters.
  const [report, setReport] = useState({
    rpt_name:             '',
    rpt_description:      '',
    rpt_folder_id:        null,
    rpt_format:           'tabular',
    rpt_primary_object:   '',
    rpt_selected_fields:  [],
    rpt_filter_logic:     'all',
    rpt_sort_config:      [],
    rpt_column_groupings: [],
    rpt_runtime_prompts:  [],
    rpt_charts:           [],
  })
  const [filters, setFilters]                   = useState([])
  const [groupings, setGroupings]               = useState([])
  const [calculatedFields, setCalculatedFields] = useState([])

  const [fieldTree, setFieldTree]               = useState(null)
  const [expandedRelated, setExpandedRelated]   = useState({})  // viaTable → { columns: [...] }

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  // ─── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true); setError(null)
      try {
        const [opts, foldersRes] = await Promise.all([
          listPrimaryObjectOptions(),
          supabase.from('report_folders')
            .select('id, rf_name')
            .eq('is_deleted', false)
            .order('rf_name'),
        ])
        if (cancelled) return
        setPrimaryOptions(opts)
        setFolders(foldersRes.data || [])

        if (!isNew) {
          const loaded = await loadReport(reportId)
          if (cancelled) return
          if (!loaded) {
            setError(new Error('Report not found.'))
            setLoading(false)
            return
          }
          setReport({
            rpt_name:             loaded.report.rpt_name || '',
            rpt_description:      loaded.report.rpt_description || '',
            rpt_folder_id:        loaded.report.rpt_folder_id,
            rpt_format:           loaded.report.rpt_format || 'tabular',
            rpt_primary_object:   loaded.report.rpt_primary_object || '',
            rpt_selected_fields:  loaded.report.rpt_selected_fields || [],
            rpt_filter_logic:     loaded.report.rpt_filter_logic || 'all',
            rpt_sort_config:      loaded.report.rpt_sort_config || [],
            rpt_column_groupings: loaded.report.rpt_column_groupings || [],
            rpt_runtime_prompts:  loaded.report.rpt_runtime_prompts || [],
            rpt_charts:           loaded.report.rpt_charts || [],
          })
          setFilters((loaded.filters || []).map(f => ({
            field_name:        f.rfilt_field_name,
            field_table:       f.rfilt_field_table,
            field_via_path:    f.rfilt_field_via_path,
            operator:          f.rfilt_operator,
            value:             f.rfilt_value,
            is_cross_filter:   f.rfilt_is_cross_filter,
            cross_object:      f.rfilt_cross_object,
            cross_match:       f.rfilt_cross_match,
            cross_subfilters:  f.rfilt_cross_subfilters,
            is_runtime_prompt: f.rfilt_is_runtime_prompt,
            runtime_label:     f.rfilt_runtime_label,
          })))
          setGroupings((loaded.groupings || []).map(g => ({
            field_name:         g.rgr_field_name,
            field_table:        g.rgr_field_table,
            field_via_path:     g.rgr_field_via_path,
            field_label:        g.rgr_field_label,
            sort_direction:     g.rgr_sort_direction,
            sort_by_aggregate:  g.rgr_sort_by_aggregate,
            show_subtotal:      g.rgr_show_subtotal,
            date_granularity:   g.rgr_date_granularity,
          })))
          setCalculatedFields((loaded.calculatedFields || []).map(c => ({
            label:          c.rcf_label,
            scope:          c.rcf_scope,
            expression:     c.rcf_expression,
            data_type:      c.rcf_data_type,
            format_options: c.rcf_format_options,
            grouping_level: c.rcf_grouping_level,
          })))
        }
        setLoading(false)
      } catch (err) {
        if (!cancelled) { setError(err); setLoading(false) }
      }
    }

    init()
    return () => { cancelled = true }
  }, [reportId, isNew])

  // ─── Field tree loading whenever primary object changes ────────────────
  useEffect(() => {
    if (!report.rpt_primary_object) {
      setFieldTree(null); setExpandedRelated({}); return
    }
    let cancelled = false
    loadFieldTree(report.rpt_primary_object)
      .then(tree => { if (!cancelled) { setFieldTree(tree); setExpandedRelated({}) } })
      .catch(err => { if (!cancelled) console.warn('field tree load failed:', err) })
    return () => { cancelled = true }
  }, [report.rpt_primary_object])

  // ─── Helpers ───────────────────────────────────────────────────────────
  const updateReport = (patch) => setReport(prev => ({ ...prev, ...patch }))

  const handleExpandRelated = async (fkColumn, table) => {
    if (expandedRelated[fkColumn]) {
      // Already expanded → collapse
      const next = { ...expandedRelated }
      delete next[fkColumn]
      setExpandedRelated(next)
      return
    }
    try {
      const obj = await loadRelatedObjectFields(table, [fkColumn])
      setExpandedRelated(prev => ({ ...prev, [fkColumn]: obj }))
    } catch (err) {
      console.warn('related fields load failed:', err)
    }
  }

  const addField = (column, table, viaPath = null) => {
    const exists = report.rpt_selected_fields.some(f =>
      f.name === column.name && f.table === table &&
      JSON.stringify(f.via_path || null) === JSON.stringify(viaPath))
    if (exists) return
    const newField = {
      name:     column.name,
      table:    table,
      label:    column.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      via_path: viaPath,
      type:     column.type,
    }
    updateReport({ rpt_selected_fields: [...report.rpt_selected_fields, newField] })
  }

  const removeField = (idx) => {
    updateReport({ rpt_selected_fields: report.rpt_selected_fields.filter((_, i) => i !== idx) })
  }

  const moveField = (idx, dir) => {
    const fields = [...report.rpt_selected_fields]
    const target = idx + dir
    if (target < 0 || target >= fields.length) return
    ;[fields[idx], fields[target]] = [fields[target], fields[idx]]
    updateReport({ rpt_selected_fields: fields })
  }

  // ─── Save ──────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!report.rpt_name) { alert('Report name is required.'); return }
    if (!report.rpt_primary_object) { alert('Primary object is required.'); return }
    setSaving(true); setError(null)
    try {
      const newId = await saveReport({
        id: reportId, report, filters, groupings, calculatedFields,
      })
      setSavedAt(new Date())
      onSaved?.(newId)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} />

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:C.page }}>
      {/* Header */}
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ fontSize:11, color:C.textMuted }}>{isNew ? 'New Report' : 'Edit Report'}</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>
            {report.rpt_name || 'Untitled Report'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {savedAt && (
            <div style={{ fontSize:11, color:C.textMuted }}>
              Saved {savedAt.toLocaleTimeString()}
            </div>
          )}
          <button onClick={onClose} style={btnSecondary()}>Close</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary(saving)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        background:C.card, borderBottom:`1px solid ${C.border}`,
        display:'flex', padding:'0 24px',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding:'12px 16px', background:'transparent', border:'none',
              borderBottom: tab === t.id ? `2px solid ${C.emerald}` : '2px solid transparent',
              fontSize:13, fontWeight: tab === t.id ? 600 : 500,
              color: tab === t.id ? C.textPrimary : C.textSecondary,
              cursor:'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
        {tab === 'fields' && (
          <FieldsTab
            primaryOptions={primaryOptions}
            report={report}
            updateReport={updateReport}
            fieldTree={fieldTree}
            expandedRelated={expandedRelated}
            onExpandRelated={handleExpandRelated}
            addField={addField}
            removeField={removeField}
            moveField={moveField}
          />
        )}
        {tab === 'filters' && (
          <FiltersTab
            report={report} updateReport={updateReport}
            filters={filters} setFilters={setFilters}
            primaryObject={report.rpt_primary_object}
            fieldTree={fieldTree}
          />
        )}
        {tab === 'groupings' && (
          <GroupingsTab
            report={report} updateReport={updateReport}
            groupings={groupings} setGroupings={setGroupings}
            fieldTree={fieldTree}
          />
        )}
        {tab === 'calc_fields' && (
          <CalcFieldsTab
            calculatedFields={calculatedFields}
            setCalculatedFields={setCalculatedFields}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab
            report={report} updateReport={updateReport}
            folders={folders}
          />
        )}
      </div>
    </div>
  )
}

// ─── Fields tab ───────────────────────────────────────────────────────────

function FieldsTab({
  primaryOptions, report, updateReport,
  fieldTree, expandedRelated, onExpandRelated,
  addField, removeField, moveField,
}) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>
      {/* Left: primary object picker + field tree */}
      <div style={card()}>
        <div style={cardHeader()}>Available Fields</div>
        <div style={{ padding:12 }}>
          <label style={fieldLabel()}>Primary Object</label>
          <select
            value={report.rpt_primary_object}
            onChange={e => updateReport({ rpt_primary_object: e.target.value, rpt_selected_fields: [] })}
            style={inputStyle()}
          >
            <option value="">— Select —</option>
            {primaryOptions.map(o => (
              <option key={o.table} value={o.table}>{o.label}</option>
            ))}
          </select>

          {fieldTree?.primary && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:12, fontWeight:600, color:C.textSecondary, marginBottom:6 }}>
                {report.rpt_primary_object}
              </div>
              {fieldTree.primary.columns.map(col => (
                <FieldRow key={col.name} column={col}
                  onAdd={() => addField(col, report.rpt_primary_object)} />
              ))}

              {fieldTree.related?.length > 0 && (
                <div style={{ marginTop:16 }}>
                  <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>
                    Related Objects
                  </div>
                  {fieldTree.related.map(rel => (
                    <div key={rel.fk_column} style={{ marginBottom:6 }}>
                      <button
                        onClick={() => onExpandRelated(rel.fk_column, rel.table)}
                        style={{
                          width:'100%', textAlign:'left', padding:'6px 8px',
                          background: expandedRelated[rel.fk_column] ? C.cardSecondary : 'transparent',
                          border:`1px solid ${C.border}`, borderRadius:6,
                          fontSize:12, color:C.textPrimary, cursor:'pointer',
                          display:'flex', justifyContent:'space-between', alignItems:'center',
                        }}
                      >
                        <span>{rel.label} <span style={{ color:C.textMuted }}>({rel.table})</span></span>
                        <span>{expandedRelated[rel.fk_column] ? '−' : '+'}</span>
                      </button>
                      {expandedRelated[rel.fk_column] && (
                        <div style={{ paddingLeft:12, marginTop:4 }}>
                          {expandedRelated[rel.fk_column].columns.map(col => (
                            <FieldRow key={col.name} column={col}
                              onAdd={() => addField(col, rel.table, [rel.fk_column])} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: selected fields */}
      <div style={card()}>
        <div style={cardHeader()}>
          Selected Fields ({report.rpt_selected_fields.length})
        </div>
        <div style={{ padding:12 }}>
          {report.rpt_selected_fields.length === 0 ? (
            <div style={emptyState()}>No fields selected. Pick from the left.</div>
          ) : (
            report.rpt_selected_fields.map((f, idx) => (
              <div key={`${f.table}-${f.name}-${idx}`} style={{
                display:'flex', alignItems:'center', gap:8, padding:'8px 10px',
                background:C.cardSecondary, borderRadius:6, marginBottom:6,
              }}>
                <div style={{ flex:1, fontSize:12 }}>
                  <div style={{ fontWeight:500, color:C.textPrimary }}>{f.label}</div>
                  <div style={{ color:C.textMuted, fontSize:11 }}>
                    {f.via_path ? `${f.table} (via ${f.via_path.join(' → ')})` : f.table}
                  </div>
                </div>
                <button onClick={() => moveField(idx, -1)} style={miniBtn()}>↑</button>
                <button onClick={() => moveField(idx, 1)} style={miniBtn()}>↓</button>
                <button onClick={() => removeField(idx)} style={miniBtn(true)}>×</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function FieldRow({ column, onAdd }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'4px 8px', fontSize:12, borderRadius:4,
    }}
    onMouseEnter={e => e.currentTarget.style.background = C.cardSecondary}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div>
        <span style={{ color:C.textPrimary }}>{column.name}</span>
        <span style={{ color:C.textMuted, marginLeft:6, fontSize:11 }}>{column.type}</span>
      </div>
      <button onClick={onAdd} style={miniBtn()}>+</button>
    </div>
  )
}

// ─── Filters tab ──────────────────────────────────────────────────────────

const FILTER_OPS = [
  'equals','not_equals','greater_than','less_than','greater_or_equal','less_or_equal',
  'in','not_in','contains','starts_with','ends_with',
  'is_null','is_not_null','in_last_n_days','this_month','this_year',
]

function FiltersTab({ report, updateReport, filters, setFilters, primaryObject, fieldTree }) {
  const addFilter = () => {
    setFilters([...filters, { field_name:'', field_table:primaryObject, operator:'equals', value:'' }])
  }
  const updateFilter = (idx, patch) => {
    setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const removeFilter = (idx) => setFilters(filters.filter((_, i) => i !== idx))

  return (
    <div style={card()}>
      <div style={cardHeader()}>
        <span>Filters ({filters.length})</span>
        <button onClick={addFilter} style={btnSecondary(false, 'small')}>+ Add Filter</button>
      </div>
      <div style={{ padding:12 }}>
        {filters.length === 0 ? (
          <div style={emptyState()}>No filters yet. Click "Add Filter" to add one.</div>
        ) : (
          <>
            {filters.map((f, idx) => (
              <div key={idx} style={{
                display:'grid', gridTemplateColumns:'30px 1fr 140px 1fr 30px',
                gap:8, marginBottom:8, alignItems:'center',
              }}>
                <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
                <select
                  value={f.field_name || ''}
                  onChange={e => updateFilter(idx, { field_name: e.target.value })}
                  style={inputStyle()}
                >
                  <option value="">— Field —</option>
                  {fieldTree?.primary?.columns.map(c => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={e => updateFilter(idx, { operator: e.target.value })}
                  style={inputStyle()}
                >
                  {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
                </select>
                <input
                  type="text"
                  value={f.value || ''}
                  onChange={e => updateFilter(idx, { value: e.target.value })}
                  placeholder="Value"
                  style={inputStyle()}
                />
                <button onClick={() => removeFilter(idx)} style={miniBtn(true)}>×</button>
              </div>
            ))}

            <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              <label style={fieldLabel()}>Filter Logic</label>
              <input
                type="text"
                value={report.rpt_filter_logic}
                onChange={e => updateReport({ rpt_filter_logic: e.target.value })}
                placeholder="all  (or e.g. '1 AND (2 OR 3)')"
                style={inputStyle()}
              />
              <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
                Use 'all' for AND of all filters, or write '1 AND (2 OR 3)' to combine them.
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Groupings tab ────────────────────────────────────────────────────────

function GroupingsTab({ report, updateReport, groupings, setGroupings, fieldTree }) {
  const formatLabel = report.rpt_format
  const addGrouping = () => {
    if (groupings.length >= 6) { alert('Maximum 6 row groupings.'); return }
    setGroupings([...groupings, { field_name:'', sort_direction:'asc', show_subtotal:true }])
  }
  const updateGrouping = (idx, patch) => {
    setGroupings(groupings.map((g, i) => i === idx ? { ...g, ...patch } : g))
  }
  const removeGrouping = (idx) => setGroupings(groupings.filter((_, i) => i !== idx))

  if (formatLabel === 'tabular') {
    return (
      <div style={card()}>
        <div style={cardHeader()}>Groupings</div>
        <div style={{ padding:12 }}>
          <div style={emptyState()}>
            Tabular reports don't support groupings. Change Format to Summary or Matrix in Settings to add groupings.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={card()}>
      <div style={cardHeader()}>
        <span>Row Groupings ({groupings.length} / 6)</span>
        <button onClick={addGrouping} style={btnSecondary(false, 'small')}>+ Add Grouping</button>
      </div>
      <div style={{ padding:12 }}>
        {groupings.length === 0 ? (
          <div style={emptyState()}>No groupings yet. Click "Add Grouping" to add one.</div>
        ) : (
          groupings.map((g, idx) => (
            <div key={idx} style={{
              display:'grid', gridTemplateColumns:'30px 1fr 100px 100px 30px',
              gap:8, marginBottom:8, alignItems:'center',
            }}>
              <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
              <select
                value={g.field_name}
                onChange={e => updateGrouping(idx, { field_name: e.target.value })}
                style={inputStyle()}
              >
                <option value="">— Field —</option>
                {fieldTree?.primary?.columns.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              <select
                value={g.sort_direction}
                onChange={e => updateGrouping(idx, { sort_direction: e.target.value })}
                style={inputStyle()}
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>
              <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:C.textPrimary }}>
                <input type="checkbox" checked={g.show_subtotal !== false}
                  onChange={e => updateGrouping(idx, { show_subtotal: e.target.checked })} />
                Subtotal
              </label>
              <button onClick={() => removeGrouping(idx)} style={miniBtn(true)}>×</button>
            </div>
          ))
        )}

        {formatLabel === 'matrix' && (
          <div style={{ marginTop:24, paddingTop:16, borderTop:`1px solid ${C.border}` }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary, marginBottom:8 }}>
              Column Groupings (Matrix only — up to 3)
            </div>
            <div style={{ fontSize:11, color:C.textMuted }}>
              Column groupings configuration coming in a follow-up — for now, edit the
              rpt_column_groupings JSON directly via the database if needed.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Calculated Fields tab ────────────────────────────────────────────────

function CalcFieldsTab({ calculatedFields, setCalculatedFields }) {
  const add = () => {
    setCalculatedFields([...calculatedFields, {
      label:'', scope:'row', expression:'', data_type:'number',
    }])
  }
  const update = (idx, patch) => {
    setCalculatedFields(calculatedFields.map((c, i) => i === idx ? { ...c, ...patch } : c))
  }
  const remove = (idx) => setCalculatedFields(calculatedFields.filter((_, i) => i !== idx))

  return (
    <div style={card()}>
      <div style={cardHeader()}>
        <span>Calculated Fields ({calculatedFields.length})</span>
        <button onClick={add} style={btnSecondary(false, 'small')}>+ Add Calculated Field</button>
      </div>
      <div style={{ padding:12 }}>
        {calculatedFields.length === 0 ? (
          <div style={emptyState()}>
            No calculated fields yet. Click "Add Calculated Field" to create row-level
            (per row) or summary-level (per group) formulas.
          </div>
        ) : (
          calculatedFields.map((c, idx) => (
            <div key={idx} style={{
              padding:12, background:C.cardSecondary, borderRadius:6, marginBottom:10,
            }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 120px 120px 30px', gap:8, marginBottom:8 }}>
                <input
                  type="text"
                  value={c.label}
                  onChange={e => update(idx, { label: e.target.value })}
                  placeholder="Label"
                  style={inputStyle()}
                />
                <select value={c.scope} onChange={e => update(idx, { scope: e.target.value })} style={inputStyle()}>
                  <option value="row">Row-level</option>
                  <option value="summary">Summary</option>
                </select>
                <select value={c.data_type} onChange={e => update(idx, { data_type: e.target.value })} style={inputStyle()}>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="percent">Percent</option>
                  <option value="date">Date</option>
                  <option value="datetime">Datetime</option>
                  <option value="text">Text</option>
                  <option value="boolean">Boolean</option>
                </select>
                <button onClick={() => remove(idx)} style={miniBtn(true)}>×</button>
              </div>
              <textarea
                value={c.expression}
                onChange={e => update(idx, { expression: e.target.value })}
                placeholder={c.scope === 'row' ? "e.g. TODAY() - created_at" : "e.g. SUM(amount) / COUNT(id)"}
                rows={2}
                style={{ ...inputStyle(), fontFamily:'JetBrains Mono, monospace', fontSize:12 }}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────

function SettingsTab({ report, updateReport, folders }) {
  return (
    <div style={card()}>
      <div style={cardHeader()}>Settings</div>
      <div style={{ padding:16, display:'grid', gap:14 }}>
        <div>
          <label style={fieldLabel()}>Report Name</label>
          <input
            type="text"
            value={report.rpt_name}
            onChange={e => updateReport({ rpt_name: e.target.value })}
            style={inputStyle()}
          />
        </div>
        <div>
          <label style={fieldLabel()}>Description</label>
          <textarea
            value={report.rpt_description}
            onChange={e => updateReport({ rpt_description: e.target.value })}
            rows={3}
            style={inputStyle()}
          />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <label style={fieldLabel()}>Format</label>
            <select
              value={report.rpt_format}
              onChange={e => updateReport({ rpt_format: e.target.value })}
              style={inputStyle()}
            >
              {FORMAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={fieldLabel()}>Folder</label>
            <select
              value={report.rpt_folder_id || ''}
              onChange={e => updateReport({ rpt_folder_id: e.target.value || null })}
              style={inputStyle()}
            >
              <option value="">— None —</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.rf_name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────

function card() {
  return {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
    overflow: 'hidden',
  }
}

function cardHeader() {
  return {
    padding: '10px 12px', fontSize: 13, fontWeight: 600, color: C.textPrimary,
    borderBottom: `1px solid ${C.border}`, background: C.cardSecondary,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
}

function fieldLabel() {
  return {
    display: 'block', fontSize: 11, fontWeight: 500, color: C.textSecondary,
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  }
}

function inputStyle() {
  return {
    width: '100%', padding: '8px 10px', fontSize: 13,
    background: C.card, color: C.textPrimary,
    border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit',
    boxSizing: 'border-box',
  }
}

function btnPrimary(disabled) {
  return {
    padding: '8px 14px', fontSize: 13, fontWeight: 500,
    background: disabled ? C.borderDark : C.emerald, color: '#fff',
    border: 'none', borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
  }
}

function btnSecondary(disabled, size) {
  return {
    padding: size === 'small' ? '4px 10px' : '8px 14px',
    fontSize: size === 'small' ? 12 : 13, fontWeight: 500,
    background: C.card, color: C.textPrimary,
    border: `1px solid ${C.borderDark}`, borderRadius: 6,
    cursor: disabled ? 'default' : 'pointer',
  }
}

function miniBtn(danger) {
  return {
    width: 24, height: 24, fontSize: 14, fontWeight: 600,
    background: danger ? '#fee' : C.card, color: danger ? '#c33' : C.textPrimary,
    border: `1px solid ${danger ? '#fcc' : C.border}`, borderRadius: 4, cursor: 'pointer',
  }
}

function emptyState() {
  return {
    padding: '24px 12px', textAlign: 'center',
    fontSize: 12, color: C.textMuted, fontStyle: 'italic',
  }
}
