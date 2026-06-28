import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { loadDashboard, saveDashboard, cloneDashboard, fetchReports, getReportSelectedFields } from '../data/reportsService'
import { supabase } from '../lib/supabase'

const WIDGET_TYPES = [
  { value: 'table',  label: 'Table' },
  { value: 'metric', label: 'Metric (single number)' },
  { value: 'bar',    label: 'Bar Chart' },
  { value: 'line',   label: 'Line Chart' },
  { value: 'pie',    label: 'Pie Chart' },
  { value: 'donut',  label: 'Donut Chart' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'gauge',  label: 'Gauge' },
]

export default function DashboardEditor({ dashboardId, onClose, onSaved }) {
  const isNew = !dashboardId || dashboardId === 'new'
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [reports, setReports]   = useState([])
  const [folders, setFolders]   = useState([])

  const [dashboard, setDashboard] = useState({
    dash_name:        '',
    dash_description: '',
    dash_folder_id:   null,
    dash_columns:     3,
    dash_layout:      [],
  })
  const [widgets, setWidgets] = useState([])
  const [filters, setFilters] = useState([])

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      setLoading(true); setError(null)
      try {
        const [reportsData, foldersRes] = await Promise.all([
          fetchReports(),
          supabase.from('dashboard_folders').select('id, df_name').eq('is_deleted', false).order('df_name'),
        ])
        if (cancelled) return
        setReports(reportsData)
        setFolders(foldersRes.data || [])

        if (!isNew) {
          const loaded = await loadDashboard(dashboardId)
          if (cancelled) return
          if (!loaded) { setError(new Error('Dashboard not found.')); setLoading(false); return }
          setDashboard({
            dash_name:        loaded.dashboard.dash_name || '',
            dash_description: loaded.dashboard.dash_description || '',
            dash_folder_id:   loaded.dashboard.dash_folder_id,
            dash_columns:     loaded.dashboard.dash_columns || 3,
            dash_layout:      loaded.dashboard.dash_layout || [],
          })
          setWidgets((loaded.widgets || []).map(w => ({
            report_id:    w.dw_report_id,
            title:        w.dw_title,
            widget_type:  w.dw_widget_type,
            position_row: w.dw_position_row,
            position_col: w.dw_position_col,
            width:        w.dw_width,
            height:       w.dw_height,
            widget_config: w.dw_widget_config,
          })))
          setFilters((loaded.filters || []).map(f => ({
            label:         f.dfilt_label,
            field_name:    f.dfilt_field_name,
            operator:      f.dfilt_operator,
            default_value: f.dfilt_default_value,
            options:       f.dfilt_options,
          })))
        }
        setLoading(false)
      } catch (err) {
        if (!cancelled) { setError(err); setLoading(false) }
      }
    }
    init()
    return () => { cancelled = true }
  }, [dashboardId, isNew])

  const updateDashboard = (patch) => setDashboard(prev => ({ ...prev, ...patch }))

  const addWidget = () => {
    setWidgets([...widgets, {
      report_id: '', title: '', widget_type: 'table',
      position_row: Math.floor(widgets.length / 3),
      position_col: widgets.length % 3,
      width: 1, height: 1,
      widget_config: {},
    }])
  }
  const updateWidget = (idx, patch) => {
    setWidgets(widgets.map((w, i) => i === idx ? { ...w, ...patch } : w))
  }
  const removeWidget = (idx) => setWidgets(widgets.filter((_, i) => i !== idx))
  const moveWidget = (idx, dir) => {
    // Reorder by array position. position_row/col are recomputed at save
    // time based on the array order plus the dashboard's column count.
    const target = idx + dir
    if (target < 0 || target >= widgets.length) return
    const next = [...widgets]
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
    setWidgets(next)
  }

  const addFilter = () => {
    setFilters([...filters, {
      label:         '',
      field_name:    '',
      operator:      'equals',
      default_value: '',
      options:       [],
    }])
  }
  const updateFilter = (idx, patch) => {
    setFilters(filters.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }
  const removeFilter = (idx) => setFilters(filters.filter((_, i) => i !== idx))

  const handleSave = async () => {
    if (!dashboard.dash_name) { alert('Dashboard name is required.'); return }
    setSaving(true); setError(null)
    try {
      const newId = await saveDashboard({ id: dashboardId, dashboard, widgets, filters })
      setSavedAt(new Date())
      onSaved?.(newId)
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  // ─── Save As (Clone) ───────────────────────────────────────────────────
  // Two-step, mirrors ReportBuilder.handleSaveAs. First persists current
  // edits to the source so they aren't lost if the user later discards
  // the clone, then calls clone_dashboard. Parent navigates to the new
  // id via onSaved. Disabled on a brand-new unsaved dashboard.
  const handleSaveAs = async () => {
    if (isNew) return
    if (!dashboard.dash_name) { alert('Dashboard name is required.'); return }
    setSaving(true); setError(null)
    try {
      await saveDashboard({ id: dashboardId, dashboard, widgets, filters })
      const newId = await cloneDashboard(dashboardId)
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
          <div style={{ fontSize:11, color:C.textMuted }}>{isNew ? 'New Dashboard' : 'Edit Dashboard'}</div>
          <div style={{ fontSize:18, fontWeight:600, color:C.textPrimary }}>
            {dashboard.dash_name || 'Untitled Dashboard'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {savedAt && (
            <div style={{ fontSize:11, color:C.textMuted }}>Saved {savedAt.toLocaleTimeString()}</div>
          )}
          <button onClick={onClose} style={btnSecondary()}>Close</button>
          {/* Save As — persist current edits, then clone. Hidden on new
              unsaved dashboards (no source to clone yet). */}
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

      {/* Body */}
      <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>

        {/* Settings */}
        <div style={card()}>
          <div style={cardHeader()}>Settings</div>
          <div style={{ padding:16, display:'grid', gap:14 }}>
            <div>
              <label style={fieldLabel()}>Dashboard Name</label>
              <input type="text" value={dashboard.dash_name}
                onChange={e => updateDashboard({ dash_name: e.target.value })}
                style={inputStyle()} />
            </div>
            <div>
              <label style={fieldLabel()}>Description</label>
              <textarea value={dashboard.dash_description}
                onChange={e => updateDashboard({ dash_description: e.target.value })}
                rows={2} style={inputStyle()} />
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              <div>
                <label style={fieldLabel()}>Folder</label>
                <select value={dashboard.dash_folder_id || ''}
                  onChange={e => updateDashboard({ dash_folder_id: e.target.value || null })}
                  style={inputStyle()}>
                  <option value="">— None —</option>
                  {folders.map(f => <option key={f.id} value={f.id}>{f.df_name}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Columns</label>
                <select value={dashboard.dash_columns}
                  onChange={e => updateDashboard({ dash_columns: parseInt(e.target.value, 10) })}
                  style={inputStyle()}>
                  <option value={1}>1 column</option>
                  <option value={2}>2 columns</option>
                  <option value={3}>3 columns</option>
                  <option value={4}>4 columns</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Widgets */}
        <div style={{ ...card(), marginTop:16 }}>
          <div style={cardHeader()}>
            <span>Widgets ({widgets.length})</span>
            <button onClick={addWidget} style={btnSecondary(false, 'small')}>+ Add Widget</button>
          </div>
          <div style={{ padding:12 }}>
            {widgets.length === 0 ? (
              <div style={emptyState()}>No widgets yet. Click "Add Widget" to attach a saved report.</div>
            ) : widgets.map((w, idx) => (
              <WidgetEditorRow
                key={idx}
                widget={w}
                idx={idx}
                isFirst={idx === 0}
                isLast={idx === widgets.length - 1}
                reports={reports}
                onUpdate={(patch) => updateWidget(idx, patch)}
                onRemove={() => removeWidget(idx)}
                onMoveUp={() => moveWidget(idx, -1)}
                onMoveDown={() => moveWidget(idx, 1)}
              />
            ))}
          </div>
        </div>

        {/* Dashboard filters — propagate to every widget at runtime when
            the widget's report has the named column. */}
        <div style={{ ...card(), marginTop:16 }}>
          <div style={cardHeader()}>
            <span>Dashboard Filters ({filters.length})</span>
            <button onClick={addFilter} style={btnSecondary(false, 'small')}>+ Add Filter</button>
          </div>
          <div style={{ padding:12 }}>
            {filters.length === 0 ? (
              <div style={emptyState()}>
                No dashboard filters. Add one to let viewers narrow every widget at once
                — e.g. by date range, state, or program.
              </div>
            ) : filters.map((f, idx) => (
              <DashboardFilterRow
                key={idx}
                filter={f}
                idx={idx}
                onUpdate={(patch) => updateFilter(idx, patch)}
                onRemove={() => removeFilter(idx)}
              />
            ))}
            {filters.length > 0 && (
              <div style={{ fontSize:11, color:C.textMuted, marginTop:8, fontStyle:'italic' }}>
                Each filter applies to widgets whose underlying report includes the named field.
                Reports without the field are unaffected.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard filter row ─────────────────────────────────────────────────

const FILTER_OPS = [
  'equals','not_equals','greater_than','less_than','greater_or_equal','less_or_equal',
  'in','not_in','contains','starts_with','ends_with',
  'is_null','is_not_null','in_last_n_days','this_month','this_year',
]

function DashboardFilterRow({ filter: f, idx, onUpdate, onRemove }) {
  return (
    <div style={{ background:C.cardSecondary, borderRadius:6, padding:10, marginBottom:8 }}>
      <div style={{
        display:'grid', gridTemplateColumns:'30px 1fr 1fr 130px 1fr 30px',
        gap:8, alignItems:'center',
      }}>
        <div style={{ fontSize:12, color:C.textMuted, textAlign:'center' }}>{idx + 1}</div>
        <input type="text"
          value={f.label || ''}
          onChange={e => onUpdate({ label: e.target.value })}
          placeholder="Label (e.g. 'Date Range')"
          style={{ ...inputStyle(), fontSize:12 }} />
        <input type="text"
          value={f.field_name || ''}
          onChange={e => onUpdate({ field_name: e.target.value })}
          placeholder="Field name on reports"
          style={{ ...inputStyle(), fontSize:12 }} />
        <select value={f.operator || 'equals'}
          onChange={e => onUpdate({ operator: e.target.value })}
          style={{ ...inputStyle(), fontSize:12 }}>
          {FILTER_OPS.map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        <input type="text"
          value={f.default_value || ''}
          onChange={e => onUpdate({ default_value: e.target.value })}
          placeholder="Default value (optional)"
          style={{ ...inputStyle(), fontSize:12 }} />
        <button onClick={onRemove} style={miniBtn(true)} title="Remove">×</button>
      </div>
    </div>
  )
}

// ─── Widget editor row ────────────────────────────────────────────────────
//
// A single widget within the dashboard editor. Owns the lazily-loaded
// columns of the widget's selected report so the group_by and
// measure_field dropdowns can be populated without round-trips to
// schema introspection.

const MEASURES = [
  { value: 'count', label: 'Count of records' },
  { value: 'sum',   label: 'Sum of' },
  { value: 'avg',   label: 'Average of' },
  { value: 'min',   label: 'Min of' },
  { value: 'max',   label: 'Max of' },
]

// Which widget types use group_by + measure config vs just measure config
// vs neither. Tables don't need measures (they show raw rows).
const NEEDS_GROUP_BY = new Set(['bar','line','pie','donut','funnel'])
const NEEDS_MEASURE  = new Set(['bar','line','pie','donut','funnel','metric','gauge'])
const NEEDS_TARGET   = new Set(['gauge'])

function WidgetEditorRow({ widget: w, idx, isFirst, isLast, reports, onUpdate, onRemove, onMoveUp, onMoveDown }) {
  const [reportFields, setReportFields] = useState([])

  useEffect(() => {
    let cancelled = false
    if (!w.report_id) { setReportFields([]); return }
    getReportSelectedFields(w.report_id)
      .then(fields => { if (!cancelled) setReportFields(fields) })
      .catch(err => { if (!cancelled) { console.warn('report fields load failed:', err); setReportFields([]) } })
    return () => { cancelled = true }
  }, [w.report_id])

  const cfg = w.widget_config || {}
  const updateConfig = (patch) => onUpdate({ widget_config: { ...cfg, ...patch } })

  const widgetType   = w.widget_type || 'table'
  const showGroupBy  = NEEDS_GROUP_BY.has(widgetType)
  const showMeasure  = NEEDS_MEASURE.has(widgetType)
  const showTarget   = NEEDS_TARGET.has(widgetType)
  const measureType  = cfg.measure_type || 'count'
  const measureNeedsField = measureType !== 'count'

  return (
    <div style={{ background:C.cardSecondary, borderRadius:6, padding:12, marginBottom:10 }}>
      {/* Order controls + position label */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ fontSize:11, color:C.textMuted, fontWeight:500 }}>
          Widget #{idx + 1}
        </div>
        <div style={{ display:'flex', gap:4 }}>
          <button onClick={onMoveUp}   disabled={isFirst} style={miniBtn(false, isFirst)} title="Move up">↑</button>
          <button onClick={onMoveDown} disabled={isLast}  style={miniBtn(false, isLast)}  title="Move down">↓</button>
          <button onClick={onRemove} style={miniBtn(true)} title="Remove">×</button>
        </div>
      </div>

      {/* Top row: report + chart type + width */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 100px', gap:8, alignItems:'center', marginBottom:8 }}>
        <select value={w.report_id || ''}
          onChange={e => onUpdate({ report_id: e.target.value })}
          style={inputStyle()}>
          <option value="">— Report —</option>
          {reports.map(r => (
            <option key={r._id} value={r._id}>{r.name}</option>
          ))}
        </select>
        <select value={widgetType}
          onChange={e => onUpdate({ widget_type: e.target.value })}
          style={inputStyle()}>
          {WIDGET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={w.width || 1}
          onChange={e => onUpdate({ width: parseInt(e.target.value, 10) })}
          style={inputStyle()}>
          <option value={1}>1 col</option>
          <option value={2}>2 cols</option>
          <option value={3}>3 cols</option>
          <option value={4}>4 cols</option>
        </select>
      </div>

      {/* Title input */}
      <input type="text" value={w.title || ''}
        onChange={e => onUpdate({ title: e.target.value })}
        placeholder="Widget title (optional — defaults to report name)"
        style={{ ...inputStyle(), fontSize:12, marginBottom:8 }} />

      {/* Chart-specific config */}
      {(showGroupBy || showMeasure || showTarget) && w.report_id && (
        <div style={{
          padding:8, background:C.card, border:`1px solid ${C.border}`,
          borderRadius:4, display:'grid', gap:6,
        }}>
          {showGroupBy && (
            <div style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:6, alignItems:'center' }}>
              <label style={{ fontSize:11, color:C.textSecondary }}>Group by</label>
              <select value={cfg.group_by || ''}
                onChange={e => updateConfig({ group_by: e.target.value })}
                style={{ ...inputStyle(), fontSize:11 }}>
                <option value="">— First column (default) —</option>
                {reportFields.map((f, fi) => (
                  <option key={`${f.name}-${fi}`} value={f.name}>
                    {f.label || f.name}{f.via_path?.length ? ` (${f.via_path.join('.')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {showMeasure && (
            <div style={{ display:'grid', gridTemplateColumns:'100px 1fr 1fr', gap:6, alignItems:'center' }}>
              <label style={{ fontSize:11, color:C.textSecondary }}>Measure</label>
              <select value={measureType}
                onChange={e => updateConfig({ measure_type: e.target.value })}
                style={{ ...inputStyle(), fontSize:11 }}>
                {MEASURES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              {measureNeedsField ? (
                <select value={cfg.measure_field || ''}
                  onChange={e => updateConfig({ measure_field: e.target.value })}
                  style={{ ...inputStyle(), fontSize:11 }}>
                  <option value="">— Field —</option>
                  {reportFields.map((f, fi) => (
                    <option key={`m-${f.name}-${fi}`} value={f.name}>
                      {f.label || f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize:11, color:C.textMuted, fontStyle:'italic', alignSelf:'center' }}>
                  Counts all rows in the report.
                </div>
              )}
            </div>
          )}
          {showTarget && (
            <div style={{ display:'grid', gridTemplateColumns:'100px 1fr', gap:6, alignItems:'center' }}>
              <label style={{ fontSize:11, color:C.textSecondary }}>Target</label>
              <input type="number" value={cfg.target ?? 100}
                onChange={e => updateConfig({ target: parseFloat(e.target.value) || 0 })}
                style={{ ...inputStyle(), fontSize:11 }} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────

function card()       { return { background:C.card, border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' } }
function cardHeader() { return {
  padding:'10px 12px', fontSize:13, fontWeight:600, color:C.textPrimary,
  borderBottom:`1px solid ${C.border}`, background:C.cardSecondary,
  display:'flex', alignItems:'center', justifyContent:'space-between',
} }
function fieldLabel() { return {
  display:'block', fontSize:11, fontWeight:500, color:C.textSecondary,
  marginBottom:4, textTransform:'uppercase', letterSpacing:0.5,
} }
function inputStyle() { return {
  width:'100%', padding:'8px 10px', fontSize:13,
  background:C.card, color:C.textPrimary,
  border:`1px solid ${C.border}`, borderRadius:6, font:'inherit',
  boxSizing:'border-box',
} }
function btnPrimary(disabled) { return {
  padding:'8px 14px', fontSize:13, fontWeight:500,
  background: disabled ? C.borderDark : C.emerald, color:'#fff',
  border:'none', borderRadius:6, cursor: disabled ? 'default' : 'pointer',
} }
function btnSecondary(disabled, size) { return {
  padding: size === 'small' ? '4px 10px' : '8px 14px',
  fontSize: size === 'small' ? 12 : 13, fontWeight:500,
  background:C.card, color:C.textPrimary,
  border:`1px solid ${C.borderDark}`, borderRadius:6,
  cursor: disabled ? 'default' : 'pointer',
} }
function miniBtn(danger, disabled) { return {
  width:24, height:24, fontSize:14, fontWeight:600,
  background: danger ? '#e8f1fb' : C.card, color: danger ? '#7eb3e8' : C.textPrimary,
  border:`1px solid ${danger ? '#e8f1fb' : C.border}`, borderRadius:4,
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
} }
function emptyState() { return {
  padding:'24px 12px', textAlign:'center',
  fontSize:12, color:C.textMuted, fontStyle:'italic',
} }
