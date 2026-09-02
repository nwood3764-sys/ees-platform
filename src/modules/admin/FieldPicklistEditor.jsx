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
  reorderFieldValuesForRecordType,
  fetchRecordTypeValueOrder,
  fetchPicklistFieldScoping,
} from '../../data/adminService'
import { valuesScopedElsewhere, availableEmptyMessage } from '../../lib/picklistValueSharing'

// ---------------------------------------------------------------------------
// Field Picklist Editor — Salesforce "record type → picklist values" model.
//
// Pick a record type, then a two-panel transfer UI:
//   * Available Values (left)  = every value on the field (searchable/sortable).
//   * Selected Values (right)  = the values this record type shows, IN ORDER.
// Drag values between panels, drag or use ↑/↓ to order the Selected side.
//
// What Selected-empty means depends on the FIELD, and the screen says which:
//   * an attribute picklist  ⇒ the record type shows ALL values, incl. any
//     added later;
//   * a record LIFECYCLE field (picklist_field_record_type_scoping) ⇒ the
//     record type shows NONE, because "every status the object owns" is not a
//     lifecycle. It has to be authored here.
// Either way the left panel ALWAYS shows the full list — nothing is hidden
// behind a prompt.
//
// A collapsible section below manages the field's master value list (add,
// rename, describe, activate, reorder) — the values that feed both panels.
// ---------------------------------------------------------------------------

