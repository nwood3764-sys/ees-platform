// =============================================================================
// src/modules/DashboardCanvasEditor.jsx
//
// The Salesforce-parity dashboard builder: the LEAP Canvas wired to the real
// dashboards tables. This replaces the form-driven DashboardEditor (the "weird
// list view") at every entry point. The three-pane canvas IS the editor —
// drag widgets from the palette, position/resize on the live grid, configure
// each from the schema-driven inspector against real report data.
//
// This component owns the dashboard-level state (name / description / folder /
// filters); the canvas owns the widgets + geometry. On save both are mapped to
// the DB via the dashboard adapter (which reuses saveDashboard).
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { supabase } from '../lib/supabase'
import LeapCanvas from '../builder/LeapCanvas'
import SortableList from '../builder/SortableList'
import { dashboardRegistry } from '../builder/registries/dashboardRegistry'
import { loadDashboardForCanvas, saveDashboardFromCanvas } from '../builder/adapters/dashboardAdapter'
import { describeDashboardFilterObjects } from '../data/reportsService'
import { buildFieldMap, filterCoverage, filterColumnForObject } from '../lib/dashboardFilterFields'

const FILTER_OPS = [
  'equals','not_equals','greater_than','less_than','greater_or_equal','less_or_equal',
  'in','not_in','contains','starts_with','ends_with',
  'is_null','is_not_null','in_last_n_days','this_month','this_year',
]

