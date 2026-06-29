import { useState, useEffect, lazy, Suspense } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from '../components/UI'
import SearchableCombo from '../components/SearchableCombo'
import {
  loadReport, saveReport, cloneReport,
  loadFieldTree, loadRelatedObjectFields,
  listPrimaryObjectOptions,
  listObjectColumns,
  loadFilterValueOptions,
  runReport,
  runReportDefinition,
  buildReportDefinition,
} from '../data/reportsService'
import { TabularLayout, SummaryLayout, MatrixLayout } from './ReportRunner'
import { supabase } from '../lib/supabase'
import SortableList from '../builder/SortableList'
// CodeMirror formula editor — lazy so its (and mathjs's) weight only loads when
// a calculated field is actually being edited.
const FormulaEditor = lazy(() => import('../lib/formula/FormulaEditor'))

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

  // ─── Live preview pane (right side, Salesforce-style) ──────────────────
  // The preview now runs the UNSAVED, in-editor config (via runReportDefinition
  // + buildReportDefinition) — debounced — so it updates as you build, before
  // any save, and works for brand-new reports too. No write-back on preview.
  const [previewResult, setPreviewResult]   = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError]     = useState(null)
  const [previewNonce, setPreviewNonce]     = useState(0)
  const previewable = !!report.rpt_primary_object && (report.rpt_selected_fields || []).length > 0

  const runPreview = async () => {
    if (!previewable) { setPreviewResult(null); return }
    setPreviewLoading(true); setPreviewError(null)
    try {
      const r = await runReportDefinition(buildReportDefinition({ report, filters, groupings, calculatedFields }), { reportId: null })
      setPreviewResult(r)
    } catch (err) {
      setPreviewError(err)
    } finally {
      setPreviewLoading(false)
    }
  }

  // Debounced live preview: re-run whenever the editable config changes.
  useEffect(() => {
    if (!previewable) { setPreviewResult(null); setPreviewLoading(false); return }
    let cancelled = false
    setPreviewLoading(true); setPreviewError(null)
    const t = setTimeout(async () => {
      try {
        const r = await runReportDefinition(buildReportDefinition({ report, filters, groupings, calculatedFields }), { reportId: null })
        if (!cancelled) setPreviewResult(r)
      } catch (err) {
        if (!cancelled) setPreviewError(err)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, filters, groupings, calculatedFields, previewNonce])

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
            prompt_input_type: f.rfilt_prompt_input_type || 'text',
            prompt_options:    f.rfilt_prompt_options || [],
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

  const handleExpandRelated = async (viaPath, table) => {
    // viaPath is the full FK chain to this node, e.g. ['property_id'] or
    // ['property_id', 'account_id']. Keying on the joined path lets multiple
    // levels of expansion coexist. Toggling collapses.
    const key = viaPath.join('.')
    if (expandedRelated[key]) {
      const next = { ...expandedRelated }
      delete next[key]
      setExpandedRelated(next)
      return
    }
    try {
      const obj = await loadRelatedObjectFields(table, viaPath)
      setExpandedRelated(prev => ({ ...prev, [key]: obj }))
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
  // Drag reorder (dnd-kit) — replaces the up/down shuffle as the primary
  // reordering gesture. Receives the already-reordered field array.
  const reorderFields = (nextFields) => {
    updateReport({ rpt_selected_fields: nextFields })
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
      setPreviewNonce(n => n + 1)
      onSaved?.(newId)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  // ─── Save As (Clone) ───────────────────────────────────────────────────
  // Two-step. First persists the current edits to the existing record so
  // they aren't lost if the user later discards the clone (this matches
  // Salesforce: Save As never throws away unsaved changes on the source).
  // Then calls clone_report to produce the copy. Parent navigates to the
  // new id via onSaved — the Builder will reload onto the freshly-cloned
  // record. Disabled on a brand-new unsaved report (just hit Save then).
  const handleSaveAs = async () => {
    if (isNew) return
    if (!report.rpt_name) { alert('Report name is required.'); return }
    if (!report.rpt_primary_object) { alert('Primary object is required.'); return }
    setSaving(true); setError(null)
    try {
      // Step 1 — persist current edits to the source. saveReport handles
      // both insert and update; for an existing record it updates in place.
      await saveReport({ id: reportId, report, filters, groupings, calculatedFields })
      // Step 2 — clone the now-up-to-date source.
      const newId = await cloneReport(reportId)
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
          {/* Save As — persist current edits, then clone. Hidden on new
              unsaved reports (no source to clone yet). */}
          {!isNew && (
            <button
              onClick={handleSaveAs}
              disabled={saving}
              title="Save current changes, then create a copy you can edit independently"
              style={btnSecondary()}
            >
              {saving ? '…' : 'Save As'}
            </button>
          )}
          <button onClick={handleSave} disabled={saving} style={btnPrimary(saving)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Body: Salesforce-style split — config rail left (40%), live results
          preview right (60%). */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Left: tabs + tab content */}
        <div style={{
          width:'40%', minWidth:380, display:'flex', flexDirection:'column',
          borderRight:`1px solid ${C.border}`, background:C.page, overflow:'hidden',
        }}>
          {/* Tabs */}
          <div style={{
            background:C.card, borderBottom:`1px solid ${C.border}`,
            display:'flex', padding:'0 16px', flexWrap:'wrap',
          }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding:'12px 14px', background:'transparent', border:'none',
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
          <div style={{ flex:1, overflow:'auto', padding:'18px 20px' }}>
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
                reorderFields={reorderFields}
              />
            )}
            {tab === 'filters' && (
              <FiltersTab
                report={report} updateReport={updateReport}
                filters={filters} setFilters={setFilters}
                primaryObject={report.rpt_primary_object}
                fieldTree={fieldTree}
                primaryOptions={primaryOptions}
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
                report={report}
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

        {/* Right: live results preview */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', background:C.page }}>
          <div style={{
            background:C.card, borderBottom:`1px solid ${C.border}`,
            padding:'10px 20px', display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.textSecondary, textTransform:'uppercase', letterSpacing:'0.05em' }}>
              Preview {previewResult ? `· ${previewResult.rows?.length ?? 0} rows` : ''}
            </div>
            <button onClick={runPreview} disabled={previewLoading} style={btnSecondary()}>
              {previewLoading ? 'Running…' : 'Refresh'}
            </button>
          </div>
          <div style={{ flex:1, overflow:'auto', padding:'16px 20px' }}>
            {!previewable ? (
              <div style={{ fontSize:13, color:C.textMuted }}>Pick a primary object and at least one field to see a live preview.</div>
            ) : previewLoading && !previewResult ? (
              <div style={{ fontSize:13, color:C.textMuted }}>Running preview…</div>
            ) : previewError ? (
              <div style={{ fontSize:13, color:C.danger }}>Preview failed: {previewError.message}</div>
            ) : previewResult ? (
              <>
                {previewResult.format === 'tabular' && <TabularLayout result={previewResult} />}
                {previewResult.format === 'summary' && <SummaryLayout result={previewResult} />}
                {previewResult.format === 'matrix'  && <MatrixLayout  result={previewResult} />}
              </>
            ) : (
              <div style={{ fontSize:13, color:C.textMuted }}>Click Refresh to preview results.</div>
            )}
            {!isNew && (
              <div style={{ fontSize:11, color:C.textMuted, marginTop:14 }}>
                Preview reflects the last saved version. Save to update it with your latest edits.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Fields tab ───────────────────────────────────────────────────────────

function fieldKey(f) {
  return `${f.table}|${f.name}|${(f.via_path || []).join('>')}`
}

function FieldsTab({
  primaryOptions, report, updateReport,
  fieldTree, expandedRelated, onExpandRelated,
  addField, removeField, moveField, reorderFields,
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
                    <RelatedObjectNode
                      key={rel.fk_column}
                      rel={rel}
                      viaPath={[rel.fk_column]}
                      expandedRelated={expandedRelated}
                      onExpandRelated={onExpandRelated}
                      addField={addField}
                      depth={0}
                    />
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
            <SortableList
              items={report.rpt_selected_fields.map(f => ({ id: fieldKey(f), f }))}
              onReorder={(next) => reorderFields(next.map(x => x.f))}
              renderItem={(item, { setNodeRef, style, dragHandleProps }) => {
                const f = item.f
                const idx = report.rpt_selected_fields.findIndex(x => fieldKey(x) === item.id)
                return (
                  <div ref={setNodeRef} style={{
                    ...style, display:'flex', alignItems:'center', gap:8, padding:'8px 10px',
                    background:C.cardSecondary, borderRadius:6, marginBottom:6,
                  }}>
                    <span {...dragHandleProps} title="Drag to reorder" style={{ cursor:'grab', color:C.textMuted, fontSize:14, lineHeight:1, touchAction:'none' }}>⠿</span>
                    <div style={{ flex:1, fontSize:12, minWidth:0 }}>
                      <div style={{ fontWeight:500, color:C.textPrimary }}>{f.label}</div>
                      <div style={{ color:C.textMuted, fontSize:11 }}>
                        {f.via_path ? `${f.table} (via ${f.via_path.join(' → ')})` : f.table}
                      </div>
                    </div>
                    <button onClick={() => removeField(idx)} style={miniBtn(true)}>×</button>
                  </div>
                )
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function RelatedObjectNode({ rel, viaPath, expandedRelated, onExpandRelated, addField, depth }) {
  const key = viaPath.join('.')
  const isExpanded = !!expandedRelated[key]
  const node = expandedRelated[key]
  // Cap depth at 3 to prevent runaway expansion (FK graph contains cycles).
  // Users can still expand 3 levels of related objects from the primary —
  // more than enough for any realistic report.
  const maxDepth = 3
  return (
    <div style={{ marginBottom:6 }}>
      <button
        onClick={() => onExpandRelated(viaPath, rel.table)}
        style={{
          width:'100%', textAlign:'left', padding:'6px 8px',
          background: isExpanded ? C.cardSecondary : 'transparent',
          border:`1px solid ${C.border}`, borderRadius:6,
          fontSize:12, color:C.textPrimary, cursor:'pointer',
          display:'flex', justifyContent:'space-between', alignItems:'center',
        }}
      >
        <span>{rel.label} <span style={{ color:C.textMuted }}>({rel.table})</span></span>
        <span>{isExpanded ? '−' : '+'}</span>
      </button>
      {isExpanded && node && (
        <div style={{ paddingLeft:12, marginTop:4 }}>
          {node.columns.map(col => (
            <FieldRow
              key={col.name}
              column={col}
              onAdd={() => addField(col, rel.table, viaPath)}
            />
          ))}
          {depth + 1 < maxDepth && node.related && node.related.length > 0 && (
            <div style={{ marginTop:8 }}>
              <div style={{ fontSize:10, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 }}>
                Related to {rel.label}
              </div>
              {node.related.map(childRel => (
                <RelatedObjectNode
                  key={childRel.fk_column}
                  rel={childRel}
                  viaPath={[...viaPath, childRel.fk_column]}
                  expandedRelated={expandedRelated}
                  onExpandRelated={onExpandRelated}
                  addField={addField}
                  depth={depth + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
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

function FiltersTab({ report, updateReport, filters, setFilters, primaryObject, fieldTree, primaryOptions }) {
  const addFilter = () => {
    setFilters([...filters, { field_name:'', field_table:primaryObject, operator:'equals', value:'' }])
  }
  const addCrossFilter = () => {
    setFilters([...filters, {
      is_cross_filter: true,
      cross_object:    '',
      cross_match:     'with',
      cross_subfilters: [],
    }])
  }
  const updateFilter = (idx, patch) => {
    setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const removeFilter = (idx) => setFilters(filters.filter((_, i) => i !== idx))

  return (
    <div style={card()}>
      <div style={cardHeader()}>
        <span>Filters ({filters.length})</span>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={addFilter}      style={btnSecondary(false, 'small')}>+ Filter</button>
          <button onClick={addCrossFilter} style={btnSecondary(false, 'small')}>+ Cross-Filter</button>
        </div>
      </div>
      <div style={{ padding:12 }}>
        {filters.length === 0 ? (
          <div style={emptyState()}>No filters yet. Click "+ Filter" to add a field filter, or "+ Cross-Filter" to filter by related records.</div>
        ) : (
          <>
            {filters.map((f, idx) => (
              <div key={idx} style={{ marginBottom:12, paddingBottom:8, borderBottom:`1px solid ${C.border}` }}>
                {f.is_cross_filter ? (
                  <CrossFilterRow
                    filter={f}
                    idx={idx}
                    primaryObject={primaryObject}
                    primaryOptions={primaryOptions}
                    onUpdate={(patch) => updateFilter(idx, patch)}
                    onRemove={() => removeFilter(idx)}
                  />
                ) : (
                  <RegularFilterRow
                    filter={f}
                    idx={idx}
                    fieldTree={fieldTree}
                    primaryObject={primaryObject}
                    onUpdate={(patch) => updateFilter(idx, patch)}
                    onRemove={() => removeFilter(idx)}
                  />
                )}
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

// ─── Filter row components ────────────────────────────────────────────────

function RegularFilterRow({ filter: f, idx, fieldTree, onUpdate, onRemove, primaryObject }) {
  const [valueOpts, setValueOpts] = useState({ kind: null, options: [] })
  const [valueLoading, setValueLoading] = useState(false)

  // Operators that compare against a discrete value (where a value picker
  // makes sense). Range/null/relative-date operators skip the picker.
  const VALUE_PICKER_OPS = new Set(['equals', 'not_equals'])
  const NO_VALUE_OPS = new Set(['is_null', 'is_not_null', 'this_month', 'this_year'])

  useEffect(() => {
    let cancelled = false
    if (!f.field_name || !primaryObject || !VALUE_PICKER_OPS.has(f.operator)) {
      setValueOpts({ kind: null, options: [] })
      return
    }
    setValueLoading(true)
    loadFilterValueOptions(primaryObject, f.field_name)
      .then(res => { if (!cancelled) setValueOpts(res || { kind: null, options: [] }) })
      .catch(() => { if (!cancelled) setValueOpts({ kind: null, options: [] }) })
      .finally(() => { if (!cancelled) setValueLoading(false) })
    return () => { cancelled = true }
  }, [f.field_name, f.operator, primaryObject]) // eslint-disable-line react-hooks/exhaustive-deps

  const showValuePicker = VALUE_PICKER_OPS.has(f.operator) && valueOpts.kind !== null && valueOpts.options.length > 0
  const hideValue = NO_VALUE_OPS.has(f.operator)

  return (
    <>
      <div style={{
        display:'grid', gridTemplateColumns:'30px 1fr 140px 1fr 30px',
        gap:8, alignItems:'center',
      }}>
        <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
        <SearchableCombo
          value={f.field_name || ''}
          options={columnsToOptions(fieldTree?.primary?.columns)}
          onChange={v => onUpdate({ field_name: v, value: '' })}
          placeholder="— Field —"
        />
        <select
          value={f.operator}
          onChange={e => onUpdate({ operator: e.target.value })}
          style={inputStyle()}
        >
          {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        {hideValue ? (
          <div style={{ fontSize:11, color:C.textMuted, fontStyle:'italic', alignSelf:'center' }}>
            No value needed
          </div>
        ) : showValuePicker ? (
          <SearchableCombo
            value={f.value || ''}
            options={valueOpts.options}
            loading={valueLoading}
            onChange={v => onUpdate({ value: v })}
            placeholder={f.is_runtime_prompt ? 'Default value (optional)' : 'Value'}
            allowFreeText
          />
        ) : (
          <input
            type="text"
            value={f.value || ''}
            onChange={e => onUpdate({ value: e.target.value })}
            placeholder={f.is_runtime_prompt ? 'Default value (optional)' : (valueLoading ? 'Loading values…' : 'Value')}
            style={inputStyle()}
          />
        )}
        <button onClick={onRemove} style={miniBtn(true)}>×</button>
      </div>
      <div style={{
        display:'grid', gridTemplateColumns:'30px auto 1fr 30px',
        gap:8, alignItems:'center', marginTop:6,
      }}>
        <div></div>
        <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:C.textSecondary, cursor:'pointer' }}>
          <input
            type="checkbox"
            checked={!!f.is_runtime_prompt}
            onChange={e => onUpdate({ is_runtime_prompt: e.target.checked })}
          />
          Prompt at runtime
        </label>
        {f.is_runtime_prompt && (
          <input
            type="text"
            value={f.runtime_label || ''}
            onChange={e => onUpdate({ runtime_label: e.target.value })}
            placeholder="Label shown to user (e.g. 'Date Range')"
            style={{ ...inputStyle(), fontSize:11 }}
          />
        )}
        <div></div>
      </div>
      {f.is_runtime_prompt && (
        <div style={{
          display:'grid', gridTemplateColumns:'30px 140px 1fr 30px',
          gap:8, alignItems:'center', marginTop:6,
        }}>
          <div></div>
          <select
            value={f.prompt_input_type || 'text'}
            onChange={e => onUpdate({ prompt_input_type: e.target.value })}
            style={{ ...inputStyle(), fontSize:11 }}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="datetime">Date & Time</option>
            <option value="select">Select (preset values)</option>
          </select>
          {f.prompt_input_type === 'select' ? (
            <input
              type="text"
              value={(f.prompt_options || []).join(', ')}
              onChange={e => onUpdate({ prompt_options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="Preset values (comma-separated, e.g. open, closed, in_progress)"
              style={{ ...inputStyle(), fontSize:11 }}
            />
          ) : (
            <div style={{ fontSize:10, color:C.textMuted, fontStyle:'italic', alignSelf:'center' }}>
              Input type for the runtime prompt modal.
            </div>
          )}
          <div></div>
        </div>
      )}
    </>
  )
}

function CrossFilterRow({ filter: f, idx, primaryObject, primaryOptions, onUpdate, onRemove }) {
  const subfilters = f.cross_subfilters || []
  // Lazy-loaded columns of the chosen cross object — used to populate
  // each sub-filter's field dropdown. Reloaded whenever cross_object
  // changes; cleared when the user picks a different one.
  const [crossColumns, setCrossColumns] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!f.cross_object) { setCrossColumns([]); return }
    listObjectColumns(f.cross_object)
      .then(cols => { if (!cancelled) setCrossColumns(cols) })
      .catch(err => { if (!cancelled) { console.warn('cross object columns load failed:', err); setCrossColumns([]) } })
    return () => { cancelled = true }
  }, [f.cross_object])

  const addSubfilter = () => {
    onUpdate({ cross_subfilters: [...subfilters, { field_name:'', operator:'equals', value:'' }] })
  }
  const updateSubfilter = (sIdx, patch) => {
    onUpdate({ cross_subfilters: subfilters.map((s, i) => i === sIdx ? { ...s, ...patch } : s) })
  }
  const removeSubfilter = (sIdx) => {
    onUpdate({ cross_subfilters: subfilters.filter((_, i) => i !== sIdx) })
  }

  return (
    <div style={{ background: C.cardSecondary, borderRadius:6, padding:10 }}>
      <div style={{
        display:'grid', gridTemplateColumns:'30px 100px 1fr 30px',
        gap:8, alignItems:'center',
      }}>
        <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
        <select
          value={f.cross_match || 'with'}
          onChange={e => onUpdate({ cross_match: e.target.value })}
          style={inputStyle()}
        >
          <option value="with">with</option>
          <option value="without">without</option>
        </select>
        <select
          value={f.cross_object || ''}
          onChange={e => onUpdate({ cross_object: e.target.value })}
          style={inputStyle()}
        >
          <option value="">— Related Object —</option>
          {(primaryOptions || []).filter(o => o.table !== primaryObject).map(o => (
            <option key={o.table} value={o.table}>{o.label}</option>
          ))}
        </select>
        <button onClick={onRemove} style={miniBtn(true)}>×</button>
      </div>

      <div style={{ marginTop:8, paddingLeft:38 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
          <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>
            Sub-filters on {f.cross_object || '...'}
          </div>
          <button onClick={addSubfilter} disabled={!f.cross_object} style={btnSecondary(!f.cross_object, 'small')}>
            + Sub-filter
          </button>
        </div>
        {subfilters.length === 0 ? (
          <div style={{ fontSize:11, color:C.textMuted, fontStyle:'italic', padding:'4px 0' }}>
            No sub-filters. Will match any {f.cross_object || 'related'} record.
          </div>
        ) : subfilters.map((sf, sIdx) => (
          <div key={sIdx} style={{
            display:'grid', gridTemplateColumns:'1fr 130px 1fr 30px',
            gap:6, marginBottom:6, alignItems:'center',
          }}>
            <select
              value={sf.field_name || ''}
              onChange={e => updateSubfilter(sIdx, { field_name: e.target.value })}
              style={{ ...inputStyle(), fontSize:11 }}
              disabled={crossColumns.length === 0}
            >
              <option value="">{crossColumns.length === 0 ? 'Loading…' : '— Field —'}</option>
              {crossColumns.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              value={sf.operator || 'equals'}
              onChange={e => updateSubfilter(sIdx, { operator: e.target.value })}
              style={{ ...inputStyle(), fontSize:11 }}
            >
              {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
            </select>
            <input
              type="text"
              value={sf.value || ''}
              onChange={e => updateSubfilter(sIdx, { value: e.target.value })}
              placeholder="Value"
              style={{ ...inputStyle(), fontSize:11 }}
            />
            <button onClick={() => removeSubfilter(sIdx)} style={miniBtn(true)}>×</button>
          </div>
        ))}
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
              <SearchableCombo
                value={g.field_name}
                options={columnsToOptions(fieldTree?.primary?.columns)}
                onChange={v => updateGrouping(idx, { field_name: v })}
                placeholder="— Field —"
              />
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
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
              <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>
                Column Groupings (Matrix only — up to 3)
              </div>
              <button
                onClick={() => {
                  const cols = report.rpt_column_groupings || []
                  if (cols.length >= 3) { alert('Maximum 3 column groupings.'); return }
                  updateReport({
                    rpt_column_groupings: [
                      ...cols,
                      { name: '', sort_direction: 'asc' },
                    ],
                  })
                }}
                style={btnSecondary(false, 'small')}
              >+ Add Column Grouping</button>
            </div>

            {(report.rpt_column_groupings || []).length === 0 ? (
              <div style={emptyState()}>
                No column groupings yet. A Matrix report needs at least one
                column grouping to pivot.
              </div>
            ) : (
              (report.rpt_column_groupings || []).map((cg, idx) => (
                <div key={idx} style={{
                  display:'grid', gridTemplateColumns:'30px 1fr 100px 30px',
                  gap:8, marginBottom:8, alignItems:'center',
                }}>
                  <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
                  <SearchableCombo
                    value={cg.name}
                    options={columnsToOptions(fieldTree?.primary?.columns)}
                    onChange={v => {
                      const cols = [...(report.rpt_column_groupings || [])]
                      cols[idx] = { ...cols[idx], name: v }
                      updateReport({ rpt_column_groupings: cols })
                    }}
                    placeholder="— Field —"
                  />
                  <select
                    value={cg.sort_direction || 'asc'}
                    onChange={e => {
                      const cols = [...(report.rpt_column_groupings || [])]
                      cols[idx] = { ...cols[idx], sort_direction: e.target.value }
                      updateReport({ rpt_column_groupings: cols })
                    }}
                    style={inputStyle()}
                  >
                    <option value="asc">Asc</option>
                    <option value="desc">Desc</option>
                  </select>
                  <button onClick={() => {
                    const cols = (report.rpt_column_groupings || []).filter((_, i) => i !== idx)
                    updateReport({ rpt_column_groupings: cols })
                  }} style={miniBtn(true)}>×</button>
                </div>
              ))
            )}

            <div style={{ marginTop:16, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
              <label style={fieldLabel()}>Summary Measure</label>
              <div style={{ display:'grid', gridTemplateColumns:'140px 1fr', gap:8 }}>
                <select
                  value={(report.rpt_charts?.[0]?.measure_type) || 'count'}
                  onChange={e => {
                    const charts = report.rpt_charts || []
                    const first = { ...(charts[0] || {}), measure_type: e.target.value }
                    updateReport({ rpt_charts: [first, ...charts.slice(1)] })
                  }}
                  style={inputStyle()}
                >
                  <option value="count">Count</option>
                  <option value="sum">Sum of</option>
                  <option value="avg">Average of</option>
                  <option value="min">Min of</option>
                  <option value="max">Max of</option>
                </select>
                <SearchableCombo
                  value={(report.rpt_charts?.[0]?.measure_field) || ''}
                  disabled={(report.rpt_charts?.[0]?.measure_type) === 'count' || !report.rpt_charts?.[0]?.measure_type}
                  options={columnsToOptions(fieldTree?.primary?.columns)}
                  onChange={v => {
                    const charts = report.rpt_charts || []
                    const first = { ...(charts[0] || {}), measure_field: v }
                    updateReport({ rpt_charts: [first, ...charts.slice(1)] })
                  }}
                  placeholder="— Field (not needed for Count) —"
                />
              </div>
              <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
                What goes in each cell of the matrix. Count is the row count;
                Sum/Avg/Min/Max apply to a numeric field.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Calculated Fields tab ────────────────────────────────────────────────


function CalcFieldsTab({ calculatedFields, setCalculatedFields, report }) {
  const fieldNames = (report?.rpt_selected_fields || []).map(f => f.name)
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
              <Suspense fallback={<div style={{ fontSize:12, color:C.textMuted, padding:'8px 0' }}>Loading editor…</div>}>
                <FormulaEditor
                  value={c.expression}
                  fields={fieldNames}
                  onChange={(expr) => update(idx, { expression: expr })}
                />
              </Suspense>
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

// Turn a raw column name into a readable label, e.g. opportunity_state →
// "Opportunity State". Keeps the raw name available as secondary text so the
// user can still search/recognise the underlying column.
function humanizeFieldName(name) {
  return String(name)
    .replace(/_/g, ' ')
    .replace(/\bid\b/i, 'ID')
    .replace(/\b\w/g, m => m.toUpperCase())
}

function columnsToOptions(columns) {
  return (columns || []).map(c => ({
    value: c.name,
    label: humanizeFieldName(c.name),
    secondary: c.name,
  }))
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
    background: danger ? '#e8f1fb' : C.card, color: danger ? '#7eb3e8' : C.textPrimary,
    border: `1px solid ${danger ? '#e8f1fb' : C.border}`, borderRadius: 4, cursor: 'pointer',
  }
}

function emptyState() {
  return {
    padding: '24px 12px', textAlign: 'center',
    fontSize: 12, color: C.textMuted, fontStyle: 'italic',
  }
}
