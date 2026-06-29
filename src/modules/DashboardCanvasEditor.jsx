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

import { useState, useEffect } from 'react'
import { C } from '../data/constants'
import { LoadingState, ErrorState } from '../components/UI'
import { supabase } from '../lib/supabase'
import LeapCanvas from '../builder/LeapCanvas'
import SortableList from '../builder/SortableList'
import { loadDashboardForCanvas, saveDashboardFromCanvas } from '../builder/adapters/dashboardAdapter'

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

  const settingsPanel = (
    <DashboardSettings
      meta={meta} setMeta={setMeta} folders={folders}
      filters={filters} ops={FILTER_OPS}
      onAddFilter={addFilter} onUpdateFilter={updateFilter} onRemoveFilter={removeFilter}
      onReorderFilters={setFilters}
    />
  )

  return (
    <LeapCanvas
      key={dashboardId}
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
function DashboardSettings({ meta, setMeta, folders, filters, ops, onAddFilter, onUpdateFilter, onRemoveFilter, onReorderFilters }) {
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
          A filter applies to every widget whose report includes the named field. Drag to reorder.
        </div>
        {filters.length === 0
          ? <div style={{ fontSize: 12, color: C.textMuted, fontStyle: 'italic' }}>No filters.</div>
          : (
            <SortableList
              items={filters}
              onReorder={onReorderFilters}
              renderItem={(f, { setNodeRef, style, dragHandleProps }) => (
                <div ref={setNodeRef} style={{ ...style, background: C.cardSecondary, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span {...dragHandleProps} title="Drag to reorder" style={{ cursor: 'grab', color: C.textMuted, touchAction: 'none' }}>⠿</span>
                    <input type="text" value={f.label} placeholder="Label"
                      onChange={e => onUpdateFilter(f.id, { label: e.target.value })} style={{ ...input(), fontSize: 12, flex: 1 }} />
                    <button onClick={() => onRemoveFilter(f.id)} title="Remove" style={miniRemove()}>×</button>
                  </div>
                  <input type="text" value={f.field_name} placeholder="Field name (column on reports)"
                    onChange={e => onUpdateFilter(f.id, { field_name: e.target.value })} style={{ ...input(), fontSize: 12, marginBottom: 6 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <select value={f.operator} onChange={e => onUpdateFilter(f.id, { operator: e.target.value })} style={{ ...input(), fontSize: 12 }}>
                      {ops.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input type="text" value={f.default_value ?? ''} placeholder="Default"
                      onChange={e => onUpdateFilter(f.id, { default_value: e.target.value })} style={{ ...input(), fontSize: 12 }} />
                  </div>
                </div>
              )}
            />
          )}
      </div>
    </div>
  )
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
