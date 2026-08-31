import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from '../components/UI'
import SearchableCombo from '../components/SearchableCombo'
import AnchoredPopover from '../components/AnchoredPopover'
import { describeSaveError } from '../lib/saveErrorMessage'
import { classifyCalcFields, describeIncompleteCalcFields } from '../lib/reportCalcFields'
import { guessPrefix } from '../data/fieldMetadataService'
import {
  deriveReportColumnLabel,
  resolveReportColumnLabels,
  objectSingularLabel,
} from '../lib/reportColumnLabels'
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
import {
  operatorsForKind, defaultOperatorForKind, operatorMeta,
  operatorNeedsValue, operatorIsRange, operatorIsMulti,
  toValueArray, parseFilterLogic, defaultFilterLogic, remapFilterLogic,
  DATE_LITERALS, isDateLiteral, parseDateLiteral, dateLiteralLabel,
} from '../lib/reportFilters'
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
  // A LOAD failure replaces the screen — there is nothing to edit. A SAVE
  // failure must not: the user's unsaved work is still on screen and throwing
  // the editor away to show a database error loses it.
  const [saveError, setSaveError]   = useState(null)
  const [saveDetailOpen, setSaveDetailOpen] = useState(false)
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
    rpt_row_limit:        null,
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
            // Headers are re-resolved on load, so the Fields tab shows the
            // same names the viewer does — a report saved before 2026-08-25
            // stored the bare label ("Name") for every object's name field.
            rpt_selected_fields:  resolveReportColumnLabels(
              loaded.report.rpt_selected_fields || [],
              { primaryObject: loaded.report.rpt_primary_object, prefixFor: guessPrefix }),
            rpt_filter_logic:     loaded.report.rpt_filter_logic || 'all',
            rpt_sort_config:      loaded.report.rpt_sort_config || [],
            rpt_column_groupings: loaded.report.rpt_column_groupings || [],
            rpt_runtime_prompts:  loaded.report.rpt_runtime_prompts || [],
            rpt_charts:           loaded.report.rpt_charts || [],
            rpt_row_limit:        loaded.report.rpt_row_limit ?? null,
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
            group_filter_op:    g.rgr_group_filter_op,
            group_filter_value: g.rgr_group_filter_value,
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

  // Everything that names a column goes through the one shared rule, with
  // the platform's column-prefix map as its authority on how an object
  // prefixes its own columns.
  const labelOpts = { primaryObject: report.rpt_primary_object, prefixFor: guessPrefix }

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

  // Bulk-load every DIRECT related object's columns (non-toggling), so a field
  // search can span the whole object graph one hop out — Salesforce-style, the
  // search box reaches related-object fields, not just the primary object's.
  // Deeper hops stay expand-driven. Returns once all are resolved.
  const loadAllRelatedFields = async () => {
    const rels = fieldTree?.related || []
    const missing = rels.filter(rel => !expandedRelated[rel.fk_column])
    if (missing.length === 0) return
    const loaded = await Promise.all(missing.map(async rel => {
      try {
        return [rel.fk_column, await loadRelatedObjectFields(rel.table, [rel.fk_column])]
      } catch (err) {
        console.warn('related fields load failed:', rel.table, err)
        return null
      }
    }))
    setExpandedRelated(prev => {
      const next = { ...prev }
      for (const entry of loaded) { if (entry) next[entry[0]] = entry[1] }
      return next
    })
  }

  const addField = (column, table, viaPath = null) => {
    const exists = report.rpt_selected_fields.some(f =>
      f.name === column.name && f.table === table &&
      JSON.stringify(f.via_path || null) === JSON.stringify(viaPath))
    if (exists) return
    const newField = {
      name:     column.name,
      table:    table,
      via_path: viaPath,
      type:     column.type,
    }
    // The header is derived by the shared rule, then the whole set is
    // re-resolved so a new column that collides with one already on the
    // report widens both — a report never shows two columns headed alike.
    newField.label = deriveReportColumnLabel(newField, labelOpts)
    updateReport({
      rpt_selected_fields: resolveReportColumnLabels(
        [...report.rpt_selected_fields, newField], labelOpts),
    })
  }

  const removeField = (idx) => {
    // Re-resolved after the removal: a header widened only because two
    // columns collided goes back to its short form once the clash is gone.
    updateReport({
      rpt_selected_fields: resolveReportColumnLabels(
        report.rpt_selected_fields.filter((_, i) => i !== idx), labelOpts),
    })
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
    // A calculated-field row that was added and never filled in is not a field:
    // saved, it becomes a nameless column of em dashes on every report run.
    // One that is HALF filled in is someone's unfinished work, so it stops the
    // save with a message instead of being thrown away.
    const calc = classifyCalcFields(calculatedFields)
    if (calc.incomplete.length > 0) {
      setSaveError({ message: describeIncompleteCalcFields(calc.incomplete) })
      return
    }
    if (calc.dropped.length > 0) setCalculatedFields(calc.keep)
    setSaving(true); setSaveError(null); setSaveDetailOpen(false)
    try {
      const newId = await saveReport({
        id: reportId, report, filters, groupings, calculatedFields: calc.keep,
      })
      setSavedAt(new Date())
      setPreviewNonce(n => n + 1)
      onSaved?.(newId)
    } catch (err) {
      setSaveError(describeSaveError(err, { object: 'report' }))
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
    // Same rule as Save — a clone must not carry an empty calculated field
    // into a brand-new report.
    const calc = classifyCalcFields(calculatedFields)
    if (calc.incomplete.length > 0) {
      setSaveError({ message: describeIncompleteCalcFields(calc.incomplete) })
      return
    }
    if (calc.dropped.length > 0) setCalculatedFields(calc.keep)
    setSaving(true); setSaveError(null); setSaveDetailOpen(false)
    try {
      // Step 1 — persist current edits to the source. saveReport handles
      // both insert and update; for an existing record it updates in place.
      await saveReport({ id: reportId, report, filters, groupings, calculatedFields: calc.keep })
      // Step 2 — clone the now-up-to-date source.
      const newId = await cloneReport(reportId)
      setSavedAt(new Date())
      onSaved?.(newId)
    } catch (err) {
      setSaveError(describeSaveError(err, { object: 'report' }))
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

      {/* A save that failed says so here, with the editor and every unsaved
          change left exactly where they were. Never a full-screen error —
          that reads as "your report is gone" and takes the work with it. */}
      {saveError && (
        <div style={{
          background:'#eef4fb', borderBottom:`1px solid ${C.border}`,
          padding:'10px 24px', display:'flex', alignItems:'flex-start', gap:10,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1a5a8a" strokeWidth={2}
               strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, color:C.textPrimary }}>{saveError.message}</div>
            <button
              onClick={() => setSaveDetailOpen(o => !o)}
              style={{
                background:'none', border:'none', padding:'2px 0', cursor:'pointer',
                fontSize:11, color:'#1a5a8a', textDecoration:'underline',
              }}
            >{saveDetailOpen ? 'Hide details' : 'Show details'}</button>
            {saveDetailOpen && (
              <div style={{
                fontSize:11, color:C.textSecondary, fontFamily:'JetBrains Mono, monospace',
                marginTop:4, wordBreak:'break-word',
              }}>{saveError.detail}</div>
            )}
          </div>
          <button onClick={() => setSaveError(null)} style={{
            background:'none', border:'none', cursor:'pointer', color:C.textMuted,
            fontSize:16, lineHeight:1, padding:2,
          }} title="Dismiss">×</button>
        </div>
      )}

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
                onLoadAllRelated={loadAllRelatedFields}
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
                expandedRelated={expandedRelated}
                onExpandRelated={handleExpandRelated}
              />
            )}
            {tab === 'groupings' && (
              <GroupingsTab
                report={report} updateReport={updateReport}
                groupings={groupings} setGroupings={setGroupings}
                fieldTree={fieldTree}
                primaryObject={report.rpt_primary_object}
                expandedRelated={expandedRelated}
                onExpandRelated={handleExpandRelated}
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
  fieldTree, expandedRelated, onExpandRelated, onLoadAllRelated,
  addField, removeField, moveField, reorderFields,
}) {
  const [search, setSearch] = useState('')
  const [loadingAll, setLoadingAll] = useState(false)
  const primaryObject = report.rpt_primary_object
  const primaryLabel = primaryOptions.find(o => o.table === primaryObject)?.label || primaryObject

  // First keystroke pulls in every direct related object so the search spans
  // the whole one-hop graph, not just the fields already expanded.
  useEffect(() => {
    if (!search.trim() || !fieldTree?.related?.length) return
    let cancelled = false
    setLoadingAll(true)
    Promise.resolve(onLoadAllRelated?.())
      .finally(() => { if (!cancelled) setLoadingAll(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, fieldTree])

  // Flatten the searchable universe: primary columns + every loaded related
  // object's columns, each tagged with its object label and via_path.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const out = []
    const match = (col) => (col.label || col.name).toLowerCase().includes(q) || col.name.toLowerCase().includes(q)
    for (const col of (fieldTree?.primary?.columns || [])) {
      if (match(col)) out.push({ col, table: primaryObject, viaPath: null, objectLabel: primaryLabel })
    }
    for (const [key, node] of Object.entries(expandedRelated || {})) {
      const viaPath = key.split('.')
      const objectLabel = node?.table ? humanizeFieldName(node.table.replace(/s$/, '')) : viaPath[viaPath.length - 1]
      for (const col of (node?.columns || [])) {
        if (match(col)) out.push({ col, table: node.table, viaPath, objectLabel, via: viaPath })
      }
    }
    return out
  }, [search, fieldTree, expandedRelated, primaryObject, primaryLabel])

  const isSelected = (name, table, viaPath) => report.rpt_selected_fields.some(f =>
    f.name === name && f.table === table &&
    JSON.stringify(f.via_path || null) === JSON.stringify(viaPath || null))

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>
      {/* Left: primary object picker + field tree */}
      <div style={card()}>
        <div style={cardHeader()}>Available Fields</div>
        <div style={{ padding:12 }}>
          <label style={fieldLabel()}>Primary Object</label>
          <select
            value={primaryObject}
            onChange={e => { updateReport({ rpt_primary_object: e.target.value, rpt_selected_fields: [] }); setSearch('') }}
            style={inputStyle()}
          >
            <option value="">— Select —</option>
            {/* Grouped by module, because the list is now every object the
                platform has rather than a curated handful — a flat list of 114
                is a list nobody can find anything in. */}
            {Object.entries(
              primaryOptions.reduce((groups, o) => {
                const m = o.module || 'Other'
                ;(groups[m] = groups[m] || []).push(o)
                return groups
              }, {})
            ).map(([moduleName, objects]) => (
              <optgroup key={moduleName} label={moduleName}>
                {objects.map(o => (
                  <option key={o.table} value={o.table}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {fieldTree?.primary && (
            <>
              {/* Field search — spans the primary object and every related
                  object reachable from it. */}
              <div style={{ position:'relative', marginTop:14 }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={`Search ${primaryLabel} and related fields…`}
                  style={{ ...inputStyle(), paddingRight: search ? 30 : 10 }}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    title="Clear search"
                    style={{
                      position:'absolute', right:6, top:'50%', transform:'translateY(-50%)',
                      border:'none', background:'transparent', cursor:'pointer',
                      color:C.textMuted, fontSize:15, lineHeight:1, padding:4,
                    }}
                  >×</button>
                )}
              </div>

              {searchResults !== null ? (
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:11, color:C.textMuted, marginBottom:6 }}>
                    {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
                    {loadingAll && <span style={{ marginLeft:6, fontStyle:'italic' }}>· loading related objects…</span>}
                  </div>
                  {searchResults.length === 0 && !loadingAll ? (
                    <div style={emptyState()}>No matching fields.</div>
                  ) : (
                    searchResults.map((r, i) => (
                      <FieldRow
                        key={`${r.table}-${(r.viaPath || []).join('>')}-${r.col.name}-${i}`}
                        column={r.col}
                        objectLabel={r.objectLabel}
                        via={r.viaPath}
                        selected={isSelected(r.col.name, r.table, r.viaPath)}
                        onAdd={() => addField(r.col, r.table, r.viaPath)}
                      />
                    ))
                  )}
                </div>
              ) : (
                <div style={{ marginTop:16 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:C.textSecondary, marginBottom:6 }}>
                    {primaryLabel}
                  </div>
                  {fieldTree.primary.columns.map(col => (
                    <FieldRow key={col.name} column={col}
                      selected={isSelected(col.name, primaryObject, null)}
                      onAdd={() => addField(col, primaryObject)} />
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
            </>
          )}
        </div>
      </div>

      {/* Right: selected fields */}
      <div style={card()}>
        <div style={cardHeader()}>
          Selected Fields ({report.rpt_selected_fields.length})
          <ReportBuilderFieldStyles />
        </div>
        <div style={{ padding:12 }}>
          {report.rpt_selected_fields.length === 0 ? (
            <div style={emptyState()}>No fields selected. Pick from the left.</div>
          ) : (
            <>
              <div style={{ fontSize:11, color:C.textMuted, marginBottom:8 }}>
                Drag <strong>⠿</strong> to reorder columns · the <strong>Total</strong> dropdown totals the column — a
                footer on a Tabular report, the subtotal and Grand Total rows on a Summary report
                · <strong>◧</strong> formats the column · <strong>Remove</strong> takes the field off the report.
              </div>
              <SortableList
                items={report.rpt_selected_fields.map(f => ({ id: fieldKey(f), f }))}
                onReorder={(next) => reorderFields(next.map(x => x.f))}
                renderItem={(item, { setNodeRef, style, dragHandleProps }) => {
                  const idx = report.rpt_selected_fields.findIndex(x => fieldKey(x) === item.id)
                  const updateThisField = (patch) => {
                    const fields = report.rpt_selected_fields.map((x, i) => i === idx ? { ...x, ...patch } : x)
                    updateReport({ rpt_selected_fields: fields })
                  }
                  return (
                    <SelectedFieldRow
                      f={item.f} setNodeRef={setNodeRef} style={style}
                      dragHandleProps={dragHandleProps}
                      onUpdate={updateThisField} onRemove={() => removeField(idx)}
                    />
                  )
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// One selected-field row: label, column-summary picker, and an expandable
// Format panel (number format + decimals + conditional color rules).
function SelectedFieldRow({ f, setNodeRef, style, dragHandleProps, onUpdate, onRemove }) {
  const [open, setOpen] = useState(false)
  const numericish = ['numeric','integer','bigint','smallint','double precision','real','money','decimal'].includes(String(f.type || '').toLowerCase())
  const rules = f.conditional_rules || []
  const setRule = (i, patch) => onUpdate({ conditional_rules: rules.map((r, j) => j === i ? { ...r, ...patch } : r) })
  const addRule = () => onUpdate({ conditional_rules: [...rules, { op:'gt', value:'', color:'sky' }] })
  const removeRule = (i) => onUpdate({ conditional_rules: rules.filter((_, j) => j !== i) })
  const hasFormatting = (f.format && f.format !== 'auto') || rules.length > 0

  return (
    <div ref={setNodeRef} style={{ ...style, background:C.cardSecondary, borderRadius:6, marginBottom:6, padding:'8px 10px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <span {...dragHandleProps} title="Drag to reorder" style={{ cursor:'grab', color:C.textMuted, fontSize:14, lineHeight:1, touchAction:'none' }}>⠿</span>
        <div style={{ flex:1, fontSize:12, minWidth:0 }}>
          <div style={{ fontWeight:500, color:C.textPrimary, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{f.label}</div>
          <div style={{ color:C.textMuted, fontSize:11 }}>
            {f.via_path ? `${f.table} (via ${f.via_path.join(' → ')})` : f.table}
          </div>
        </div>
        <select
          value={f.summarize || ''}
          onChange={e => onUpdate({ summarize: e.target.value || undefined })}
          title="Column total — shown on the Tabular footer and on Summary subtotal / Grand Total rows"
          style={{ ...inputStyle(), width:104, fontSize:11, padding:'4px 6px' }}
        >
          <option value="">No total</option>
          <option value="count">Count</option>
          {numericish && <option value="sum">Sum</option>}
          {numericish && <option value="avg">Average</option>}
          {numericish && <option value="min">Min</option>}
          {numericish && <option value="max">Max</option>}
        </select>
        <button onClick={() => setOpen(o => !o)} title="Format & conditional color"
          aria-label={`Format ${f.label}`} className="rb-field-btn"
          style={{ ...miniBtn(), color: hasFormatting ? C.emerald : C.textMuted }}>◧</button>
        <button onClick={onRemove} className="rb-remove-field"
          title={`Remove ${f.label} from this report`} aria-label={`Remove ${f.label} from this report`}
          style={removeFieldBtn()}>Remove</button>
      </div>

      {open && (
        <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 90px', gap:6, alignItems:'center' }}>
            <select value={f.format || 'auto'} onChange={e => onUpdate({ format: e.target.value })} style={{ ...inputStyle(), fontSize:12 }}>
              <option value="auto">Format: Auto</option>
              <option value="number">Number</option>
              <option value="currency">Currency ($)</option>
              <option value="percent">Percent (%)</option>
              <option value="compact">Compact (1.2K)</option>
            </select>
            <input type="number" min="0" max="6" value={f.decimals ?? ''} placeholder="dec"
              onChange={e => onUpdate({ decimals: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
              style={{ ...inputStyle(), fontSize:12 }} title="Decimal places" />
          </div>
          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
              <span style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>Conditional color</span>
              <button onClick={addRule} style={btnSecondary(false, 'small')}>+ Rule</button>
            </div>
            {rules.length === 0 ? (
              <div style={{ fontSize:11, color:C.textMuted, fontStyle:'italic' }}>No color rules. Add one to highlight cells by value.</div>
            ) : rules.map((r, i) => (
              <div key={i} style={{ display:'grid', gridTemplateColumns:'70px 1fr 90px 26px', gap:6, marginBottom:6, alignItems:'center' }}>
                <select value={r.op} onChange={e => setRule(i, { op: e.target.value })} style={{ ...inputStyle(), fontSize:11 }}>
                  <option value="gt">&gt;</option>
                  <option value="gte">≥</option>
                  <option value="lt">&lt;</option>
                  <option value="lte">≤</option>
                  <option value="eq">=</option>
                  <option value="ne">≠</option>
                </select>
                <input value={r.value} onChange={e => setRule(i, { value: e.target.value })} placeholder="value"
                  style={{ ...inputStyle(), fontSize:11 }} />
                <select value={r.color} onChange={e => setRule(i, { color: e.target.value })} style={{ ...inputStyle(), fontSize:11 }}>
                  <option value="sky">Blue</option>
                  <option value="emerald">Green</option>
                  <option value="amber">Amber</option>
                  <option value="navy">Navy</option>
                </select>
                <button onClick={() => removeRule(i)} style={miniBtn(true)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
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

function FieldRow({ column, onAdd, objectLabel, via, selected }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
      padding:'5px 8px', fontSize:12, borderRadius:4, opacity: selected ? 0.55 : 1,
    }}
    onMouseEnter={e => e.currentTarget.style.background = C.cardSecondary}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <div style={{ minWidth:0 }}>
        <div style={{ color:C.textPrimary, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
          {column.label || column.name}
          {objectLabel && (
            <span style={{ color:C.textMuted, marginLeft:6, fontSize:11 }}>· {objectLabel}</span>
          )}
        </div>
        <div style={{ color:C.textMuted, fontSize:10 }}>
          {column.name}{column.type ? ` · ${column.type}` : ''}
          {via && via.length > 0 ? ` · via ${via.join(' → ')}` : ''}
        </div>
      </div>
      <button onClick={onAdd} disabled={selected} title={selected ? 'Already added' : 'Add field'}
        style={{ ...miniBtn(), opacity: selected ? 0.4 : 1, cursor: selected ? 'default' : 'pointer' }}>
        {selected ? '✓' : '+'}
      </button>
    </div>
  )
}

// ─── Filters tab ──────────────────────────────────────────────────────────
//
// Salesforce-parity filter authoring:
//   • one numbered row per filter — the number is what filter logic references
//   • the field picker spans the primary object AND its related objects
//   • operators are scoped to the field's kind (no "starts with" on a picklist)
//   • picklist and lookup filters take multiple values ("is any of")
//   • date filters accept relative literals (TODAY, LAST 90 DAYS, THIS QUARTER)
//   • filter logic is a validated boolean expression, not free text — every
//     filter must be referenced, references must exist, parens must balance
//
// The semantics live in lib/reportFilters so the builder, the server-side
// pushdown, and the client-side evaluation can never drift apart.

function FiltersTab({
  report, updateReport, filters, setFilters, primaryObject,
  fieldTree, primaryOptions, expandedRelated, onExpandRelated,
}) {
  const [addOpen, setAddOpen] = useState(false)
  const addBtnRef = useRef(null)

  const fieldCatalog = useMemo(
    () => buildFieldCatalog(primaryObject, fieldTree, expandedRelated),
    [primaryObject, fieldTree, expandedRelated],
  )
  const kindFor = (f) => {
    if (!f || f.is_cross_filter) return 'text'
    const entry = fieldCatalog.byKey.get(filterFieldKey(f))
    return entry?.kind || 'text'
  }

  const logicActive = String(report.rpt_filter_logic || 'all').trim().toLowerCase() !== 'all'
  const logicCheck  = parseFilterLogic(report.rpt_filter_logic, filters.length)

  const appendToLogic = (newIndex) => {
    if (!logicActive) return
    updateReport({ rpt_filter_logic: `${String(report.rpt_filter_logic).trim()} AND ${newIndex}` })
  }

  const addFilter = () => {
    setFilters([...filters, {
      field_name: '', field_table: primaryObject, field_via_path: null,
      operator: 'equals', value: '',
    }])
    appendToLogic(filters.length + 1)
    setAddOpen(false)
  }
  const addCrossFilter = () => {
    setFilters([...filters, {
      is_cross_filter: true, cross_object: '', cross_match: 'with', cross_subfilters: [],
    }])
    appendToLogic(filters.length + 1)
    setAddOpen(false)
  }
  const updateFilter = (idx, patch) => {
    setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const removeFilter = (idx) => {
    const next = filters.filter((_, i) => i !== idx)
    setFilters(next)
    if (logicActive) {
      // Renumber the expression around the hole the removal leaves.
      const mapping = {}
      filters.forEach((_, i) => { mapping[i + 1] = i === idx ? null : (i < idx ? i + 1 : i) })
      updateReport({ rpt_filter_logic: remapFilterLogic(report.rpt_filter_logic, mapping, next.length) })
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={card()}>
        <div style={cardHeader()}>
          <span>Filters ({filters.length})</span>
          <div style={{ position:'relative' }}>
            <button ref={addBtnRef} onClick={() => setAddOpen(o => !o)} style={btnSecondary(false, 'small')}>+ Add Filter ▾</button>
            <AnchoredPopover
              anchorRef={addBtnRef}
              open={addOpen}
              onClose={() => setAddOpen(false)}
              width={240}
              align="right"
              maxHeight={220}
            >
              <MenuItem
                title="Field Filter"
                subtitle="Filter on a field of this report"
                onClick={addFilter}
              />
              <MenuItem
                title="Cross Filter"
                subtitle="Records with / without related records"
                onClick={addCrossFilter}
              />
            </AnchoredPopover>
          </div>
        </div>
        <div style={{ padding:12 }}>
          {filters.length === 0 ? (
            <div style={emptyState()}>
              No filters — this report returns every {primaryObject || 'record'}.
              Add a field filter, or a cross filter to scope by related records.
            </div>
          ) : (
            filters.map((f, idx) => (
              <div key={idx} style={{
                marginBottom:10, padding:'10px 10px 10px 0',
                borderBottom: idx === filters.length - 1 ? 'none' : `1px solid ${C.border}`,
              }}>
                {f.is_cross_filter ? (
                  <CrossFilterRow
                    filter={f} idx={idx}
                    primaryObject={primaryObject}
                    primaryOptions={primaryOptions}
                    onUpdate={(patch) => updateFilter(idx, patch)}
                    onRemove={() => removeFilter(idx)}
                  />
                ) : (
                  <FieldFilterRow
                    filter={f} idx={idx}
                    kind={kindFor(f)}
                    fieldCatalog={fieldCatalog}
                    primaryObject={primaryObject}
                    onExpandRelated={onExpandRelated}
                    onUpdate={(patch) => updateFilter(idx, patch)}
                    onRemove={() => removeFilter(idx)}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Filter logic — Salesforce's "Add Filter Logic" panel */}
      <div style={card()}>
        <div style={cardHeader()}>
          <span>Filter Logic</span>
          {filters.length > 0 && (
            logicActive ? (
              <button
                onClick={() => updateReport({ rpt_filter_logic: 'all' })}
                style={btnSecondary(false, 'small')}
              >Remove Filter Logic</button>
            ) : (
              <button
                onClick={() => updateReport({ rpt_filter_logic: defaultFilterLogic(filters.length) })}
                style={btnSecondary(false, 'small')}
              >Add Filter Logic</button>
            )
          )}
        </div>
        <div style={{ padding:12 }}>
          {filters.length === 0 ? (
            <div style={emptyState()}>Add at least one filter to write filter logic.</div>
          ) : !logicActive ? (
            <div style={{ fontSize:12, color:C.textSecondary }}>
              Matching <strong>all</strong> filters ({filters.map((_, i) => i + 1).join(' AND ')}).
              Add filter logic to combine them with OR, NOT, and parentheses.
            </div>
          ) : (
            <>
              <input
                type="text"
                value={report.rpt_filter_logic}
                onChange={e => updateReport({ rpt_filter_logic: e.target.value })}
                placeholder="e.g. 1 AND (2 OR 3)"
                style={{
                  ...inputStyle(),
                  fontFamily:'JetBrains Mono, monospace',
                  borderColor: logicCheck.ok ? C.border : C.sky,
                }}
              />
              <div style={{ fontSize:11, marginTop:6, color: logicCheck.ok ? C.textMuted : C.sky }}>
                {logicCheck.ok
                  ? `Reference each filter by its number. Operators: AND, OR, NOT, and parentheses.`
                  : logicCheck.error}
              </div>
              <div style={{ marginTop:8, display:'flex', flexWrap:'wrap', gap:6 }}>
                {filters.map((f, i) => (
                  <span key={i} style={{
                    fontSize:11, padding:'3px 8px', borderRadius:10,
                    background:C.cardSecondary, border:`1px solid ${C.border}`, color:C.textSecondary,
                  }}>
                    <strong style={{ fontFamily:'JetBrains Mono, monospace' }}>{i + 1}</strong>
                    {' · '}{describeFilter(f, kindFor(f))}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MenuItem({ title, subtitle, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display:'block', width:'100%', textAlign:'left', padding:'10px 12px',
        background:'transparent', border:'none', cursor:'pointer',
        borderBottom:`1px solid ${C.border}`,
      }}
      onMouseEnter={e => e.currentTarget.style.background = C.cardSecondary}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ fontSize:13, fontWeight:500, color:C.textPrimary }}>{title}</div>
      <div style={{ fontSize:11, color:C.textMuted }}>{subtitle}</div>
    </button>
  )
}

// ─── Field catalog (primary + expanded related objects) ───────────────────

function filterFieldKey(f) {
  const via = (f.field_via_path || []).join('>')
  return `${f.field_table || ''}|${f.field_name || ''}|${via}`
}

/**
 * Flatten the field tree the Fields tab already loaded into one option list
 * for the filter/grouping pickers: every primary-object column, plus the
 * columns of any related object the user has expanded. Each entry keeps the
 * table + via_path needed to persist the filter and the kind that drives its
 * operator list.
 */
function buildFieldCatalog(primaryObject, fieldTree, expandedRelated) {
  const options = []
  const byKey = new Map()
  const push = (col, table, viaPath, objectLabel) => {
    const entry = {
      value:     JSON.stringify({ n: col.name, t: table, v: viaPath || null }),
      label:     objectLabel ? `${objectLabel}: ${col.label || col.name}` : (col.label || col.name),
      secondary: col.name,
      name:      col.name,
      table,
      via_path:  viaPath || null,
      kind:      col.kind || 'text',
      type:      col.type,
    }
    options.push(entry)
    byKey.set(`${table || ''}|${col.name}|${(viaPath || []).join('>')}`, entry)
  }

  for (const col of (fieldTree?.primary?.columns || [])) {
    push(col, primaryObject, null, null)
  }
  for (const [key, node] of Object.entries(expandedRelated || {})) {
    const viaPath = key.split('.')
    // Singularize properly — `.replace(/s$/,'')` turned "properties" into
    // "Propertie" in every filter and grouping picker.
    const objectLabel = node?.table
      ? objectSingularLabel(node.table)
      : humanizeFieldName(viaPath[viaPath.length - 1])
    for (const col of (node?.columns || [])) {
      push(col, node.table, viaPath, objectLabel)
    }
  }
  return { options, byKey, related: fieldTree?.related || [] }
}

// ─── Field filter row ─────────────────────────────────────────────────────

function FieldFilterRow({
  filter: f, idx, kind, fieldCatalog, primaryObject,
  onExpandRelated, onUpdate, onRemove,
}) {
  const operators = operatorsForKind(kind, f.operator)
  const needsValue = operatorNeedsValue(kind, f.operator)
  const isRange    = operatorIsRange(kind, f.operator)
  const isMulti    = operatorIsMulti(kind, f.operator)

  const selectedKey = filterFieldKey(f)
  const selectedEntry = fieldCatalog.byKey.get(selectedKey)
  const selectedValue = selectedEntry ? selectedEntry.value : ''

  const onFieldChange = (jsonValue) => {
    let parsed = null
    try { parsed = JSON.parse(jsonValue) } catch { /* free text ignored */ }
    if (!parsed) return
    const entry = fieldCatalog.byKey.get(`${parsed.t || ''}|${parsed.n}|${(parsed.v || []).join('>')}`)
    const nextKind = entry?.kind || 'text'
    // Keep the operator when it still applies to the new field's kind,
    // otherwise fall back to that kind's default. Value always resets —
    // a stage UUID means nothing on a date column.
    const stillValid = operatorsForKind(nextKind).some(o => o.op === f.operator)
    onUpdate({
      field_name:     parsed.n,
      field_table:    parsed.t,
      field_via_path: parsed.v || null,
      operator:       stillValid ? f.operator : defaultOperatorForKind(nextKind),
      value:          '',
    })
  }

  const onOperatorChange = (op) => {
    const wasMulti = operatorIsMulti(kind, f.operator)
    const nowMulti = operatorIsMulti(kind, op)
    const wasRange = operatorIsRange(kind, f.operator)
    const nowRange = operatorIsRange(kind, op)
    let value = f.value
    if (nowRange && !wasRange) value = ['', '']
    else if (!nowRange && wasRange) value = ''
    else if (nowMulti && !wasMulti) value = toValueArray(f.value)
    else if (!nowMulti && wasMulti) value = toValueArray(f.value)[0] || ''
    onUpdate({ operator: op, value })
  }

  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
      <div style={{
        width:22, height:26, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:600, color:C.textSecondary,
      }}>{idx + 1}</div>

      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:6 }}>
          <FilterFieldPicker
            value={selectedValue}
            catalog={fieldCatalog}
            onChange={onFieldChange}
            onExpandRelated={onExpandRelated}
          />
          <select
            value={f.operator}
            onChange={e => onOperatorChange(e.target.value)}
            style={inputStyle()}
            disabled={!f.field_name}
          >
            {operators.map(op => <option key={op.op} value={op.op}>{op.label}</option>)}
          </select>
        </div>

        {needsValue && (
          <FilterValueEditor
            kind={kind}
            operator={f.operator}
            value={f.value}
            table={f.field_via_path && f.field_via_path.length > 0 ? f.field_table : primaryObject}
            column={f.field_name}
            isRange={isRange}
            isMulti={isMulti}
            isPrompt={!!f.is_runtime_prompt}
            onChange={v => onUpdate({ value: v })}
          />
        )}

        <RuntimePromptControls filter={f} onUpdate={onUpdate} />
      </div>

      <button onClick={onRemove} title="Remove filter" style={miniBtn(true)}>×</button>
    </div>
  )
}

/**
 * Field picker popover — primary-object fields are listed immediately;
 * related objects expand on click (one describe call each, cached) and their
 * fields join the same searchable list. Mirrors how Salesforce lets you
 * filter on a related object's field without leaving the filter row.
 */
function FilterFieldPicker({ value, catalog, onChange, onExpandRelated }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef(null)

  const selected = catalog.options.find(o => o.value === value)
  const q = query.trim().toLowerCase()
  const matches = q
    ? catalog.options.filter(o => o.label.toLowerCase().includes(q) || o.secondary.toLowerCase().includes(q))
    : catalog.options

  return (
    <div style={{ position:'relative' }}>
      <button
        ref={triggerRef}
        onClick={() => { setOpen(o => !o); setQuery('') }}
        style={{
          ...inputStyle(), textAlign:'left', cursor:'pointer',
          color: selected ? C.textPrimary : C.textMuted,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}
      >
        {selected ? selected.label : '— Field —'}
      </button>
      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={340}
        maxHeight={380}
      >
        <div>
          <div style={{ padding:8, borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, background:C.card }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search fields…"
              style={{ ...inputStyle(), fontSize:12, padding:'6px 8px' }}
            />
          </div>
          {matches.length === 0 && (
            <div style={{ padding:'10px 12px', fontSize:12, color:C.textMuted }}>
              No matching fields. Expand a related object below to search its fields.
            </div>
          )}
          {matches.map(o => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                display:'block', width:'100%', textAlign:'left', padding:'7px 12px',
                background: o.value === value ? C.cardSecondary : 'transparent',
                border:'none', cursor:'pointer', fontSize:12, color:C.textPrimary,
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.cardSecondary}
              onMouseLeave={e => e.currentTarget.style.background = o.value === value ? C.cardSecondary : 'transparent'}
            >
              {o.label}
              <span style={{ color:C.textMuted, marginLeft:6, fontSize:11 }}>{o.secondary}</span>
            </button>
          ))}
          {(catalog.related || []).length > 0 && (
            <div style={{ borderTop:`1px solid ${C.border}`, padding:'8px 12px' }}>
              <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:0.5, color:C.textMuted, marginBottom:6 }}>
                Related Objects
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {catalog.related.map(rel => (
                  <button
                    key={rel.fk_column}
                    onClick={() => onExpandRelated?.([rel.fk_column], rel.table)}
                    style={{ ...btnSecondary(false, 'small'), fontSize:11 }}
                    title={`Load ${rel.table} fields`}
                  >
                    + {rel.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </AnchoredPopover>
    </div>
  )
}

// ─── Value editors ────────────────────────────────────────────────────────

function FilterValueEditor({ kind, operator, value, table, column, isRange, isMulti, isPrompt, onChange }) {
  const [opts, setOpts] = useState({ kind: null, options: [] })
  const [loading, setLoading] = useState(false)
  const wantsOptions = kind === 'picklist' || kind === 'lookup' || kind === 'boolean'

  useEffect(() => {
    let cancelled = false
    if (!wantsOptions || !table || !column) { setOpts({ kind: null, options: [] }); return }
    setLoading(true)
    loadFilterValueOptions(table, column)
      .then(res => { if (!cancelled) setOpts(res || { kind: null, options: [] }) })
      .catch(() => { if (!cancelled) setOpts({ kind: null, options: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [wantsOptions, table, column])

  if (isRange) {
    const arr = Array.isArray(value) ? value : ['', '']
    const setAt = (i, v) => {
      const next = [arr[0] ?? '', arr[1] ?? '']
      next[i] = v
      onChange(next)
    }
    return (
      <div style={{ display:'grid', gridTemplateColumns:'1fr 20px 1fr', gap:6, alignItems:'center' }}>
        <ScalarValueInput kind={kind} value={arr[0] ?? ''} onChange={v => setAt(0, v)} placeholder="From" />
        <div style={{ textAlign:'center', fontSize:11, color:C.textMuted }}>to</div>
        <ScalarValueInput kind={kind} value={arr[1] ?? ''} onChange={v => setAt(1, v)} placeholder="To" />
      </div>
    )
  }

  if (isMulti && wantsOptions) {
    return (
      <MultiValuePicker
        values={toValueArray(value)}
        options={opts.options}
        loading={loading}
        placeholder={isPrompt ? 'Default values (optional)' : 'Add a value…'}
        onChange={onChange}
      />
    )
  }

  if (kind === 'boolean') {
    return (
      <select value={String(value ?? '')} onChange={e => onChange(e.target.value)} style={inputStyle()}>
        <option value="">— Select —</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    )
  }

  if (wantsOptions && opts.options.length > 0) {
    return (
      <SearchableCombo
        value={value || ''}
        options={opts.options}
        loading={loading}
        onChange={onChange}
        placeholder={isPrompt ? 'Default value (optional)' : 'Value'}
        allowFreeText
      />
    )
  }

  return <ScalarValueInput kind={kind} value={value ?? ''} onChange={onChange}
    placeholder={isPrompt ? 'Default value (optional)' : (loading ? 'Loading values…' : 'Value')} />
}

/**
 * A single scalar value. Date/datetime fields get Salesforce's relative date
 * literals alongside a fixed date, so "last 90 days" stays true every time the
 * report runs instead of freezing a date into the definition.
 */
function ScalarValueInput({ kind, value, onChange, placeholder }) {
  const isDate = kind === 'date' || kind === 'datetime'
  const literal = isDateLiteral(value) ? parseDateLiteral(value) : null
  const [mode, setMode] = useState(literal ? 'relative' : 'fixed')

  useEffect(() => {
    if (isDateLiteral(value) && mode !== 'relative') setMode('relative')
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isDate) {
    return (
      <input
        type={kind === 'number' ? 'number' : 'text'}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle()}
      />
    )
  }

  const literalDef = literal ? DATE_LITERALS.find(d => d.token === literal.token) : null

  return (
    <div style={{ display:'grid', gridTemplateColumns:'96px 1fr', gap:6 }}>
      <select
        value={mode}
        onChange={e => { setMode(e.target.value); onChange(e.target.value === 'relative' ? 'TODAY' : '') }}
        style={{ ...inputStyle(), fontSize:12 }}
      >
        <option value="fixed">Fixed date</option>
        <option value="relative">Relative</option>
      </select>
      {mode === 'relative' ? (
        <div style={{ display:'grid', gridTemplateColumns: literalDef?.needsN ? '1fr 74px' : '1fr', gap:6 }}>
          <select
            value={literal?.token || 'TODAY'}
            onChange={e => {
              const def = DATE_LITERALS.find(d => d.token === e.target.value)
              onChange(def?.needsN ? `${def.token}:${literal?.n || 30}` : e.target.value)
            }}
            style={{ ...inputStyle(), fontSize:12 }}
          >
            {DATE_LITERALS.map(d => <option key={d.token} value={d.token}>{d.label}</option>)}
          </select>
          {literalDef?.needsN && (
            <input
              type="number" min="1"
              value={literal?.n ?? 30}
              onChange={e => onChange(`${literal.token}:${e.target.value || 1}`)}
              style={{ ...inputStyle(), fontSize:12 }}
              title="N"
            />
          )}
        </div>
      ) : (
        <input
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={e => onChange(e.target.value)}
          style={inputStyle()}
        />
      )}
    </div>
  )
}

/** Chips + picker for "is any of" / "is none of" multi-value filters. */
function MultiValuePicker({ values, options, loading, placeholder, onChange }) {
  const labelFor = (v) => options.find(o => String(o.value) === String(v))?.label || String(v)
  const remaining = options.filter(o => !values.some(v => String(v) === String(o.value)))
  return (
    <div>
      {values.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:6 }}>
          {values.map(v => (
            <span key={String(v)} style={{
              display:'inline-flex', alignItems:'center', gap:6,
              fontSize:11, padding:'3px 6px 3px 9px', borderRadius:12,
              background:C.cardSecondary, border:`1px solid ${C.border}`, color:C.textPrimary,
            }}>
              {labelFor(v)}
              <button
                onClick={() => onChange(values.filter(x => String(x) !== String(v)))}
                style={{
                  border:'none', background:'transparent', cursor:'pointer',
                  color:C.textMuted, fontSize:13, lineHeight:1, padding:0,
                }}
                title="Remove value"
              >×</button>
            </span>
          ))}
        </div>
      )}
      <SearchableCombo
        value=""
        options={remaining}
        loading={loading}
        onChange={v => { if (v) onChange([...values, v]) }}
        placeholder={values.length ? 'Add another value…' : placeholder}
        emptyText={loading ? 'Loading values…' : 'No values left to add'}
        allowFreeText
      />
    </div>
  )
}

/** "Prompt at runtime" — unchanged behaviour, folded into a compact row. */
function RuntimePromptControls({ filter: f, onUpdate }) {
  return (
    <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
      <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:C.textSecondary, cursor:'pointer' }}>
        <input
          type="checkbox"
          checked={!!f.is_runtime_prompt}
          onChange={e => onUpdate({ is_runtime_prompt: e.target.checked })}
        />
        Prompt at runtime
      </label>
      {f.is_runtime_prompt && (
        <>
          <input
            type="text"
            value={f.runtime_label || ''}
            onChange={e => onUpdate({ runtime_label: e.target.value })}
            placeholder="Label shown to the user (e.g. 'State')"
            style={{ ...inputStyle(), fontSize:11, flex:1, minWidth:160 }}
          />
          <select
            value={f.prompt_input_type || 'text'}
            onChange={e => onUpdate({ prompt_input_type: e.target.value })}
            style={{ ...inputStyle(), fontSize:11, width:130 }}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="datetime">Date & Time</option>
            <option value="select">Select (preset values)</option>
          </select>
          {f.prompt_input_type === 'select' && (
            <input
              type="text"
              value={(f.prompt_options || []).join(', ')}
              onChange={e => onUpdate({ prompt_options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
              placeholder="Preset values (comma-separated)"
              style={{ ...inputStyle(), fontSize:11, flex:1, minWidth:180 }}
            />
          )}
        </>
      )}
    </div>
  )
}

/** One-line summary of a filter, shown beside its number in the logic panel. */
function describeFilter(f, kind) {
  if (f.is_cross_filter) {
    return `${f.cross_match === 'without' ? 'without' : 'with'} ${f.cross_object || 'related records'}`
  }
  const field = f.field_name ? humanizeFieldName(f.field_name) : '(no field)'
  const opLabel = operatorMeta(kind, f.operator).label
  if (!operatorNeedsValue(kind, f.operator)) return `${field} ${opLabel}`
  const value = Array.isArray(f.value)
    ? (operatorIsRange(kind, f.operator)
        ? `${describeValue(f.value[0])} – ${describeValue(f.value[1])}`
        : `${f.value.length} value${f.value.length === 1 ? '' : 's'}`)
    : describeValue(f.value)
  return `${field} ${opLabel} ${value || '…'}`
}

function describeValue(v) {
  if (v == null || v === '') return '…'
  return dateLiteralLabel(v) || String(v)
}

// ─── Cross filter row ─────────────────────────────────────────────────────

function CrossFilterRow({ filter: f, idx, primaryObject, primaryOptions, onUpdate, onRemove }) {
  const subfilters = f.cross_subfilters || []
  // Columns of the chosen cross object — populates each sub-filter's field
  // picker, and carries the kind that scopes its operator list.
  const [crossColumns, setCrossColumns] = useState([])
  useEffect(() => {
    let cancelled = false
    if (!f.cross_object) { setCrossColumns([]); return }
    listObjectColumns(f.cross_object)
      .then(cols => { if (!cancelled) setCrossColumns(cols) })
      .catch(err => { if (!cancelled) { console.warn('cross object columns load failed:', err); setCrossColumns([]) } })
    return () => { cancelled = true }
  }, [f.cross_object])

  const kindOf = (name) => crossColumns.find(c => c.name === name)?.kind || 'text'

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
    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
      <div style={{
        width:22, height:26, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:600, color:C.textSecondary,
      }}>{idx + 1}</div>

      <div style={{ flex:1, minWidth:0, background:C.cardSecondary, borderRadius:6, padding:10 }}>
        <div style={{ display:'grid', gridTemplateColumns:'110px 1fr', gap:6, alignItems:'center' }}>
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
            onChange={e => onUpdate({ cross_object: e.target.value, cross_subfilters: [] })}
            style={inputStyle()}
          >
            <option value="">— Related Object —</option>
            {(primaryOptions || []).filter(o => o.table !== primaryObject).map(o => (
              <option key={o.table} value={o.table}>{o.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop:8 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ fontSize:11, color:C.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>
              Sub-filters on {f.cross_object ? humanizeFieldName(f.cross_object) : '…'}
            </div>
            <button onClick={addSubfilter} disabled={!f.cross_object} style={btnSecondary(!f.cross_object, 'small')}>
              + Sub-filter
            </button>
          </div>
          {subfilters.length === 0 ? (
            <div style={{ fontSize:11, color:C.textMuted, fontStyle:'italic', padding:'4px 0' }}>
              No sub-filters — matches any {f.cross_object ? humanizeFieldName(f.cross_object) : 'related'} record.
            </div>
          ) : subfilters.map((sf, sIdx) => {
            const kind = kindOf(sf.field_name)
            const needsValue = operatorNeedsValue(kind, sf.operator || 'equals')
            return (
              <div key={sIdx} style={{
                display:'grid',
                gridTemplateColumns: needsValue ? '1fr 130px 1fr 26px' : '1fr 130px 26px',
                gap:6, marginBottom:6, alignItems:'center',
              }}>
                <SearchableCombo
                  value={sf.field_name || ''}
                  options={crossColumns.map(c => ({ value:c.name, label:c.label || c.name, secondary:c.name }))}
                  onChange={v => {
                    const nextKind = crossColumns.find(c => c.name === v)?.kind || 'text'
                    const stillValid = operatorsForKind(nextKind).some(o => o.op === sf.operator)
                    updateSubfilter(sIdx, {
                      field_name: v,
                      operator: stillValid ? sf.operator : defaultOperatorForKind(nextKind),
                      value: '',
                    })
                  }}
                  placeholder={crossColumns.length === 0 ? 'Loading…' : '— Field —'}
                />
                <select
                  value={sf.operator || 'equals'}
                  onChange={e => updateSubfilter(sIdx, { operator: e.target.value, value: '' })}
                  style={{ ...inputStyle(), fontSize:12 }}
                >
                  {operatorsForKind(kind, sf.operator).map(op => (
                    <option key={op.op} value={op.op}>{op.label}</option>
                  ))}
                </select>
                {needsValue && (
                  <FilterValueEditor
                    kind={kind}
                    operator={sf.operator || 'equals'}
                    value={sf.value}
                    table={f.cross_object}
                    column={sf.field_name}
                    isRange={operatorIsRange(kind, sf.operator || 'equals')}
                    isMulti={operatorIsMulti(kind, sf.operator || 'equals')}
                    onChange={v => updateSubfilter(sIdx, { value: v })}
                  />
                )}
                <button onClick={() => removeSubfilter(sIdx)} style={miniBtn(true)}>×</button>
              </div>
            )
          })}
        </div>
      </div>

      <button onClick={onRemove} title="Remove filter" style={miniBtn(true)}>×</button>
    </div>
  )
}

// ─── Groupings tab ────────────────────────────────────────────────────────

// Date-bucketing grains offered when a grouping field is a date/datetime.
const DATE_GRAINS = [
  { value: '',        label: 'Exact date' },
  { value: 'day',     label: 'Day' },
  { value: 'week',    label: 'Week' },
  { value: 'month',   label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year',    label: 'Year' },
]

function GroupingsTab({ report, updateReport, groupings, setGroupings, fieldTree, primaryObject, expandedRelated, onExpandRelated }) {
  const formatLabel = report.rpt_format
  const fieldCatalog = useMemo(
    () => buildFieldCatalog(primaryObject, fieldTree, expandedRelated),
    [primaryObject, fieldTree, expandedRelated],
  )
  const kindOfGrouping = (g) => {
    const entry = fieldCatalog.byKey.get(`${g.field_table || ''}|${g.field_name || ''}|${(g.field_via_path || []).join('>')}`)
    return entry?.kind || 'text'
  }

  const addGrouping = () => {
    if (groupings.length >= 6) { alert('Maximum 6 row groupings.'); return }
    setGroupings([...groupings, { field_name:'', field_table:primaryObject, field_via_path:null, sort_direction:'asc', sort_by_aggregate:'value', show_subtotal:true }])
  }
  const updateGrouping = (idx, patch) => {
    setGroupings(groupings.map((g, i) => i === idx ? { ...g, ...patch } : g))
  }
  const removeGrouping = (idx) => setGroupings(groupings.filter((_, i) => i !== idx))

  // Grouping ⇄ field-catalog value bridge (same JSON shape as the filter picker).
  const groupingCatalogValue = (g) => {
    const entry = fieldCatalog.byKey.get(`${g.field_table || ''}|${g.field_name || ''}|${(g.field_via_path || []).join('>')}`)
    return entry ? entry.value : ''
  }
  const onGroupingFieldChange = (idx, jsonValue) => {
    let parsed = null
    try { parsed = JSON.parse(jsonValue) } catch { /* ignore */ }
    if (!parsed) return
    updateGrouping(idx, { field_name: parsed.n, field_table: parsed.t, field_via_path: parsed.v || null, date_granularity: null })
  }

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
          groupings.map((g, idx) => {
            const kind = kindOfGrouping(g)
            const isDate = kind === 'date' || kind === 'datetime'
            return (
              <div key={idx} style={{ marginBottom:12, paddingBottom:10, borderBottom: idx === groupings.length - 1 ? 'none' : `1px solid ${C.border}` }}>
                <div style={{ display:'grid', gridTemplateColumns:'26px 1fr 30px', gap:8, alignItems:'center' }}>
                  <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
                  <FilterFieldPicker
                    value={groupingCatalogValue(g)}
                    catalog={fieldCatalog}
                    onChange={v => onGroupingFieldChange(idx, v)}
                    onExpandRelated={onExpandRelated}
                  />
                  <button onClick={() => removeGrouping(idx)} style={miniBtn(true)}>×</button>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'26px 1fr 1fr auto', gap:8, alignItems:'center', marginTop:6 }}>
                  <div />
                  {isDate ? (
                    <select
                      value={g.date_granularity || ''}
                      onChange={e => updateGrouping(idx, { date_granularity: e.target.value || null })}
                      style={{ ...inputStyle(), fontSize:12 }}
                      title="Bucket this date grouping"
                    >
                      {DATE_GRAINS.map(gr => <option key={gr.value} value={gr.value}>{gr.label}</option>)}
                    </select>
                  ) : <div />}
                  <select
                    value={`${g.sort_by_aggregate || 'value'}:${g.sort_direction || 'asc'}`}
                    onChange={e => {
                      const [by, dir] = e.target.value.split(':')
                      updateGrouping(idx, { sort_by_aggregate: by, sort_direction: dir })
                    }}
                    style={{ ...inputStyle(), fontSize:12 }}
                    title="How to order the groups"
                  >
                    <option value="value:asc">Group value ↑</option>
                    <option value="value:desc">Group value ↓</option>
                    <option value="count:desc">Record count ↓</option>
                    <option value="count:asc">Record count ↑</option>
                    <option value="measure:desc">Measure ↓</option>
                    <option value="measure:asc">Measure ↑</option>
                  </select>
                  <label style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:C.textPrimary, whiteSpace:'nowrap' }}>
                    <input type="checkbox" checked={g.show_subtotal !== false}
                      onChange={e => updateGrouping(idx, { show_subtotal: e.target.checked })} />
                    Subtotal
                  </label>
                </div>
                {/* HAVING — keep only groups whose measure passes the test. */}
                <div style={{ display:'grid', gridTemplateColumns:'26px auto 90px 1fr', gap:8, alignItems:'center', marginTop:6 }}>
                  <div />
                  <span style={{ fontSize:11, color:C.textMuted }}>Show groups where measure</span>
                  <select
                    value={g.group_filter_op || ''}
                    onChange={e => updateGrouping(idx, { group_filter_op: e.target.value || null })}
                    style={{ ...inputStyle(), fontSize:12 }}
                    title="Group filter (HAVING)"
                  >
                    <option value="">(any)</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">≥</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">≤</option>
                    <option value="eq">=</option>
                    <option value="ne">≠</option>
                  </select>
                  <input
                    type="number"
                    value={g.group_filter_value ?? ''}
                    onChange={e => updateGrouping(idx, { group_filter_value: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    placeholder="value"
                    disabled={!g.group_filter_op}
                    style={{ ...inputStyle(), fontSize:12, opacity: g.group_filter_op ? 1 : 0.5 }}
                  />
                </div>
              </div>
            )
          })
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
                  fields={c.scope === 'summary' ? summaryIdentifiers(fieldNames) : fieldNames}
                  onChange={(expr) => update(idx, { expression: expr })}
                />
              </Suspense>
              {c.scope === 'summary' && (
                <div style={{ fontSize:11, color:C.textMuted, marginTop:8, lineHeight:1.5 }}>
                  Summary formulas run per group. Reference aggregates as
                  {' '}<code>SUM_field</code>, <code>AVG_field</code>, <code>COUNT_field</code>,
                  {' '}<code>MIN_field</code>, <code>MAX_field</code>. Compare across groups with:
                  <div style={{ marginTop:4 }}>
                    • <code>GRAND_SUM_field</code> — grand total (for <strong>% of total</strong>: <code>SUM_amount / GRAND_SUM_amount * 100</code>)<br/>
                    • <code>PARENT_SUM_field</code> — the parent group (for <strong>% of parent</strong>)<br/>
                    • <code>PREV_SUM_field</code> — the previous group (for <strong>period-over-period</strong>: <code>SUM_amount - PREV_SUM_amount</code>)
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// The identifier catalog offered to the summary-formula editor: each numeric
// column exposed as SUM_/AVG_/COUNT_/MIN_/MAX_ plus PARENT_/PREV_/GRAND_
// variants for cross-group comparison.
function summaryIdentifiers(fieldNames) {
  const aggs = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']
  const prefixes = ['', 'PARENT_', 'PREV_', 'GRAND_']
  const out = []
  for (const f of fieldNames) {
    for (const p of prefixes) for (const a of aggs) out.push(`${p}${a}_${f}`)
  }
  return out
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
        <div>
          <label style={fieldLabel()}>Row Limit</label>
          <input
            type="number" min="1"
            value={report.rpt_row_limit ?? ''}
            onChange={e => updateReport({ rpt_row_limit: e.target.value === '' ? null : parseInt(e.target.value, 10) })}
            placeholder="No limit (show all rows)"
            style={inputStyle()}
          />
          <div style={{ fontSize:11, color:C.textMuted, marginTop:4 }}>
            Cap the number of rows returned (Top-N). Combine with a sort to show, e.g., the top 10 by amount.
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

// Remove-field control. Reads as a labelled action rather than a pale glyph:
// the × it replaced carried no tooltip and no text, so the only way to take a
// field off a report was to guess what the icon did.
function removeFieldBtn() {
  return {
    padding: '0 9px', height: 24, fontSize: 11, fontWeight: 500,
    background: C.card, color: C.textSecondary,
    border: `1px solid ${C.borderDark}`, borderRadius: 4, cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function ReportBuilderFieldStyles() {
  return (
    <style>{`
      .rb-remove-field:hover { background:#e8f1fb; border-color:#7eb3e8; color:#2f6ea8; }
      .rb-field-btn:hover    { background:#f0f3f8; }
    `}</style>
  )
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
