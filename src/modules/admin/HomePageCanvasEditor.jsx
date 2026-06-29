// =============================================================================
// src/modules/admin/HomePageCanvasEditor.jsx
//
// The home-page builder, rebuilt on the LEAP Canvas (replaces the fixed-region
// HomePageBuilder). A list of saved pages → New/Edit → the three-pane canvas
// with the home component registry. Free 12-col grid instead of 4 fixed
// templates; assignment (module / role / active / default) lives in the
// inspector's page-settings view. Reuses the existing home_pages tables via the
// home adapter, and the live screen (ConfiguredHome) renders the result.
// =============================================================================

import { useState, useEffect } from 'react'
import { C, NAV_MODULES } from '../../data/constants'
import { Icon, LoadingState, ErrorState } from '../../components/UI'
import { fetchHomePages, fetchRoles, fetchSavedListViews } from '../../data/adminService'
import { fetchDashboards, fetchReports } from '../../data/reportsService'
import LeapCanvas from '../../builder/LeapCanvas'
import { homeRegistry } from '../../builder/registries/homeRegistry'
import { Field, inputStyle } from '../../builder/inspectorControls'
import { loadHomePageForCanvas, saveHomePageFromCanvas } from '../../builder/adapters/homePageAdapter'

export default function HomePageCanvasEditor() {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)   // null = list, 'new' or id = editing

  const reload = () => fetchHomePages().then(setPages).catch(() => setPages([]))
  useEffect(() => { reload().finally(() => setLoading(false)) }, [])

  if (editingId !== null) {
    return <HomePageEditorCanvas
      pageId={editingId}
      onClose={() => setEditingId(null)}
      onSaved={() => { reload(); setEditingId(null) }} />
  }

  if (loading) return <LoadingState />

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Home Pages</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>Build the landing screen users see — drag components onto a free grid, assign to a module/role or set the org default.</div>
        </div>
        <button onClick={() => setEditingId('new')} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" /> New Page
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {pages.length === 0 && <div style={{ color: C.textMuted, fontSize: 13 }}>No home pages yet. Create one to replace the built-in home screen.</div>}
        {pages.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.card }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 100px 90px', gap: 8, padding: '10px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div>Name</div><div>Assignment</div><div style={{ textAlign: 'center' }}>Status</div><div></div>
            </div>
            {pages.map(p => {
              const modName = p.moduleId ? (NAV_MODULES.find(m => m.id === p.moduleId)?.label || p.moduleId) : 'Global Home'
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 100px 90px', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
                  <div style={{ color: C.textPrimary, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ color: C.textSecondary }}>{(p.isDefault ? 'Module default' : 'Role-scoped')} · {modName}</div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: p.isActive ? '#e8f8f2' : '#eef1f6', color: p.isActive ? '#1a7a4e' : C.textMuted }}>{p.isActive ? 'ACTIVE' : 'DRAFT'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span onClick={() => setEditingId(p.id)} style={{ cursor: 'pointer', fontSize: 11.5, color: C.emerald, fontWeight: 600 }}>Edit</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function HomePageEditorCanvas({ pageId, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [loaded, setLoaded]   = useState(null)
  const [meta, setMeta]       = useState({ name: '', moduleId: null, roleId: null, isActive: false, isDefault: false })
  const [sources, setSources] = useState({ dashboards: [], reports: [], listViews: [] })
  const [roles, setRoles]     = useState([])

  // Essential load: page data (seeds the canvas).
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loadHomePageForCanvas(pageId)
      .then(data => { if (!cancelled) { setLoaded(data); setMeta(data.meta); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [pageId])

  // Background: embeddable sources + roles (non-blocking).
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchDashboards().catch(() => []),
      fetchReports().catch(() => []),
      fetchSavedListViews().catch(() => []),
      fetchRoles().catch(() => []),
    ]).then(([dbs, reps, lvs, rls]) => {
      if (cancelled) return
      setSources({
        dashboards: dbs.map(d => ({ id: d._id, name: d.name || 'Dashboard' })),
        reports:    reps.map(r => ({ id: r._id, name: r.name || 'Report' })),
        listViews:  lvs.map(v => ({ id: v._id || v.id, name: v.name || v.label || 'List View' })),
      })
      setRoles(rls.map(r => ({ id: r.id, name: r.name || r.role_name || 'Role' })))
    })
    return () => { cancelled = true }
  }, [])

  const handleSave = async ({ components, layout }) => {
    if (!meta.name?.trim()) throw new Error('Give the page a name before saving.')
    const newId = await saveHomePageFromCanvas({ id: pageId, meta, components, layout })
    onSaved?.(newId)
    return newId
  }

  if (loading) return <LoadingState />
  if (error)   return <ErrorState error={error} onRetry={onClose} />

  const headerExtra = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1, maxWidth: 520 }}>
      <div style={{ fontSize: 11, color: C.textMuted }}>{loaded.isNew ? 'New Home Page' : 'Edit Home Page'}</div>
      <input type="text" value={meta.name} placeholder="Untitled Home Page"
        onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
        style={{ fontSize: 18, fontWeight: 600, color: C.textPrimary, border: 'none', outline: 'none', background: 'transparent', font: 'inherit', padding: 0, width: '100%' }} />
    </div>
  )

  const settingsPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginBottom: 2 }}>Page settings</div>
        <div style={{ fontSize: 11, color: C.textMuted }}>Select a component to configure it.</div>
      </div>
      <Field label="Module" help="Which module's Home tab this page is (or Global Home).">
        <select value={meta.moduleId || ''} onChange={e => setMeta(m => ({ ...m, moduleId: e.target.value || null }))} style={inputStyle()}>
          <option value="">Global Home</option>
          {NAV_MODULES.filter(m => m.id !== 'admin' && m.id !== 'home').map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Role" help="Assign to one role, or leave for all roles in the module.">
        <select value={meta.roleId || ''} onChange={e => setMeta(m => ({ ...m, roleId: e.target.value || null }))} style={inputStyle()}>
          <option value="">All roles in module</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}>
        <input type="checkbox" checked={meta.isActive} onChange={e => setMeta(m => ({ ...m, isActive: e.target.checked }))} /> Active
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textPrimary, cursor: 'pointer' }}
        title="Use as the org-wide default home for roles without their own page">
        <input type="checkbox" checked={meta.isDefault} onChange={e => setMeta(m => ({ ...m, isDefault: e.target.checked }))} /> Org default
      </label>
    </div>
  )

  return (
    <LeapCanvas
      key={pageId}
      registry={homeRegistry}
      sources={sources}
      initialComponents={loaded.components}
      initialLayout={loaded.layout}
      headerExtra={headerExtra}
      settingsPanel={settingsPanel}
      onSave={handleSave}
      onClose={onClose}
    />
  )
}
