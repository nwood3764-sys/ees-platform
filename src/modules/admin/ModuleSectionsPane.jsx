import { useState, useEffect } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import { fetchAllModuleSections, saveModuleSections, addModuleObjectSection } from '../../data/adminService'
import { OBJECT_CATALOG } from './objectCatalog'

// ---------------------------------------------------------------------------
// Module Sections editor — admin configures each module's tab strip:
// reorder (drag), rename (inline), and show/hide. DB-driven via
// module_sections; modules read it through useModuleSections. Custom
// dashboards stay in code — this controls the tab strip's order/labels/
// visibility, the Salesforce "App Navigation Items" equivalent.
// ---------------------------------------------------------------------------

const MODULE_LABELS = {
  outreach: 'Outreach', enrollment: 'Enrollment', qualification: 'Qualification', field: 'Field',
  incentives: 'Incentives', stock: 'Stock', fleet: 'Fleet',
  planning: 'Project Planning', implementation: 'Project Implementation',
  tasks: 'Tasks', portal: 'Portal', reports: 'Reports',
}

export default function ModuleSectionsPane({ initialModuleId } = {}) {
  const toast = useToast()
  const [allSections, setAllSections] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeModule, setActiveModule] = useState(null)
  const [draft, setDraft] = useState([])    // working copy for the active module
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [addObject, setAddObject] = useState('')
  const [adding, setAdding] = useState(false)

  // Add an object as a new tab on the active module, then reload so it appears.
  const handleAddObject = async () => {
    if (!addObject || !activeModule) return
    setAdding(true)
    try {
      const obj = OBJECT_CATALOG.find(o => o.table === addObject)
      await addModuleObjectSection(activeModule, addObject, obj?.pluralLabel || obj?.label || null)
      const rows = await fetchAllModuleSections()
      setAllSections(rows)
      setAddObject('')
      toast?.success?.('Object tab added')
    } catch (e) {
      toast?.error?.(e.message || 'Could not add object tab')
    } finally {
      setAdding(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchAllModuleSections()
      .then(rows => {
        if (cancelled) return
        setAllSections(rows)
        // Pre-select the module the gear deep-linked to (initialModuleId) when
        // it exists in the loaded set; otherwise fall back to the first module.
        const hasInitial = initialModuleId && rows.some(r => r.moduleId === initialModuleId)
        const firstMod = hasInitial ? initialModuleId : (rows[0]?.moduleId || null)
        setActiveModule(firstMod)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Build the draft whenever the active module changes.
  useEffect(() => {
    if (!activeModule) return
    setDraft(
      allSections
        .filter(s => s.moduleId === activeModule)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(s => ({ ...s }))
    )
  }, [activeModule, allSections])

  const modules = [...new Set(allSections.map(s => s.moduleId))]

  function rename(sectionId, label) {
    setDraft(d => d.map(s => s.sectionId === sectionId ? { ...s, label } : s))
  }
  function toggleVisible(sectionId) {
    setDraft(d => d.map(s => s.sectionId === sectionId ? { ...s, visible: !s.visible } : s))
  }
  function onDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return }
    setDraft(d => {
      const arr = [...d]
      const from = arr.findIndex(s => s.sectionId === dragId)
      const to = arr.findIndex(s => s.sectionId === targetId)
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return arr
    })
    setDragId(null); setDragOverId(null)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = draft.map((s, i) => ({
        section_id: s.sectionId,
        label: s.label,
        sort_order: i,
        is_visible: s.visible,
      }))
      await saveModuleSections(activeModule, payload)
      // Reflect saved order/labels back into allSections.
      setAllSections(prev => prev.map(s => {
        if (s.moduleId !== activeModule) return s
        const idx = draft.findIndex(d => d.sectionId === s.sectionId)
        const d = draft[idx]
        return d ? { ...s, label: d.label, visible: d.visible, sortOrder: idx } : s
      }))
      toast.success(`Saved ${MODULE_LABELS[activeModule] || activeModule} tabs`)
    } catch (e) {
      toast.error(`Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ padding: 40, color: C.textMuted, fontSize: 13 }}>Loading module sections…</div>
  if (error) return <div style={{ padding: 20, color: '#1a5a8a', fontSize: 12.5 }}>{String(error.message || error)}</div>

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary }}>Module Tabs</div>
        <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 2 }}>
          Reorder, rename, and show or hide the tabs in each module's navigation. Changes apply to all users.
        </div>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '220px 1fr', overflow: 'hidden' }}>
        {/* Module list */}
        <div style={{ borderRight: `1px solid ${C.border}`, overflow: 'auto', background: '#fafbfd' }}>
          {modules.map(m => (
            <div
              key={m}
              onClick={() => setActiveModule(m)}
              style={{
                padding: '11px 18px', cursor: 'pointer', fontSize: 13,
                borderLeft: m === activeModule ? `3px solid ${C.emerald}` : '3px solid transparent',
                background: m === activeModule ? '#fff' : 'transparent',
                color: m === activeModule ? C.textPrimary : C.textSecondary,
                fontWeight: m === activeModule ? 600 : 400,
              }}
            >
              {MODULE_LABELS[m] || m}
            </div>
          ))}
        </div>

        {/* Tab editor for active module */}
        <div style={{ overflow: 'auto', padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary }}>
              {MODULE_LABELS[activeModule] || activeModule} — {draft.length} tab{draft.length === 1 ? '' : 's'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={addObject}
                onChange={e => setAddObject(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, color: C.textSecondary, background: C.card, maxWidth: 220 }}
              >
                <option value="">+ Add object tab…</option>
                {[...OBJECT_CATALOG].sort((a,b)=>a.label.localeCompare(b.label)).map(o => (
                  <option key={o.table} value={o.table}>{o.pluralLabel || o.label}</option>
                ))}
              </select>
              <button
                onClick={handleAddObject}
                disabled={!addObject || adding}
                style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12.5, fontWeight: 600, cursor: (!addObject || adding) ? 'default' : 'pointer', background: C.card, color: C.textSecondary }}
              >
                {adding ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: saving ? 'default' : 'pointer', background: saving ? '#cfe9da' : C.emerald, color: '#fff' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', background: C.card }}>
            <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 120px 90px', gap: 8, padding: '9px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div></div><div>Tab Label</div><div>Section Key</div><div style={{ textAlign: 'center' }}>Visible</div>
            </div>
            {draft.map(s => (
              <div
                key={s.sectionId}
                draggable
                onDragStart={() => setDragId(s.sectionId)}
                onDragOver={e => { e.preventDefault(); setDragOverId(s.sectionId) }}
                onDrop={() => onDrop(s.sectionId)}
                onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 120px 90px', gap: 8, alignItems: 'center',
                  padding: '8px 14px', borderBottom: `1px solid ${C.border}`,
                  background: dragOverId === s.sectionId && dragId !== s.sectionId ? '#f0faf5' : (s.visible ? 'transparent' : '#fafbfd'),
                  opacity: dragId === s.sectionId ? 0.5 : 1,
                }}
              >
                <div style={{ cursor: 'grab', color: C.textMuted, textAlign: 'center', fontSize: 14 }} title="Drag to reorder">⋮⋮</div>
                <input
                  value={s.label}
                  onChange={e => rename(s.sectionId, e.target.value)}
                  style={{ border: `1px solid ${C.border}`, borderRadius: 5, padding: '6px 9px', fontSize: 12.5, background: C.page, color: C.textPrimary, outline: 'none' }}
                  onFocus={e => e.currentTarget.style.borderColor = C.emerald}
                  onBlur={e => e.currentTarget.style.borderColor = C.border}
                />
                <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{s.sectionId}</div>
                <div style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={s.visible} onChange={() => toggleVisible(s.sectionId)} style={{ accentColor: C.emerald, width: 16, height: 16, cursor: 'pointer' }} />
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
            Drag the handle to reorder. Edit a label to rename a tab. Uncheck Visible to hide a tab from this module's navigation (the underlying object stays accessible from other modules and the Object Manager).
          </div>
        </div>
      </div>
    </div>
  )
}
