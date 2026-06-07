import { useState, useEffect, useMemo } from 'react'
import { C } from '../../data/constants'
import { Icon } from '../../components/UI'
import { useToast } from '../../components/Toast'
import {
  fetchFieldValues,
  fetchRecordTypesFor,
  fetchRecordTypeValueAssignments,
  setRecordTypePicklistValues,
  addFieldValue,
  updateFieldValue,
  reorderFieldValues,
} from '../../data/adminService'

// ---------------------------------------------------------------------------
// Field Picklist Editor — managed hierarchy:
//   Object → Field → values → per Record Type, which values are available.
//
// Top: the field's master value list — add, rename, activate/deactivate, and
// reorder values. Bottom: per record type, which of those values are available
// (the availability matrix). An empty availability set means "universal" — all
// values show for that record type (no restriction).
// ---------------------------------------------------------------------------

export default function FieldPicklistEditor({ objectName, objectLabel, field, onBack }) {
  const toast = useToast()
  const [values, setValues] = useState([])
  const [recordTypes, setRecordTypes] = useState([])
  const [assignments, setAssignments] = useState({}) // rt_id -> Set(value_id)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [activeRtId, setActiveRtId] = useState(null)
  const [draft, setDraft] = useState(null) // Set(value_id) | null(universal)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')
  const [rtSearch, setRtSearch] = useState('')

  // Value-management state
  const [addingValue, setAddingValue] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingValueId, setEditingValueId] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [valDragId, setValDragId] = useState(null)
  const [valDragOverId, setValDragOverId] = useState(null)
  const [valBusy, setValBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([
      fetchFieldValues(objectName, field),
      fetchRecordTypesFor(objectName),
      fetchRecordTypeValueAssignments(objectName, field),
    ]).then(([vals, rts, asg]) => {
      if (cancelled) return
      setValues(vals)
      setRecordTypes(rts)
      setAssignments(asg.map || {})
      // Default-select the first active record type.
      const firstRt = rts.find(r => r.active) || rts[0]
      if (firstRt) {
        setActiveRtId(firstRt._id)
        const set = (asg.map || {})[firstRt._id]
        setDraft(set ? new Set(set) : null)
      }
      setLoading(false)
    }).catch(e => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [objectName, field])

  async function reloadValues() {
    const vals = await fetchFieldValues(objectName, field)
    setValues(vals)
  }

  async function commitNewValue() {
    const label = newLabel.trim()
    const value = (newValue.trim() || label)
    if (!label) return
    setValBusy(true)
    try {
      const maxOrder = values.reduce((m, v) => Math.max(m, v.sortOrder), -1)
      await addFieldValue(objectName, field, value, label, maxOrder + 1)
      await reloadValues()
      setAddingValue(false); setNewLabel(''); setNewValue('')
      toast.success(`Added "${label}"`)
    } catch (e) {
      toast.error(`Add failed: ${e.message || e}`)
    } finally { setValBusy(false) }
  }

  async function commitRename(id) {
    const label = editLabel.trim()
    if (!label) { setEditingValueId(null); return }
    setValBusy(true)
    try {
      await updateFieldValue(id, { label })
      await reloadValues()
      setEditingValueId(null)
      toast.success('Value renamed')
    } catch (e) {
      toast.error(`Rename failed: ${e.message || e}`)
    } finally { setValBusy(false) }
  }

  async function toggleValueActive(v) {
    setValBusy(true)
    try {
      await updateFieldValue(v._id, { isActive: !v.active })
      await reloadValues()
      toast.success(v.active ? `Deactivated "${v.label}"` : `Activated "${v.label}"`)
    } catch (e) {
      toast.error(`Update failed: ${e.message || e}`)
    } finally { setValBusy(false) }
  }

  async function onValueDrop(targetId) {
    if (!valDragId || valDragId === targetId) { setValDragId(null); setValDragOverId(null); return }
    const arr = [...values]
    const from = arr.findIndex(v => v._id === valDragId)
    const to = arr.findIndex(v => v._id === targetId)
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    setValues(arr) // optimistic
    setValDragId(null); setValDragOverId(null)
    setValBusy(true)
    try {
      await reorderFieldValues(arr.map(v => v._id))
      toast.success('Reordered')
    } catch (e) {
      toast.error(`Reorder failed: ${e.message || e}`)
      await reloadValues()
    } finally { setValBusy(false) }
  }

  function selectRt(rt) {
    setActiveRtId(rt._id)
    setSavedNote('')
    const set = assignments[rt._id]
    setDraft(set ? new Set(set) : null)
  }

  // A record type with draft===null is universal (all values). Toggling a value
  // when universal converts to an explicit set seeded with ALL values, then
  // removes the toggled one (so the user is now scoping).
  function toggleValue(valueId) {
    setSavedNote('')
    setDraft(prev => {
      let next
      if (prev == null) {
        next = new Set(values.map(v => v._id)) // was universal → start from all
      } else {
        next = new Set(prev)
      }
      if (next.has(valueId)) next.delete(valueId)
      else next.add(valueId)
      return next
    })
  }

  function makeUniversal() {
    setSavedNote('')
    setDraft(null)
  }
  function selectAll() {
    setSavedNote('')
    setDraft(new Set(values.map(v => v._id)))
  }
  function selectNone() {
    setSavedNote('')
    setDraft(new Set())
  }

  async function save() {
    if (!activeRtId) return
    setSaving(true); setSavedNote('')
    try {
      // Universal (null) → empty array clears all scoping rows for this RT+field.
      const ids = draft == null ? [] : Array.from(draft)
      await setRecordTypePicklistValues(activeRtId, objectName, field, ids)
      // Reflect into local assignments map.
      setAssignments(prev => {
        const next = { ...prev }
        if (draft == null || ids.length === 0) delete next[activeRtId]
        else next[activeRtId] = new Set(ids)
        return next
      })
      setSavedNote(draft == null ? 'Saved — all values available (universal).' : `Saved — ${ids.length} value${ids.length === 1 ? '' : 's'} available.`)
    } catch (e) {
      setSavedNote('Save failed: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  const activeRt = recordTypes.find(r => r._id === activeRtId)
  const isUniversal = draft == null
  const checkedCount = draft == null ? values.length : draft.size

  // Dirty check vs persisted assignment.
  const dirty = useMemo(() => {
    if (!activeRtId) return false
    const saved = assignments[activeRtId]
    if (draft == null) return !!saved // universal now; was scoped before
    if (!saved) return draft.size !== values.length ? true : false // was universal
    if (saved.size !== draft.size) return true
    for (const id of draft) if (!saved.has(id)) return true
    return false
  }, [draft, assignments, activeRtId, values.length])

  const filteredRts = rtSearch.trim()
    ? recordTypes.filter(r => (r.label + r.value).toLowerCase().includes(rtSearch.trim().toLowerCase()))
    : recordTypes

  return (
    <div style={{ padding: '16px 24px' }}>
      <div
        onClick={onBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: C.textMuted, cursor: 'pointer', marginBottom: 12 }}
        onMouseEnter={e => e.currentTarget.style.color = C.emerald}
        onMouseLeave={e => e.currentTarget.style.color = C.textMuted}
      >
        <Icon path="M15 19l-7-7 7-7" size={12} color="currentColor" /> Fields &amp; Relationships
      </div>

      <div style={{ marginBottom: 4, fontSize: 16, fontWeight: 600, color: C.textPrimary, fontFamily: 'JetBrains Mono, monospace' }}>
        {field}
      </div>
      <div style={{ marginBottom: 16, fontSize: 12, color: C.textSecondary }}>
        Picklist field on <strong>{objectLabel}</strong> · {values.length} value{values.length === 1 ? '' : 's'} · manage values below, then set which are available per record type.
      </div>

      {loading && <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>Loading field…</div>}
      {error && !loading && (
        <div style={{ padding: 20, color: '#b03a2e', fontSize: 12.5 }}>{String(error.message || error)}</div>
      )}

      {!loading && !error && (
      <>
        {/* ── Field Values: add / rename / activate / reorder ── */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Field Values</div>
            <button onClick={() => { setAddingValue(true); setNewLabel(''); setNewValue('') }}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: C.emerald, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon path="M12 5v14M5 12h14" size={12} color="currentColor" /> New Value
            </button>
          </div>

          {addingValue && (
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, background: '#f7faff', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input autoFocus value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Label (shown to users)"
                style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none' }} />
              <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Stored value (optional, defaults to label)"
                style={{ flex: 1, minWidth: 180, padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
              <button onClick={commitNewValue} disabled={valBusy || !newLabel.trim()}
                style={{ padding: '7px 14px', borderRadius: 5, border: 'none', background: newLabel.trim() ? C.emerald : '#cfe9da', color: '#fff', fontSize: 12, fontWeight: 600, cursor: newLabel.trim() ? 'pointer' : 'default' }}>Add</button>
              <button onClick={() => setAddingValue(false)}
                style={{ padding: '7px 12px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 110px 100px', gap: 8, padding: '8px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <div></div><div>Label</div><div>Stored Value</div><div style={{ textAlign: 'center' }}>Status</div><div style={{ textAlign: 'right' }}>Actions</div>
          </div>
          {values.map(v => (
            <div key={v._id}
              draggable={editingValueId !== v._id}
              onDragStart={() => setValDragId(v._id)}
              onDragOver={e => { e.preventDefault(); setValDragOverId(v._id) }}
              onDrop={() => onValueDrop(v._id)}
              onDragEnd={() => { setValDragId(null); setValDragOverId(null) }}
              style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 110px 100px', gap: 8, alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${C.border}`,
                background: valDragOverId === v._id && valDragId !== v._id ? '#f0faf5' : (v.active ? 'transparent' : '#fafbfd'),
                opacity: valDragId === v._id ? 0.5 : (v.active ? 1 : 0.6) }}>
              <div style={{ cursor: 'grab', color: C.textMuted, textAlign: 'center', fontSize: 14 }} title="Drag to reorder">⋮⋮</div>
              {editingValueId === v._id ? (
                <input autoFocus value={editLabel} onChange={e => setEditLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(v._id); if (e.key === 'Escape') setEditingValueId(null) }}
                  style={{ padding: '6px 9px', border: `1px solid ${C.emerald}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none' }} />
              ) : (
                <div style={{ fontSize: 12.5, color: C.textPrimary }}>{v.label}</div>
              )}
              <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{v.value}</div>
              <div style={{ textAlign: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3, background: v.active ? '#e8f8f2' : '#eef1f6', color: v.active ? '#1a7a4e' : C.textMuted }}>
                  {v.active ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {editingValueId === v._id ? (
                  <button onClick={() => commitRename(v._id)} disabled={valBusy}
                    style={{ padding: '4px 9px', borderRadius: 5, border: 'none', background: C.emerald, color: '#fff', fontSize: 11, cursor: 'pointer' }}>Save</button>
                ) : (
                  <button onClick={() => { setEditingValueId(v._id); setEditLabel(v.label) }}
                    style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 11, cursor: 'pointer' }}>Rename</button>
                )}
                <button onClick={() => toggleValueActive(v)} disabled={valBusy}
                  style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: v.active ? '#b3541e' : '#1a7a4e', fontSize: 11, cursor: 'pointer' }}>
                  {v.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
          {values.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>No values yet. Add the first one.</div>
          )}
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary, marginBottom: 8 }}>Availability per Record Type</div>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          {/* Record type list */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Record Types
            </div>
            <div style={{ padding: 8 }}>
              <input
                value={rtSearch}
                onChange={e => setRtSearch(e.target.value)}
                placeholder="Filter record types…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, background: C.page, color: C.textPrimary, outline: 'none', marginBottom: 6 }}
              />
            </div>
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {filteredRts.map(rt => {
                const scoped = !!assignments[rt._id]
                const isActive = rt._id === activeRtId
                return (
                  <div
                    key={rt._id}
                    onClick={() => selectRt(rt)}
                    style={{
                      padding: '9px 12px', cursor: 'pointer', fontSize: 12.5,
                      borderLeft: isActive ? `3px solid ${C.emerald}` : '3px solid transparent',
                      background: isActive ? '#f0faf5' : 'transparent',
                      color: rt.active ? C.textPrimary : C.textMuted,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rt.label}{!rt.active && ' (inactive)'}
                    </span>
                    <span style={{
                      fontSize: 9.5, fontWeight: 700, padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                      background: scoped ? '#e8f3fb' : '#eef1f6',
                      color: scoped ? '#1a5a8a' : C.textMuted,
                    }}>
                      {scoped ? 'SCOPED' : 'ALL'}
                    </span>
                  </div>
                )
              })}
              {filteredRts.length === 0 && (
                <div style={{ padding: 14, fontSize: 12, color: C.textMuted }}>No record types match.</div>
              )}
            </div>
          </div>

          {/* Value availability for the selected record type */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>
                {activeRt ? <>Available values for <span style={{ color: C.emerald }}>{activeRt.label}</span></> : 'Select a record type'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <MiniBtn onClick={selectAll} label="All" />
                <MiniBtn onClick={selectNone} label="None" />
                <MiniBtn onClick={makeUniversal} label="Universal" title="Clear scoping — all values available, like a record type with no picklist restrictions" />
              </div>
            </div>

            {activeRt && (
              <>
                <div style={{ padding: '8px 14px', fontSize: 11.5, color: isUniversal ? '#1a7a4e' : C.textSecondary, background: isUniversal ? '#f0faf5' : '#fafbfd', borderBottom: `1px solid ${C.border}` }}>
                  {isUniversal
                    ? 'Universal — every value on this field is available for this record type (no restriction).'
                    : `${checkedCount} of ${values.length} values available for this record type.`}
                </div>
                <div style={{ maxHeight: 380, overflow: 'auto' }}>
                  {values.map(v => {
                    const checked = isUniversal || draft.has(v._id)
                    return (
                      <label
                        key={v._id}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', fontSize: 12.5, color: v.active ? C.textPrimary : C.textMuted }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleValue(v._id)} style={{ accentColor: C.emerald, width: 15, height: 15 }} />
                        <span style={{ flex: 1 }}>{v.label}{!v.active && ' (inactive value)'}</span>
                        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{v.value}</span>
                      </label>
                    )
                  })}
                  {values.length === 0 && (
                    <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>This field has no values.</div>
                  )}
                </div>
                <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={save}
                    disabled={saving || !dirty}
                    style={{
                      padding: '7px 16px', borderRadius: 6, border: 'none', fontSize: 12.5, fontWeight: 600,
                      cursor: saving || !dirty ? 'default' : 'pointer',
                      background: dirty && !saving ? C.emerald : '#cfe9da', color: '#fff',
                    }}
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  {savedNote && <span style={{ fontSize: 11.5, color: savedNote.startsWith('Save failed') ? '#b03a2e' : '#1a7a4e' }}>{savedNote}</span>}
                  {dirty && !savedNote && <span style={{ fontSize: 11.5, color: C.textMuted }}>Unsaved changes</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </>
      )}
    </div>
  )
}

function MiniBtn({ onClick, label, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 11.5, cursor: 'pointer' }}
    >
      {label}
    </button>
  )
}
