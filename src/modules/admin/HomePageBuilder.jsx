import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  fetchHomePages, fetchHomePage, saveHomePage,
  fetchRoles, fetchSavedListViews,
} from '../../data/adminService'
import { fetchDashboards, fetchReports } from '../../data/reportsService'
import { HOME_TEMPLATES, getTemplate, COMPONENT_TYPES, getComponentType } from './homePageTemplates'
import HomeComponentRenderer from './HomeComponentRenderer'

// ---------------------------------------------------------------------------
// Home Page Builder — App-Builder-style editor for the home/landing screen.
// Left: list of saved pages + New Page. Editor: page settings (name, template,
// role assignment, active/default), a component palette, a region canvas with
// drag-to-add and per-component properties, and Save.
// ---------------------------------------------------------------------------

let _cid = 0
const newCid = () => `c${Date.now()}_${_cid++}`

export default function HomePageBuilder() {
  const toast = useToast()
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // page object being edited | null
  const [sources, setSources] = useState({ dashboards: [], reports: [], listViews: [], roles: [] })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchHomePages().catch(() => []),
      fetchDashboards().catch(() => []),
      fetchReports().catch(() => []),
      fetchSavedListViews().catch(() => []),
      fetchRoles().catch(() => []),
    ]).then(([pgs, dbs, reps, lvs, roles]) => {
      if (cancelled) return
      setPages(pgs)
      setSources({
        dashboards: dbs.map(d => ({ id: d.id, name: d.name || d.dashboard_name || 'Dashboard' })),
        reports: reps.map(r => ({ id: r.id, name: r.name || r.report_name || 'Report' })),
        listViews: lvs.map(v => ({ id: v.id, name: v.name || v.label || 'List View', object: v.object || v.listObject })),
        roles: roles.map(r => ({ id: r.id, name: r.name || r.role_name || 'Role' })),
      })
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function openPage(id) {
    try {
      const p = await fetchHomePage(id)
      setEditing({
        ...p,
        components: p.components.map(c => ({ ...c, cid: newCid() })),
      })
    } catch (e) { toast.error(`Could not open page: ${e.message || e}`) }
  }

  function newPage() {
    setEditing({
      id: null, name: 'New Home Page', template: 'two_thirds_one_third',
      roleId: null, isActive: false, isDefault: false, components: [],
    })
  }

  async function reloadList() {
    setPages(await fetchHomePages().catch(() => []))
  }

  if (loading) return <div style={{ padding: 40, color: C.textMuted, fontSize: 13 }}>Loading home pages…</div>

  if (editing) {
    return <PageEditor page={editing} sources={sources} toast={toast}
      onClose={() => setEditing(null)}
      onSaved={async () => { await reloadList(); setEditing(null) }} />
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Home Pages</div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>Build and assign the landing screen users see. Assign a page to a role, or set one as the org-wide default.</div>
        </div>
        <button onClick={newPage} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon path="M12 5v14M5 12h14" size={13} color="currentColor" /> New Page
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        {pages.length === 0 && <div style={{ color: C.textMuted, fontSize: 13 }}>No home pages yet. Create one to replace the built-in home screen.</div>}
        {pages.length > 0 && (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.card }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 100px 90px', gap: 8, padding: '10px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div>Name</div><div>Assignment</div><div>Template</div><div style={{ textAlign: 'center' }}>Status</div><div></div>
            </div>
            {pages.map(p => {
              const roleName = p.roleId ? (sources.roles.find(r => r.id === p.roleId)?.name || 'Role') : (p.isDefault ? 'Org default' : 'Unassigned')
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 100px 90px', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5 }}>
                  <div style={{ color: C.textPrimary, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ color: C.textSecondary }}>{roleName}</div>
                  <div style={{ color: C.textMuted, fontSize: 11.5 }}>{getTemplate(p.template).label}</div>
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: p.isActive ? '#e8f8f2' : '#eef1f6', color: p.isActive ? '#1a7a4e' : C.textMuted }}>{p.isActive ? 'ACTIVE' : 'DRAFT'}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span onClick={() => openPage(p.id)} style={{ cursor: 'pointer', fontSize: 11.5, color: C.emerald, fontWeight: 600 }}>Edit</span>
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

function PageEditor({ page, sources, toast, onClose, onSaved }) {
  const [name, setName] = useState(page.name)
  const [template, setTemplate] = useState(page.template)
  const [roleId, setRoleId] = useState(page.roleId || '')
  const [isActive, setIsActive] = useState(page.isActive)
  const [isDefault, setIsDefault] = useState(page.isDefault)
  const [components, setComponents] = useState(page.components)
  const [selectedCid, setSelectedCid] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dragType, setDragType] = useState(null)

  const tmpl = getTemplate(template)
  const selected = components.find(c => c.cid === selectedCid) || null

  function addComponent(region, typeId) {
    const t = getComponentType(typeId)
    if (!t) return
    const c = { cid: newCid(), region, type: typeId, sourceId: null, title: '', config: {}, sortOrder: components.filter(x => x.region === region).length }
    setComponents(prev => [...prev, c])
    setSelectedCid(c.cid)
  }
  function removeComponent(cid) {
    setComponents(prev => prev.filter(c => c.cid !== cid))
    if (selectedCid === cid) setSelectedCid(null)
  }
  function patchSelected(patch) {
    setComponents(prev => prev.map(c => c.cid === selectedCid ? { ...c, ...patch } : c))
  }
  function patchSelectedConfig(patch) {
    setComponents(prev => prev.map(c => c.cid === selectedCid ? { ...c, config: { ...c.config, ...patch } } : c))
  }

  // When switching template, keep components whose region still exists; move
  // orphaned ones to the first region.
  function changeTemplate(id) {
    const next = getTemplate(id)
    const keys = next.regions.map(r => r.key)
    setComponents(prev => prev.map(c => keys.includes(c.region) ? c : { ...c, region: keys[0] }))
    setTemplate(id)
  }

  async function save() {
    setSaving(true)
    try {
      await saveHomePage(
        { id: page.id, name, template, roleId: roleId || null, isActive, isDefault },
        components,
      )
      toast.success('Home page saved')
      onSaved && onSaved()
    } catch (e) {
      toast.error(`Save failed: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  const inputStyle = { padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12.5, background: C.page, color: C.textPrimary, outline: 'none' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header / settings */}
      <div style={{ padding: '12px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textMuted, cursor: 'pointer', marginBottom: 10 }}>
          <Icon path="M15 19l-7-7 7-7" size={12} color="currentColor" /> Home Pages
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Page name" style={{ ...inputStyle, flex: 1, minWidth: 200, fontWeight: 600 }} />
          <select value={template} onChange={e => changeTemplate(e.target.value)} style={inputStyle}>
            {HOME_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <select value={roleId} onChange={e => setRoleId(e.target.value)} style={inputStyle}>
            <option value="">Org default (all roles)</option>
            {sources.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textPrimary, cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} style={{ accentColor: C.emerald, width: 15, height: 15 }} /> Active
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textPrimary, cursor: 'pointer' }}
            title="Use this page as the org-wide default home for roles without their own page">
            <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} style={{ accentColor: C.emerald, width: 15, height: 15 }} /> Org default
          </label>
          <button onClick={save} disabled={saving} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: saving ? '#cfe9da' : C.emerald, color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Body: palette | canvas | properties */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '180px 1fr 260px', overflow: 'hidden' }}>
        {/* Palette */}
        <div style={{ borderRight: `1px solid ${C.border}`, overflow: 'auto', padding: '12px', background: '#fafbfd' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Components</div>
          {COMPONENT_TYPES.map(t => (
            <div key={t.id} draggable onDragStart={() => setDragType(t.id)} onDragEnd={() => setDragType(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'grab', fontSize: 12 }}>
              <Icon path={t.icon} size={14} color={C.emerald} /> {t.label}
            </div>
          ))}
          <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 8, lineHeight: 1.5 }}>Drag a component into a region, or click a region’s “+ Add” menu.</div>
        </div>

        {/* Canvas */}
        <div style={{ overflow: 'auto', padding: '16px', background: C.page }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {tmpl.regions.map(region => {
              const regionComps = components.filter(c => c.region === region.key)
              return (
                <div key={region.key} style={{ flex: region.flex, minWidth: 0 }}
                  onDragOver={e => { if (dragType) e.preventDefault() }}
                  onDrop={() => { if (dragType) { addComponent(region.key, dragType); setDragType(null) } }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {region.label}
                    <RegionAddMenu onAdd={(typeId) => addComponent(region.key, typeId)} />
                  </div>
                  <div style={{ minHeight: 120, border: `1.5px dashed ${dragType ? C.emerald : C.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 10, background: dragType ? '#f0faf5' : 'transparent' }}>
                    {regionComps.length === 0 && <div style={{ color: C.textMuted, fontSize: 11.5, textAlign: 'center', padding: '20px 0' }}>Drop components here</div>}
                    {regionComps.map(c => (
                      <div key={c.cid} onClick={() => setSelectedCid(c.cid)}
                        style={{ position: 'relative', outline: selectedCid === c.cid ? `2px solid ${C.emerald}` : 'none', borderRadius: 10, cursor: 'pointer' }}>
                        <HomeComponentRenderer component={c} preview sources={sources} />
                        <div onClick={(e) => { e.stopPropagation(); removeComponent(c.cid) }}
                          style={{ position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 5, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} title="Remove">
                          <Icon path="M6 18L18 6M6 6l12 12" size={12} color={C.textMuted} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Properties */}
        <div style={{ borderLeft: `1px solid ${C.border}`, overflow: 'auto', padding: '14px', background: '#fafbfd' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Properties</div>
          {!selected && <div style={{ fontSize: 12, color: C.textMuted }}>Select a component to edit its properties.</div>}
          {selected && <PropertiesPanel component={selected} sources={sources} onPatch={patchSelected} onPatchConfig={patchSelectedConfig} />}
        </div>
      </div>
    </div>
  )
}

function RegionAddMenu({ onAdd }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative' }}>
      <span onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', color: C.emerald, fontWeight: 600, fontSize: 11 }}>+ Add</span>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '120%', zIndex: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', width: 170, overflow: 'hidden' }}>
          {COMPONENT_TYPES.map(t => (
            <div key={t.id} onClick={() => { onAdd(t.id); setOpen(false) }}
              style={{ padding: '8px 12px', fontSize: 12, color: C.textPrimary, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0faf5'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <Icon path={t.icon} size={13} color={C.emerald} /> {t.label}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

function PropertiesPanel({ component, sources, onPatch, onPatchConfig }) {
  const t = getComponentType(component.type)
  const inputStyle = { width: '100%', padding: '7px 9px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, background: C.card, color: C.textPrimary, outline: 'none', boxSizing: 'border-box' }
  const fieldWrap = (lbl, node) => <div style={{ marginBottom: 12 }}><div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>{lbl}</div>{node}</div>

  const sourceList = t?.source === 'dashboard' ? sources.dashboards : t?.source === 'report' ? sources.reports : t?.source === 'list_view' ? sources.listViews : null

  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary, marginBottom: 10 }}>{t?.label || component.type}</div>
      {fieldWrap('Title (optional)', <input value={component.title || ''} onChange={e => onPatch({ title: e.target.value })} placeholder="Override title" style={inputStyle} />)}

      {sourceList && fieldWrap(t.source === 'dashboard' ? 'Dashboard' : t.source === 'report' ? 'Report' : 'List View',
        <select value={component.sourceId || ''} onChange={e => onPatch({ sourceId: e.target.value || null })} style={inputStyle}>
          <option value="">Select…</option>
          {sourceList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>)}

      {component.type === 'metric_card' && (<>
        {fieldWrap('Value', <input value={component.config.value ?? ''} onChange={e => onPatchConfig({ value: e.target.value })} placeholder="e.g. 128" style={inputStyle} />)}
        {fieldWrap('Subtitle', <input value={component.config.subtitle ?? ''} onChange={e => onPatchConfig({ subtitle: e.target.value })} style={inputStyle} />)}
      </>)}

      {(component.type === 'percentage_card' || component.type === 'gauge') && (<>
        {fieldWrap('Percent (0–100)', <input type="number" min="0" max="100" value={component.config.percent ?? 0} onChange={e => onPatchConfig({ percent: Number(e.target.value) })} style={inputStyle} />)}
        {fieldWrap('Subtitle', <input value={component.config.subtitle ?? ''} onChange={e => onPatchConfig({ subtitle: e.target.value })} style={inputStyle} />)}
        {fieldWrap('Color', <input type="color" value={component.config.color || '#1f9d6e'} onChange={e => onPatchConfig({ color: e.target.value })} style={{ ...inputStyle, padding: 2, height: 32 }} />)}
      </>)}

      {component.type === 'rich_text' && fieldWrap('Text', <textarea value={component.config.text || ''} onChange={e => onPatchConfig({ text: e.target.value })} rows={6} style={{ ...inputStyle, resize: 'vertical' }} />)}

      {component.type === 'task_list' && <div style={{ fontSize: 11.5, color: C.textMuted }}>Shows the current user’s open tasks. No configuration needed.</div>}
    </div>
  )
}