export default function DashboardCanvasEditor({ dashboardId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [loaded, setLoaded]   = useState(null)   // adapter result

  const [meta, setMeta]       = useState({ dash_name: '', dash_description: '', dash_folder_id: null })
  const [filters, setFilters] = useState([])
  const [folders, setFolders] = useState([])
  const filterIdRef = useState(() => ({ n: 1 }))[0]

  // Essential load: the dashboard's widgets + meta. Blocks the editor (we need
  // it to seed the canvas), but is instant for a new dashboard.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loadDashboardForCanvas(dashboardId)
      .then(data => {
        if (cancelled) return
        if (!data) { setError(new Error('Dashboard not found or not accessible.')); setLoading(false); return }
        setLoaded(data); setMeta(data.meta); setFilters(data.filters); setLoading(false)
      })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [dashboardId])

  // Folder list is a convenience (the folder picker); fetch it in the
  // background so a slow/failed fetch never blocks or breaks editing.
  useEffect(() => {
    let cancelled = false
    supabase.from('dashboard_folders').select('id, df_name').eq('is_deleted', false).order('df_name')
      .then(res => { if (!cancelled) setFolders(res?.data || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleSave = async ({ components, layout }) => {
    if (!meta.dash_name?.trim()) {
      const e = new Error('Dashboard name is required.')
      throw e
    }
    const newId = await saveDashboardFromCanvas({
      id: dashboardId === 'new' ? null : dashboardId,
      meta, components, layout, filters,
    })
    onSaved?.(newId)
    return newId
  }

  // ── Filter editor handlers ──────────────────────────────────────────────
  const addFilter = () => setFilters(f => [...f, {
    id: `f-new-${filterIdRef.n++}`, label: '', field_name: '', operator: 'equals', default_value: '', options: [],
  }])
  const updateFilter = (id, patch) => setFilters(f => f.map(x => x.id === id ? { ...x, ...patch } : x))
  const removeFilter = (id) => setFilters(f => f.filter(x => x.id !== id))

  // Field-name suggestions for the filter picker: the columns the dashboard's
  // widgets already reference (group_by / series / measure / date / filter
  // fields + table columns). A dashboard filter must name a column that its
  // widgets' reports actually have, so these are the useful candidates — the
  // input stays free-text (a widget may use a field not surfaced here) but the
  // datalist means you pick from real fields instead of typing blind.
  //
  // MUST stay above the loading/error early returns below — it's a hook, and a
  // hook after a conditional return changes the hook count between the loading
  // and loaded renders (React "Rendered more/fewer hooks" crash). `loaded` is
  // null until the load resolves, so the optional chaining keeps it safe.
  // The objects this dashboard's widgets report on, with their real columns —
  // what a filter is authored against. Keyed by the set of report ids so it
  // re-resolves when a widget is added or repointed during the session.
  //
  // MUST stay above the loading/error early returns below — these are hooks,
  // and a hook after a conditional return changes the hook count between the
  // loading and loaded renders (React "Rendered more/fewer hooks" crash).
  const [liveReportIds, setLiveReportIds] = useState(null)
  const [filterObjects, setFilterObjects] = useState([])
  const reportIdKey = useMemo(() => {
    const ids = liveReportIds ?? (loaded?.components || []).map(c => c.dataSourceId)
    return Array.from(new Set(ids.filter(Boolean))).sort().join(',')
  }, [liveReportIds, loaded])

  useEffect(() => {
    let cancelled = false
    if (!reportIdKey) { setFilterObjects([]); return }
    describeDashboardFilterObjects(reportIdKey.split(','))
      .then(objs => { if (!cancelled) setFilterObjects(objs) })
      // A failed schema read leaves the picker empty rather than breaking the
      // editor; the filter's own column is still whatever it already was.
      .catch(() => { if (!cancelled) setFilterObjects([]) })
    return () => { cancelled = true }
  }, [reportIdKey])

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onClose} />

  const headerExtra = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1, maxWidth: 520 }}>
      <div style={{ fontSize: 11, color: C.textMuted }}>{loaded.isNew ? 'New Dashboard' : 'Edit Dashboard'}</div>
      <input
        type="text" value={meta.dash_name}
        placeholder="Untitled Dashboard"
        onChange={e => setMeta(m => ({ ...m, dash_name: e.target.value }))}
        style={{
          fontSize: 18, fontWeight: 600, color: C.textPrimary, border: 'none', outline: 'none',
          background: 'transparent', font: 'inherit', padding: 0, width: '100%',
        }} />
    </div>
  )

  // A render function, so the panel sees the canvas's LIVE widget list — a
  // filter added right after a widget is authored against that widget too.
  const settingsPanel = ({ components }) => (
    <DashboardSettings
      meta={meta} setMeta={setMeta} folders={folders}
      filters={filters} ops={FILTER_OPS}
      filterObjects={filterObjects}
      onComponentsChange={setLiveReportIds}
      components={components}
      onAddFilter={addFilter} onUpdateFilter={updateFilter} onRemoveFilter={removeFilter}
      onReorderFilters={setFilters}
    />
  )

  return (
    <LeapCanvas
      key={dashboardId}
      registry={dashboardRegistry}
      initialComponents={loaded.components}
      initialLayout={loaded.layout}
      headerExtra={headerExtra}
      settingsPanel={settingsPanel}
      onSave={handleSave}
      onClose={onClose}
    />
  )
}

// ─── Dashboard settings + filters (inspector, no-widget-selected view) ────────
function DashboardSettings({
  meta, setMeta, folders, filters, ops,
  filterObjects = [], components = [], onComponentsChange,
  onAddFilter, onUpdateFilter, onRemoveFilter, onReorderFilters,
}) {
  // Report the canvas's live report ids up so the field picker re-resolves when
  // a widget is added or repointed. An effect, not a render-time call — setting
  // parent state during render is a React warning and a re-render loop.
  const liveIds = (components || []).map(c => c.dataSourceId).filter(Boolean).sort().join(',')
  useEffect(() => { onComponentsChange?.(liveIds ? liveIds.split(',') : []) }, [liveIds])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 2 }}>Dashboard settings</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Select a widget to configure it.</div>
      </div>

      <Field label="Description">
        <textarea rows={2} value={meta.dash_description || ''}
          onChange={e => setMeta(m => ({ ...m, dash_description: e.target.value }))}
          style={{ ...input(), resize: 'vertical' }} />
      </Field>

      <Field label="Folder">
        <select value={meta.dash_folder_id || ''}
          onChange={e => setMeta(m => ({ ...m, dash_folder_id: e.target.value || null }))}
          style={input()}>
          <option value="">— None —</option>
          {folders.map(f => <option key={f.id} value={f.id}>{f.df_name}</option>)}
        </select>
      </Field>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <label style={fieldLabelStyle()}>Filters ({filters.length})</label>
          <button onClick={onAddFilter} style={miniAdd()}>+ Add</button>
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 8, lineHeight: 1.4 }}>
          A filter sits above the dashboard and applies to every widget. Pick the field once;
          each widget uses the matching field on its own object. Drag to reorder.
        </div>
        {filterObjects.length === 0 && (
          <div style={{ fontSize: 11, color: C.textSecondary, background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, marginBottom: 8, lineHeight: 1.45 }}>
            Add a widget with a report first — a filter is authored against the fields the
            dashboard's reports actually have.
          </div>
        )}
        {filters.length === 0
          ? <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>No filters.</div>
          : (
            <SortableList
              items={filters}
              onReorder={onReorderFilters}
              renderItem={(f, { setNodeRef, style, dragHandleProps }) => (
                <div ref={setNodeRef} style={style}>
                  <DashboardFilterEditor
                    filter={f} ops={ops} objects={filterObjects}
                    onUpdate={onUpdateFilter} onRemove={onRemoveFilter}
                    dragHandleProps={dragHandleProps}
                  />
                </div>
              )}
            />
          )}
      </div>
    </div>
  )
}