export default function FieldPicklistEditor({ objectName, objectLabel, field, columnName, onBack }) {
  const toast = useToast()
  const [values, setValues] = useState([])
  const [recordTypes, setRecordTypes] = useState([])
  const [assignments, setAssignments] = useState({}) // rtId -> Set(valueId), persisted
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Per-record-type working state. `selected` is the ordered set of value ids
  // shown for this record type; EMPTY means universal (all values).
  const [activeRtId, setActiveRtId] = useState(null)
  const [selected, setSelected] = useState([])
  const [savedSelected, setSavedSelected] = useState([])
  const [availSearch, setAvailSearch] = useState('')
  const [availSort, setAvailSort] = useState('master') // 'master' | 'label' | 'value'
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState('')

  // Transfer drag state.
  const [drag, setDrag] = useState(null)                // { id, from:'available'|'selected' }
  const [overId, setOverId] = useState(null)            // selected-row drop target
  const [overSelectedPanel, setOverSelectedPanel] = useState(false)
  const [overAvailablePanel, setOverAvailablePanel] = useState(false)

  // Inline "New Value" from the Available panel (create without leaving the screen).
  const [wsAdding, setWsAdding] = useState(false)
  const [wsLabel, setWsLabel] = useState('')
  const [wsValue, setWsValue] = useState('')

  // Master value-list management (collapsible).
  const [showMaster, setShowMaster] = useState(false)
  const [addingValue, setAddingValue] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingValueId, setEditingValueId] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [editingDescId, setEditingDescId] = useState(null)
  const [editDesc, setEditDesc] = useState('')
  const [valDragId, setValDragId] = useState(null)
  const [valDragOverId, setValDragOverId] = useState(null)
  const [valBusy, setValBusy] = useState(false)
  // 'show_none' (a lifecycle) or 'show_all' (an attribute picklist).
  const [emptyMeans, setEmptyMeans] = useState('show_all')

  const valuesById = useMemo(() => {
    const m = {}
    for (const v of values) m[v._id] = v
    return m
  }, [values])

  // Resolve one record type's ordered value set from persisted assignments.
  // Returns [] for a universal record type (no scoping rows).
  async function computeSelected(rtId, asgMap, vals) {
    const set = asgMap[rtId]
    if (!set || set.size === 0) return []
    let savedOrder = []
    try { savedOrder = await fetchRecordTypeValueOrder(rtId) } catch { /* fall back to global order */ }
    const scoped = savedOrder.filter(id => set.has(id))
    const missing = vals.map(v => v._id).filter(id => set.has(id) && !scoped.includes(id))
    return [...scoped, ...missing]
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    Promise.all([
      fetchFieldValues(objectName, field),
      fetchRecordTypesFor(objectName),
      fetchRecordTypeValueAssignments(objectName, field),
      fetchPicklistFieldScoping(objectName, field),
    ]).then(async ([vals, rts, asg, scoping]) => {
      if (cancelled) return
      setEmptyMeans(scoping)
      const map = asg.map || {}
      setValues(vals)
      setRecordTypes(rts)
      setAssignments(map)
      const firstRt = rts.find(r => r.active) || rts[0]
      if (firstRt) {
        const sel = await computeSelected(firstRt._id, map, vals)
        if (cancelled) return
        setActiveRtId(firstRt._id)
        setSelected(sel); setSavedSelected(sel)
      }
      setLoading(false)
    }).catch(e => { if (!cancelled) { setError(e); setLoading(false) } })
    return () => { cancelled = true }
  }, [objectName, field])

  async function reloadValues() {
    const vals = await fetchFieldValues(objectName, field)
    setValues(vals)
    return vals
  }

  async function selectRt(rtId) {
    if (rtId === activeRtId) return
    setActiveRtId(rtId); setSavedNote(''); setAvailSearch('')
    const sel = await computeSelected(rtId, assignments, values)
    setSelected(sel); setSavedSelected(sel)
  }

  // ── Transfer operations ────────────────────────────────────────────────
  function addOne(id) { setSavedNote(''); setSelected(prev => prev.includes(id) ? prev : [...prev, id]) }
  function removeOne(id) { setSavedNote(''); setSelected(prev => prev.filter(x => x !== id)) }
  function addAll() {
    setSavedNote('')
    setSelected(prev => {
      const have = new Set(prev)
      return [...prev, ...availableValues.filter(v => !have.has(v._id)).map(v => v._id)]
    })
  }
  function removeAll() { setSavedNote(''); setSelected([]) }
  function moveSelected(index, dir) {
    setSavedNote('')
    setSelected(prev => {
      const arr = [...prev]
      const j = index + dir
      if (j < 0 || j >= arr.length) return prev
      ;[arr[index], arr[j]] = [arr[j], arr[index]]
      return arr
    })
  }

  function dropBefore(targetId) {
    if (!drag) return
    setSavedNote('')
    setSelected(prev => {
      const arr = prev.filter(x => x !== drag.id)
      const ti = arr.indexOf(targetId)
      const idx = ti < 0 ? arr.length : ti
      arr.splice(idx, 0, drag.id)
      return arr
    })
    clearDrag()
  }
  function dropAppend() {
    if (!drag) return
    setSavedNote('')
    setSelected(prev => prev.includes(drag.id) ? prev : [...prev, drag.id])
    clearDrag()
  }
  function dropRemove() {
    if (drag && drag.from === 'selected') { setSavedNote(''); removeOne(drag.id) }
    clearDrag()
  }
  function clearDrag() { setDrag(null); setOverId(null); setOverSelectedPanel(false); setOverAvailablePanel(false) }

  // Create a brand-new value on the field without leaving the screen. If this
  // record type is already restricted (has a Selected set), drop the new value
  // into Selected so it's ready to order. If universal, it just joins the field
  // and shows in Available (universal already includes it).
  async function commitWorkspaceValue() {
    const label = wsLabel.trim()
    // Stages are scoped 1:1 to a record type, so the same generic label (e.g.
    // "Income Qualification") can exist for several record types. The stored
    // value must stay unique (DB constraint), so default it to a record-type-
    // scoped key the user never sees — the label stays clean.
    const value = wsValue.trim() || (activeRt ? `${activeRt.value} - ${label}` : label)
    if (!label) return
    setValBusy(true)
    try {
      const maxOrder = values.reduce((m, v) => Math.max(m, v.sortOrder), -1)
      const created = await addFieldValue(objectName, field, value, label, maxOrder + 1)
      await reloadValues()
      const restricted = selected.length > 0
      if (restricted && created?.id) {
        setSelected(prev => prev.includes(created.id) ? prev : [...prev, created.id])
        setSavedNote('')
      }
      setWsAdding(false); setWsLabel(''); setWsValue('')
      toast.success(restricted ? `Added "${label}" — placed in Selected, Save to keep` : `Added "${label}"`)
    } catch (e) {
      toast.error(`Add failed: ${e.message || e}`)
    } finally { setValBusy(false) }
  }

  const dirty = useMemo(() => {
    if (selected.length !== savedSelected.length) return true
    for (let i = 0; i < selected.length; i++) if (selected[i] !== savedSelected[i]) return true
    return false
  }, [selected, savedSelected])

  async function save() {
    if (!activeRtId) return
    setSaving(true); setSavedNote('')
    try {
      // Empty array ⇒ universal (clears scoping). Non-empty ⇒ restricted + order.
      await setRecordTypePicklistValues(activeRtId, objectName, field, selected)
      if (selected.length > 0) await reorderFieldValuesForRecordType(activeRtId, selected)
      setAssignments(prev => {
        const next = { ...prev }
        if (selected.length === 0) delete next[activeRtId]
        else next[activeRtId] = new Set(selected)
        return next
      })
      setSavedSelected([...selected])
      setSavedNote(selected.length === 0
        ? (emptyMeans === 'show_none'
            ? 'Saved — this record type now shows NO values until you select some.'
            : 'Saved — this record type shows all values.')
        : `Saved — ${selected.length} value${selected.length === 1 ? '' : 's'} for this record type.`)
    } catch (e) {
      setSavedNote('Save failed: ' + (e.message || e))
      toast.error(`Save failed: ${e.message || e}`)
    } finally { setSaving(false) }
  }

  // ── Master value-list handlers ─────────────────────────────────────────
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
    } catch (e) { toast.error(`Add failed: ${e.message || e}`) }
    finally { setValBusy(false) }
  }
  async function commitRename(id) {
    const label = editLabel.trim()
    if (!label) { setEditingValueId(null); return }
    setValBusy(true)
    try { await updateFieldValue(id, { label }); await reloadValues(); setEditingValueId(null); toast.success('Value renamed') }
    catch (e) { toast.error(`Rename failed: ${e.message || e}`) }
    finally { setValBusy(false) }
  }
  async function commitDescription(id) {
    setValBusy(true)
    try { await updateFieldValue(id, { description: editDesc.trim() }); await reloadValues(); setEditingDescId(null); toast.success('Description saved') }
    catch (e) { toast.error(`Save failed: ${e.message || e}`) }
    finally { setValBusy(false) }
  }
  async function toggleValueActive(v) {
    setValBusy(true)
    try { await updateFieldValue(v._id, { isActive: !v.active }); await reloadValues(); toast.success(v.active ? `Deactivated "${v.label}"` : `Activated "${v.label}"`) }
    catch (e) { toast.error(`Update failed: ${e.message || e}`) }
    finally { setValBusy(false) }
  }
  async function onValueDrop(targetId) {
    if (!valDragId || valDragId === targetId) { setValDragId(null); setValDragOverId(null); return }
    const arr = [...values]
    const from = arr.findIndex(v => v._id === valDragId)
    const to = arr.findIndex(v => v._id === targetId)
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    setValues(arr)
    setValDragId(null); setValDragOverId(null)
    setValBusy(true)
    try { await reorderFieldValues(arr.map(v => v._id)); toast.success('Reordered') }
    catch (e) { toast.error(`Reorder failed: ${e.message || e}`); await reloadValues() }
    finally { setValBusy(false) }
  }

  const activeRt = recordTypes.find(r => r._id === activeRtId)
  const isUniversal = selected.length === 0
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Values that belong to a DIFFERENT record type, hidden only when this
  // field's values are genuinely exclusive to one record type.
  //
  // The old rule hid them unconditionally. That is right for opportunity
  // stages, which LEAP scopes 1:1 and never shares, and WRONG for a shared
  // lifecycle: enrollment_status's eight values already served seven record
  // types, so every one was hidden as "assigned elsewhere" and the two
  // Project-Reservation record types could never be configured at all --
  // Available 0, Selected empty, nothing to drag. See picklistValueSharing.
  const scopedElsewhere = useMemo(
    () => valuesScopedElsewhere(assignments, activeRtId),
    [assignments, activeRtId])

  const availableValues = useMemo(() => {
    let list = values.filter(v => v.active && !selectedSet.has(v._id) && !scopedElsewhere.has(v._id))
    const q = availSearch.trim().toLowerCase()
    if (q) list = list.filter(v => (v.label || '').toLowerCase().includes(q) || (v.value || '').toLowerCase().includes(q))
    if (availSort === 'label') list = [...list].sort((a, b) => (a.label || '').localeCompare(b.label || ''))
    else if (availSort === 'value') list = [...list].sort((a, b) => (a.value || '').localeCompare(b.value || ''))
    // 'master' keeps fetch order (picklist_sort_order)
    return list
  }, [values, selectedSet, scopedElsewhere, availSearch, availSort])

  const selectedRows = useMemo(() => selected.map(id => valuesById[id]).filter(Boolean), [selected, valuesById])

  // Show the stored-value column only when the VISIBLE labels actually collide
  // (rare once other record types' copies are hidden). Otherwise the list stays
  // clean and single-column.
  const labelsAmbiguous = useMemo(() => {
    const seen = new Set()
    for (const v of [...selectedRows, ...availableValues]) {
      if (!v) continue
      if (seen.has(v.label)) return true
      seen.add(v.label)
    }
    return false
  }, [selectedRows, availableValues])

  const GRID = 'minmax(0, 1fr) 44px minmax(0, 1fr)'

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
        {columnName || field}
      </div>
      <div style={{ marginBottom: 16, fontSize: 12, color: C.textSecondary }}>
        Picklist field on <strong>{objectLabel}</strong>
        {columnName && columnName !== field && (
          <> · values stored under <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{field}</span></>
        )}
        {' '}· {values.length} value{values.length === 1 ? '' : 's'}
      </div>

      {loading && <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>Loading field…</div>}
      {error && !loading && (
        <div style={{ padding: 20, color: '#1a5a8a', fontSize: 12.5 }}>{String(error.message || error)}</div>
      )}

      {!loading && !error && (
      <>
        {/* ── Record type picker ── */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Record Type</label>
            <select
              value={activeRtId || ''}
              onChange={e => selectRt(e.target.value)}
              style={{ minWidth: 320, padding: '8px 10px', border: `1px solid ${C.borderDark || C.border}`, borderRadius: 6, fontSize: 13, background: C.page, color: C.textPrimary, outline: 'none', cursor: 'pointer' }}
            >
              {recordTypes.length === 0 && <option value="">No record types on this object</option>}
              {recordTypes.map(rt => (
                <option key={rt._id} value={rt._id}>
                  {rt.label}{!rt.active ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
          {activeRt && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 220 }}>
              <span style={{
                alignSelf: 'flex-start', fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 4,
                background: isUniversal && emptyMeans === 'show_none' ? '#fdf4e3'
                          : isUniversal ? '#e8f8f2' : '#e8f3fb',
                color:      isUniversal && emptyMeans === 'show_none' ? '#8a6314'
                          : isUniversal ? '#1a7a4e' : '#1a5a8a',
              }}>
                {isUniversal
                  ? (emptyMeans === 'show_none' ? 'SHOWS NO VALUES' : 'SHOWS ALL VALUES')
                  : `${selected.length} VALUE${selected.length === 1 ? '' : 'S'}`}
              </span>
              <span style={{ fontSize: 11.5, color: C.textSecondary, lineHeight: 1.4 }}>
                Drag values from <strong>Available</strong> into <strong>Selected</strong> to choose and order what this
                record type shows.{' '}
                {emptyMeans === 'show_none'
                  ? 'This field is a record lifecycle, so an empty Selected list shows no values at all — the lifecycle has to be chosen here.'
                  : 'Leave Selected empty to show every value.'}
              </span>
            </div>
          )}
        </div>

        {/* ── Transfer workspace ── */}
        {activeRt && (
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 12, alignItems: 'stretch', marginBottom: 14 }}>
            {/* Available */}
            <div
              onDragOver={e => { e.preventDefault(); setOverAvailablePanel(true) }}
              onDragLeave={() => setOverAvailablePanel(false)}
              onDrop={dropRemove}
              style={{ border: `1px solid ${overAvailablePanel && drag?.from === 'selected' ? C.emerald : C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 360, minWidth: 0 }}
            >
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>
                  Available Values <span style={{ fontWeight: 400, color: C.textMuted }}>· {availableValues.length}</span>
                </span>
                <button onClick={() => { setWsAdding(true); setWsLabel(''); setWsValue('') }}
                  style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: C.emerald, color: '#fff', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <Icon path="M12 5v14M5 12h14" size={11} color="currentColor" /> New Value
                </button>
              </div>
              {wsAdding && (
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, background: '#f7faff', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input autoFocus value={wsLabel} onChange={e => setWsLabel(e.target.value)} placeholder="Label (shown to users)"
                    onKeyDown={e => { if (e.key === 'Enter') commitWorkspaceValue(); if (e.key === 'Escape') setWsAdding(false) }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none' }} />
                  <input value={wsValue} onChange={e => setWsValue(e.target.value)} placeholder="Stored value (optional, defaults to label)"
                    onKeyDown={e => { if (e.key === 'Enter') commitWorkspaceValue(); if (e.key === 'Escape') setWsAdding(false) }}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={commitWorkspaceValue} disabled={valBusy || !wsLabel.trim()}
                      style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: wsLabel.trim() ? C.emerald : '#cfe9da', color: '#fff', fontSize: 12, fontWeight: 600, cursor: wsLabel.trim() ? 'pointer' : 'default' }}>
                      {valBusy ? 'Adding…' : 'Add value'}
                    </button>
                    <button onClick={() => setWsAdding(false)}
                      style={{ padding: '6px 12px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </div>
              )}
              {/* Search + sort */}
              <div style={{ padding: 8, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
                <input value={availSearch} onChange={e => setAvailSearch(e.target.value)} placeholder="Search values…"
                  style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '7px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.page, color: C.textPrimary, outline: 'none' }} />
                <select value={availSort} onChange={e => setAvailSort(e.target.value)}
                  title="Sort the available list"
                  style={{ padding: '7px 8px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12, background: C.page, color: C.textSecondary, outline: 'none', cursor: 'pointer' }}>
                  <option value="master">Default order</option>
                  <option value="label">Label A–Z</option>
                  {labelsAmbiguous && <option value="value">Stored value A–Z</option>}
                </select>
              </div>
              {/* Column header */}
              <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto 22px', gap: 8, alignItems: 'center', padding: '6px 12px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <span></span><span>Label</span>{labelsAmbiguous ? <span style={{ textAlign: 'right' }}>Stored value</span> : <span></span>}<span></span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', maxHeight: 440 }}>
                {availableValues.map(v => (
                  <div key={v._id}
                    draggable
                    onDragStart={() => setDrag({ id: v._id, from: 'available' })}
                    onDragEnd={clearDrag}
                    onDoubleClick={() => addOne(v._id)}
                    style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto 22px', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, cursor: 'grab', fontSize: 12.5, opacity: drag?.id === v._id ? 0.5 : 1 }}
                    title="Drag to Selected, or double-click to add">
                    <span style={{ color: C.textMuted, fontSize: 13 }}>⋮⋮</span>
                    <span style={{ color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
                    {labelsAmbiguous
                      ? <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }} title={v.value}>{v.value}</span>
                      : <span />}
                    <button onClick={() => addOne(v._id)} title="Add" style={{ border: 'none', background: 'transparent', color: C.emerald, cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>›</button>
                  </div>
                ))}
                {availableValues.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, color: C.textMuted, textAlign: 'center' }}>
                    {availableEmptyMessage({
                      searching: !!availSearch.trim(),
                      selectedCount: selected.length,
                      totalActiveValues: values.filter(v => v.active).length,
                    })}
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={addAll} disabled={availableValues.length === 0}
                  style={{ padding: '5px 11px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: availableValues.length ? C.textSecondary : C.textMuted, fontSize: 11.5, cursor: availableValues.length ? 'pointer' : 'default' }}>
                  Add all ›
                </button>
              </div>
            </div>

            {/* Center arrows */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 10, color: C.textMuted }}>
              <span style={{ fontSize: 18 }}>›</span>
              <span style={{ fontSize: 18 }}>‹</span>
            </div>

            {/* Selected */}
            <div
              onDragOver={e => { e.preventDefault(); setOverSelectedPanel(true) }}
              onDragLeave={() => setOverSelectedPanel(false)}
              onDrop={() => { if (drag) dropAppend() }}
              style={{ border: `1px solid ${overSelectedPanel && drag ? C.emerald : C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 360, minWidth: 0 }}
            >
              <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>Selected Values <span style={{ fontWeight: 400, color: C.textMuted }}>· {activeRt.label}</span></span>
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 500 }}>{selectedRows.length}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '20px 22px 1fr auto 56px', gap: 8, alignItems: 'center', padding: '6px 12px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <span></span><span>#</span><span>Label</span>{labelsAmbiguous ? <span style={{ textAlign: 'right' }}>Stored value</span> : <span />}<span></span>
              </div>
              <div style={{ flex: 1, overflow: 'auto', maxHeight: 486 }}>
                {selectedRows.map((v, i) => (
                  <div key={v._id}
                    draggable
                    onDragStart={() => setDrag({ id: v._id, from: 'selected' })}
                    onDragOver={e => { e.preventDefault(); setOverId(v._id) }}
                    onDrop={e => { e.stopPropagation(); dropBefore(v._id) }}
                    onDragEnd={clearDrag}
                    style={{ display: 'grid', gridTemplateColumns: '20px 22px 1fr auto 56px', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, cursor: 'grab',
                      background: overId === v._id && drag?.id !== v._id ? '#eef8f2' : (v.active ? 'transparent' : '#fafbfd'),
                      opacity: drag?.id === v._id ? 0.5 : (v.active ? 1 : 0.7) }}>
                    <span style={{ color: C.textMuted, fontSize: 13 }} title="Drag to reorder">⋮⋮</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace' }}>{i + 1}</span>
                    <span style={{ color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.label}{!v.active && <span style={{ color: C.textMuted }}> (inactive)</span>}
                    </span>
                    {labelsAmbiguous
                      ? <span style={{ fontSize: 10.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }} title={v.value}>{v.value}</span>
                      : <span />}
                    <span style={{ display: 'inline-flex', gap: 2, justifyContent: 'flex-end' }}>
                      <button onClick={() => moveSelected(i, -1)} disabled={i === 0} title="Move up"
                        style={{ border: 'none', background: 'transparent', color: i === 0 ? C.textMuted : C.textSecondary, cursor: i === 0 ? 'default' : 'pointer', fontSize: 12, padding: '0 3px' }}>▲</button>
                      <button onClick={() => moveSelected(i, 1)} disabled={i === selectedRows.length - 1} title="Move down"
                        style={{ border: 'none', background: 'transparent', color: i === selectedRows.length - 1 ? C.textMuted : C.textSecondary, cursor: i === selectedRows.length - 1 ? 'default' : 'pointer', fontSize: 12, padding: '0 3px' }}>▼</button>
                      <button onClick={() => removeOne(v._id)} title="Remove" style={{ border: 'none', background: 'transparent', color: '#1a5a8a', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>‹</button>
                    </span>
                  </div>
                ))}
                {selectedRows.length === 0 && (
                  <div style={{ padding: 22, fontSize: 12, color: C.textMuted, textAlign: 'center', lineHeight: 1.6 }}>
                    Empty — this record type shows <strong>all values</strong> in default order.<br />
                    Drag values here (or use <em>Add all</em>) to restrict and order them.
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={removeAll} disabled={selectedRows.length === 0}
                  style={{ padding: '5px 11px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: selectedRows.length ? C.textSecondary : C.textMuted, fontSize: 11.5, cursor: selectedRows.length ? 'pointer' : 'default' }}>
                  ‹ Remove all
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Save bar ── */}
        {activeRt && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{ padding: '8px 18px', borderRadius: 6, border: 'none', fontSize: 12.5, fontWeight: 600, cursor: saving || !dirty ? 'default' : 'pointer', background: dirty && !saving ? C.emerald : '#cfe9da', color: '#fff' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedNote && <span style={{ fontSize: 11.5, color: savedNote.startsWith('Save failed') ? '#1a5a8a' : '#1a7a4e' }}>{savedNote}</span>}
            {dirty && !savedNote && <span style={{ fontSize: 11.5, color: C.textMuted }}>Unsaved changes</span>}
          </div>
        )}

        {/* ── Master value list (collapsible) ── */}
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, overflow: 'hidden' }}>
          <div
            onClick={() => setShowMaster(s => !s)}
            style={{ padding: '11px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: '#fafbfd', borderBottom: showMaster ? `1px solid ${C.border}` : 'none' }}
          >
            <div>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.textPrimary }}>Manage all field values</span>
              <span style={{ fontSize: 11.5, color: C.textMuted, marginLeft: 8 }}>Add, rename, describe, activate, or reorder the values that feed both panels.</span>
            </div>
            <span style={{ color: C.textMuted, fontSize: 12, transform: showMaster ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}>▶</span>
          </div>

          {showMaster && (
          <>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 110px 168px', gap: 8, padding: '8px 14px', background: '#fafbfd', borderBottom: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <div></div><div>Label</div><div>Stored Value</div><div style={{ textAlign: 'center' }}>Status</div><div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {values.map(v => (
              <div key={v._id}>
              <div
                draggable={editingValueId !== v._id && editingDescId !== v._id}
                onDragStart={() => setValDragId(v._id)}
                onDragOver={e => { e.preventDefault(); setValDragOverId(v._id) }}
                onDrop={() => onValueDrop(v._id)}
                onDragEnd={() => { setValDragId(null); setValDragOverId(null) }}
                style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 110px 168px', gap: 8, alignItems: 'center', padding: '8px 14px', borderBottom: `1px solid ${C.border}`,
                  background: valDragOverId === v._id && valDragId !== v._id ? '#f0faf5' : (v.active ? 'transparent' : '#fafbfd'),
                  opacity: valDragId === v._id ? 0.5 : (v.active ? 1 : 0.6) }}>
                <div style={{ cursor: 'grab', color: C.textMuted, textAlign: 'center', fontSize: 14 }} title="Drag to reorder">⋮⋮</div>
                {editingValueId === v._id ? (
                  <input autoFocus value={editLabel} onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(v._id); if (e.key === 'Escape') setEditingValueId(null) }}
                    style={{ padding: '6px 9px', border: `1px solid ${C.emerald}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none' }} />
                ) : (
                  <div style={{ fontSize: 12.5, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</div>
                )}
                <div style={{ fontSize: 11.5, color: C.textMuted, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.value}</div>
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
                  <button onClick={() => { setEditingDescId(editingDescId === v._id ? null : v._id); setEditDesc(v.description || '') }} disabled={valBusy}
                    style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${C.border}`, background: editingDescId === v._id ? '#eef6ff' : C.page, color: C.textSecondary, fontSize: 11, cursor: 'pointer' }}
                    title="Edit the guidance description shown under the status path for this stage">
                    Describe{v.description ? ' •' : ''}
                  </button>
                  <button onClick={() => toggleValueActive(v)} disabled={valBusy}
                    style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: v.active ? '#1a5a8a' : '#1a7a4e', fontSize: 11, cursor: 'pointer' }}>
                    {v.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
              {editingDescId === v._id && (
                <div style={{ padding: '10px 14px 12px 46px', borderBottom: `1px solid ${C.border}`, background: '#fafcff' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Stage description — shown under the status path when this is the current stage
                  </div>
                  <textarea
                    autoFocus
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="What this stage means and what has to happen to advance."
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 5, fontSize: 12.5, background: C.card, color: C.textPrimary, outline: 'none', resize: 'vertical', lineHeight: 1.5 }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => commitDescription(v._id)} disabled={valBusy}
                      style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: C.emerald, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {valBusy ? 'Saving…' : 'Save Description'}
                    </button>
                    <button onClick={() => setEditingDescId(null)} disabled={valBusy}
                      style={{ padding: '6px 12px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.page, color: C.textSecondary, fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              </div>
            ))}
            {values.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: C.textMuted }}>No values yet. Add the first one.</div>
            )}
          </>
          )}
        </div>
      </>
      )}
    </div>
  )
}