// ─── One filter ───────────────────────────────────────────────────────────────
//
// The field used to be a free-text box for a raw column name, with a datalist of
// whatever columns some widget config happened to mention. Authoring a filter
// therefore meant knowing the platform's column names by heart, and a typo
// produced a control that silently filtered nothing. Nicholas, 2026-08-31: "The
// user needs to be able to put any kind of filter they want on, not just the
// state filter."
//
// So: pick a real field from a real object, and the editor proposes the matching
// field on every OTHER object the dashboard reports on and says plainly which
// widgets the filter reaches. What it cannot map, it names.
const FILTER_VALUE_TOKEN = '::'

export function DashboardFilterEditor({ filter: f, ops, objects, onUpdate, onRemove, dragHandleProps }) {
  const [showMapping, setShowMapping] = useState(false)

  const coverage = filterCoverage(f, objects)
  // The object the field was picked FROM: the one whose map entry is the
  // filter's own column. Falls back to the first covered object for a filter
  // saved before the map existed.
  const sourceTable = objects.find(o => (f.field_map || {})[o.table] === f.field_name)?.table
    || coverage.covered.find(c => c.column === f.field_name)?.table
    || null
  const selectedToken = sourceTable && f.field_name ? `${sourceTable}${FILTER_VALUE_TOKEN}${f.field_name}` : ''

  const labelOf = (table, column) =>
    objects.find(o => o.table === table)?.columns.find(c => c.name === column)?.label || column

  const pickField = (token) => {
    if (!token) { onUpdate(f.id, { field_name: '', field_map: null, options: [] }); return }
    const [table, column] = token.split(FILTER_VALUE_TOKEN)
    // The source object is written into the map too, so the map alone answers
    // "which column here?" for every object and nothing depends on remembering
    // where the field came from.
    const map = { [table]: column, ...buildFieldMap(column, table, objects) }
    const patch = {
      field_name: column,
      field_map:  map,
      // The value control offers what is actually in the data, resolved to
      // names for picklist and lookup columns. A free-text box is the fallback,
      // chosen below.
      options: { source: 'distinct', object: table, field: column },
    }
    const auto = f.field_name ? labelOf(sourceTable, f.field_name) : ''
    if (!f.label || f.label === auto) patch.label = labelOf(table, column)
    onUpdate(f.id, patch)
  }

  const setMapping = (table, column) => {
    const map = { ...(f.field_map || {}) }
    // An empty choice is stored explicitly, not deleted: "not on this object" and
    // "nobody has said" are different answers, and only the first one survives an
    // object that spells the column the same way.
    map[table] = column || null
    onUpdate(f.id, { field_map: map })
  }

  const usesValueList = !!(f.options && !Array.isArray(f.options) && f.options.source === 'distinct')

  return (
    <div style={{ background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none' }}>⠿</span>
        <input type="text" value={f.label} placeholder="Label"
          onChange={e => onUpdate(f.id, { label: e.target.value })} style={{ ...input(), fontSize: 12, flex: 1 }} />
        <button onClick={() => onRemove(f.id)} title="Remove" style={miniRemove()}>×</button>
      </div>

      <select value={selectedToken} onChange={e => pickField(e.target.value)}
        style={{ ...input(), fontSize: 12, marginBottom: 6 }}>
        <option value="">— Choose a field —</option>
        {objects.map(o => (
          <optgroup key={o.table} label={o.label}>
            {o.columns.map(c => (
              <option key={`${o.table}${FILTER_VALUE_TOKEN}${c.name}`} value={`${o.table}${FILTER_VALUE_TOKEN}${c.name}`}>
                {c.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {f.field_name && !selectedToken && (
        <div style={{ fontSize: 11, color: C.textSecondary, marginBottom: 6 }}>
          Currently <code style={{ fontFamily: 'JetBrains Mono, monospace' }}>{f.field_name}</code>, which no
          widget on this dashboard has. Choose a field above to repoint it.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        <select value={f.operator} onChange={e => onUpdate(f.id, { operator: e.target.value })} style={{ ...input(), fontSize: 12 }}>
          {ops.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="text" value={f.default_value ?? ''} placeholder="Default"
          onChange={e => onUpdate(f.id, { default_value: e.target.value })} style={{ ...input(), fontSize: 12 }} />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textSecondary, marginBottom: 6 }}>
        <input type="checkbox" checked={usesValueList} disabled={!sourceTable}
          onChange={e => onUpdate(f.id, {
            options: e.target.checked && sourceTable
              ? { source: 'distinct', object: sourceTable, field: f.field_name }
              : [],
          })} />
        Choose from values in the data
      </label>

      {/* What the filter reaches, said plainly — the thing that was invisible
          before, and the reason two widgets could answer different questions. */}
      {objects.length > 0 && f.field_name && (
        <div style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1.45 }}>
          {coverage.covered.length > 0
            ? <>Applies to <strong style={{ color: C.textPrimary }}>{coverage.covered.map(c => labelForTable(objects, c.table)).join(', ')}</strong>.</>
            : <>Applies to no widget on this dashboard.</>}
          {coverage.uncovered.length > 0 && (
            <> Not applied to <strong style={{ color: C.textPrimary }}>{coverage.uncovered.map(t => labelForTable(objects, t)).join(', ')}</strong> — those widgets show every record.</>
          )}
          {' '}
          <button onClick={() => setShowMapping(v => !v)}
            style={{ background: 'none', border: 'none', padding: 0, color: C.emeraldMid, cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
            {showMapping ? 'Hide fields' : 'Set fields per object'}
          </button>
        </div>
      )}

      {showMapping && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {objects.map(o => (
            <div key={o.table}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 }}>{o.label}</div>
              <select value={filterColumnForObject(f, o.table) || ''}
                onChange={e => setMapping(o.table, e.target.value)}
                style={{ ...input(), fontSize: 12 }}>
                <option value="">— Not filtered —</option>
                {o.columns.map(c => <option key={c.name} value={c.name}>{c.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function labelForTable(objects, table) {
  return objects.find(o => o.table === table)?.label || table
}

// ─── Style helpers ────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label style={fieldLabelStyle()}>{label}</label>
      <div style={{ marginTop: 5 }}>{children}</div>
    </div>
  )
}
function fieldLabelStyle() {
  return { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }
}
function input() {
  return {
    width: '100%', padding: '8px 10px', fontSize: 13, background: C.card, color: C.textPrimary,
    border: `1px solid ${C.border}`, borderRadius: 6, font: 'inherit', boxSizing: 'border-box',
  }
}
function miniAdd() {
  return { padding: '4px 10px', fontSize: 12, fontWeight: 500, background: C.card, color: C.textPrimary, border: `1px solid ${C.borderDark}`, borderRadius: 6, cursor: 'pointer' }
}
function miniRemove() {
  return { width: 24, height: 24, fontSize: 14, fontWeight: 600, background: '#e8f1fb', color: C.sky, border: `1px solid ${C.border}`, borderRadius: 4, cursor: 'pointer', flexShrink: 0 }
}
