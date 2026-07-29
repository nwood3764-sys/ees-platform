// ---------------------------------------------------------------------------
// CombustionSafetyNotificationModal — the "line editor" for the Focus on Energy
// IRA Multifamily "Notification of Combustion Safety (Large Multifamily 5+
// Units)" form. It is part of the WI-IRA-MF-HOMES Final Project Payment Request
// package; the captured data is per building.
//
// The results are stored on diagnostic_tests rows (record type "Combustion
// Safety Notification") — one building-level Common Areas / Shared Equipment
// row plus one row per sampled unit — with mechanical ventilation on the
// building. Generation renders the official form (combustion_safety engine in
// paperworkModel.js) and attaches the PDF to `attachTo` (the project when
// launched from the final-payment package, else the building).
//
// See docs/leap-project-paperwork-port.md.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  loadCombustionContext, buildCombustionModel, saveCombustionSafetyNotification,
  downloadBlob, loadSubmittalDocumentTemplate,
} from '../data/paperworkService'
import { buildCombustionPdf } from '../data/paperworkModel'
import { uploadDocument } from '../data/storageService'

const EMERALD = '#3ecf8e'

// ── presentational components (module scope so inputs keep focus) ──────────
function Sel({ value, onChange, options, placeholder = 'Select…' }) {
  return (
    <select style={inputStyle} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
function Chk({ label, checked, onChange }) {
  return (
    <label style={checkRow}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
function Field({ label, children }) {
  return <div style={{ marginBottom: 10 }}><label style={labelStyle}>{label}</label>{children}</div>
}
function GroupBar({ children }) {
  return <div style={groupBar}>{children}</div>
}
function TextInput({ value, onChange, placeholder }) {
  return <input style={inputStyle} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}
function TextArea({ value, onChange }) {
  return <textarea style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }} value={value || ''} onChange={e => onChange(e.target.value)} />
}
function ReadOnly({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>{label}</label>
      <div style={readOnlyValue}>
        {value && String(value).trim() ? value : <span style={{ color: C.textMuted }}>— not on the property record</span>}
      </div>
    </div>
  )
}

// Gas Leak + Ambient CO sections, grouped like the official form. `set(k,v)`
// mutates the record; `opts` is a { field: options[] } map.
function GasAndAmbient({ rec, set, opts }) {
  return (
    <>
      <GroupBar>Gas Leak</GroupBar>
      <div style={grid2}>
        <Field label="Result"><Sel value={rec.gas_leak_result} options={opts.gas_leak_result} onChange={v => set('gas_leak_result', v)} /></Field>
        <Field label="Location(s) — if found"><TextInput value={rec.gas_leak_location} onChange={v => set('gas_leak_location', v)} /></Field>
      </div>
      <Chk label="Gas detector(s) installed" checked={rec.gas_detector_installed} onChange={v => set('gas_detector_installed', v)} />

      <GroupBar>Ambient Carbon Monoxide Levels</GroupBar>
      <div style={grid2}>
        <Field label="Reading"><Sel value={rec.ambient_co_result} options={opts.ambient_co_result} onChange={v => set('ambient_co_result', v)} /></Field>
        <Field label="Detector location(s)"><TextInput value={rec.co_detector_location} onChange={v => set('co_detector_location', v)} /></Field>
      </div>
      <Chk label="Carbon monoxide detector(s) installed" checked={rec.co_detector_installed} onChange={v => set('co_detector_installed', v)} />
    </>
  )
}

// Equipment CO Levels + Spillage grid. `types` is a list of
// { label, coKey, spillKey?, coOpts, spillOpts? } drawn in the form's order.
function EquipmentGrid({ rec, set, types }) {
  return (
    <>
      <GroupBar>Equipment Carbon Monoxide Levels</GroupBar>
      {types.map(t => (
        <div key={t.coKey} style={grid2}>
          <Field label={`${t.label} — CO Levels`}>
            <Sel value={rec[t.coKey]} options={t.coOpts} onChange={v => set(t.coKey, v)} />
          </Field>
          {t.spillKey
            ? <Field label={`${t.label} — Spillage`}>
                <Sel value={rec[t.spillKey]} options={t.spillOpts} onChange={v => set(t.spillKey, v)} />
              </Field>
            : <div />}
        </div>
      ))}
    </>
  )
}

export default function CombustionSafetyNotificationModal({ buildingId, building, attachTo, onClose }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(null)          // 'save' | 'generate'
  const [genError, setGenError] = useState(null)
  const [openUnits, setOpenUnits] = useState({})

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const c = await loadCombustionContext(buildingId)
        if (!alive) return
        setCtx(c)
        setDraft({
          owner: { ...c.owner }, ventilation: { ...c.ventilation }, common: { ...c.common },
          samples: c.samples.map(s => ({ ...s })), totalUnits: c.totalUnits,
        })
        setOpenUnits({ 0: true })
      } catch (e) { if (alive) setError(e.message || String(e)) }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [buildingId])

  const O = ctx?.options || {}
  const gasAmbientOpts = { gas_leak_result: O.gas_leak_result || [], ambient_co_result: O.ambient_co_result || [] }
  const commonEquip = [
    { label: 'Heating Plant (Furnace, Boiler, Etc.)', coKey: 'heating_plant_co_status', spillKey: 'heating_plant_spillage', coOpts: O.heating_plant_co_status || [], spillOpts: O.heating_plant_spillage || [] },
    { label: 'Water Heater(s)', coKey: 'water_heater_co_status', spillKey: 'water_heater_spillage', coOpts: O.water_heater_co_status || [], spillOpts: O.water_heater_spillage || [] },
  ]
  const unitEquip = [
    { label: 'Furnace / Boiler(s)', coKey: 'furnace_co_status', spillKey: 'furnace_spillage', coOpts: O.heating_plant_co_status || [], spillOpts: O.heating_plant_spillage || [] },
    { label: 'Water Heater(s)', coKey: 'water_heater_co_status', spillKey: 'water_heater_spillage', coOpts: O.water_heater_co_status || [], spillOpts: O.water_heater_spillage || [] },
    { label: 'Stove(s)', coKey: 'stove_co_status', coOpts: O.stove_co_status || [] },
  ]

  const setCommon = (k, v) => setDraft(d => ({ ...d, common: { ...d.common, [k]: v } }))
  const setVent = (k, v) => setDraft(d => ({ ...d, ventilation: { ...d.ventilation, [k]: v } }))
  const setSample = (i, k, v) => setDraft(d => { const s = d.samples.slice(); s[i] = { ...s[i], [k]: v }; return { ...d, samples: s } })
  const setSampleUnit = (i, unitId) => {
    const u = (ctx.allUnits || []).find(x => x.id === unitId)
    setDraft(d => { const s = d.samples.slice(); s[i] = { ...s[i], unit_id: unitId, unit_number: u?.number || '' }; return { ...d, samples: s } })
  }
  const addSample = () => {
    const used = new Set((draft.samples || []).map(s => s.unit_id))
    const next = (ctx.allUnits || []).find(u => !used.has(u.id))
    const blank = {
      unit_id: next?.id || '', unit_number: next?.number || '',
      gas_leak_result: '', gas_leak_location: '', gas_detector_installed: false,
      ambient_co_result: '', co_detector_installed: false, co_detector_location: '',
      furnace_co_status: '', furnace_spillage: '', water_heater_co_status: '',
      water_heater_spillage: '', stove_co_status: '', notes: '',
    }
    setOpenUnits(o => ({ ...o, [draft.samples.length]: true }))
    setDraft(d => ({ ...d, samples: [...d.samples, blank] }))
  }
  const removeSample = (i) => setDraft(d => ({ ...d, samples: d.samples.filter((_, j) => j !== i) }))

  const persist = () => saveCombustionSafetyNotification({
    buildingId, ventilation: draft.ventilation, common: draft.common, samples: draft.samples,
  })

  const onSave = async () => {
    setBusy('save'); setGenError(null)
    try { await persist(); toast.success('Combustion safety results saved') }
    catch (e) { setGenError(e.message || String(e)); toast.error(`Save failed — ${e.message || e}`) }
    finally { setBusy(null) }
  }

  const onGenerate = async () => {
    setBusy('generate'); setGenError(null)
    try {
      await persist()
      const model = buildCombustionModel(ctx, draft)
      const tpl = await loadSubmittalDocumentTemplate('combustion_safety_notification')
      const blob = await buildCombustionPdf(model, tpl?.kind || 'combustion_safety_notification', tpl?.sections)
      const filename = `Notification of Combustion Safety - ${ctx.building.name || 'Building'}.pdf`
      const dest = attachTo || { object: 'buildings', id: buildingId }
      try {
        const file = new File([blob], filename, { type: 'application/pdf' })
        await uploadDocument({ file, relatedObject: dest.object, relatedId: dest.id, documentType: 'submittal', name: filename, category: 'combustion_safety_notification' })
      } catch (e) { console.warn('attach failed', e) }
      downloadBlob(blob, filename)
      toast.success('Notification generated, downloaded, and attached')
    } catch (e) { setGenError(e.message || String(e)); toast.error(`Generation failed — ${e.message || e}`) }
    finally { setBusy(null) }
  }

  const bName = building?.building_number_or_name || building?.building_name || ctx?.building?.name || 'Building'

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={iconWrap}><Icon name="file-text" size={16} color="#0f9d6a" /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.textPrimary }}>Notification of Combustion Safety</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>Large Multifamily (5+ Units) · {bName}</div>
            </div>
          </div>
          <button style={iconBtn} onClick={busy ? undefined : onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>

        <div style={bodyStyle}>
          {loading && <div style={{ color: C.textSecondary, fontSize: 13 }}>Loading building, units, and any saved results…</div>}
          {error && <div style={errorBox}>{error}</div>}

          {!loading && !error && draft && (
            <>
              <div style={introBox}>
                Part of the WI-IRA-MF-HOMES Final Project Payment Request package. One form is
                completed per building; results are saved to this building’s diagnostic test
                records, and generating produces the official Focus on Energy form.
              </div>

              {/* Common areas / shared equipment */}
              <SectionHead>Common Areas / Shared Equipment</SectionHead>
              <GasAndAmbient rec={draft.common} set={setCommon} opts={gasAmbientOpts} />
              <EquipmentGrid rec={draft.common} set={setCommon} types={commonEquip} />
              <Field label="Notes / Comments / Reason(s) for not testing">
                <TextArea value={draft.common.notes} onChange={v => setCommon('notes', v)} />
              </Field>

              {/* In-unit sampling */}
              <SectionHead>In-Unit Equipment (Sampled)</SectionHead>
              <div style={samplingNote}>
                Building has <b>{draft.totalUnits}</b> units → sample <b>{ctx.sampleCount}</b>.
                {draft.samples.length !== ctx.sampleCount && (
                  <span style={{ color: '#1a5a8a' }}> Currently {draft.samples.length} unit{draft.samples.length === 1 ? '' : 's'} listed.</span>
                )}
              </div>
              {draft.samples.map((u, i) => {
                const isOpen = !!openUnits[i]
                return (
                  <div key={i} style={unitCard}>
                    <div style={unitHead} onClick={() => setOpenUnits(o => ({ ...o, [i]: !o[i] }))}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                        <b style={{ fontSize: 12.5 }}>Sample #{i + 1}</b>
                        <span style={{ color: C.textMuted, fontSize: 12 }}>{u.unit_number ? `Unit ${u.unit_number}` : 'No unit selected'}</span>
                      </div>
                      <button style={miniBtn} onClick={e => { e.stopPropagation(); removeSample(i) }}>Remove</button>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '4px 12px 12px' }}>
                        <Field label="Unit">
                          <Sel value={u.unit_id} placeholder="Pick a unit…"
                            options={(ctx.allUnits || []).map(x => ({ value: x.id, label: x.number || '(unnamed)' }))}
                            onChange={v => setSampleUnit(i, v)} />
                        </Field>
                        <GasAndAmbient rec={u} set={(k, v) => setSample(i, k, v)} opts={gasAmbientOpts} />
                        <EquipmentGrid rec={u} set={(k, v) => setSample(i, k, v)} types={unitEquip} />
                        <Field label="Notes / Comments / Reason(s) for not testing">
                          <TextArea value={u.notes} onChange={v => setSample(i, 'notes', v)} />
                        </Field>
                      </div>
                    )}
                  </div>
                )
              })}
              <button style={addBtn} onClick={addSample}><Icon name="plus" size={13} /> Add sampled unit</button>

              {/* Mechanical ventilation */}
              <SectionHead>Mechanical Ventilation</SectionHead>
              <div style={grid2}>
                <Field label="Ventilation"><Sel value={draft.ventilation.status} options={O.combustion_ventilation_status || []} onChange={v => setVent('status', v)} /></Field>
                <Field label="Existing Total CFM"><input style={inputStyle} type="number" min="0" value={draft.ventilation.cfm || ''} onChange={e => setVent('cfm', e.target.value)} /></Field>
              </div>
              <Field label="Notes / Comments"><TextArea value={draft.ventilation.notes} onChange={v => setVent('notes', v)} /></Field>

              {/* Property / owner — inherited from the property record (read-only) */}
              <SectionHead>Property Information</SectionHead>
              <div style={{ ...introBox, marginTop: 0 }}>
                Inherited from the property record. To change it, update the property’s owner/management fields.
              </div>
              <div style={grid2}>
                <ReadOnly label="Owner / Management Company Name" value={draft.owner.name} />
                <ReadOnly label="Owner / Management Company Address" value={draft.owner.address} />
                <ReadOnly label="City, State ZIP" value={draft.owner.cityStateZip} />
              </div>

              {genError && <div style={errorBox}>{genError}</div>}
            </>
          )}
        </div>

        <div style={footerStyle}>
          <button style={ghostBtn} onClick={busy ? undefined : onClose}>Cancel</button>
          <button style={secondaryBtn} disabled={!!busy || loading || !!error} onClick={onSave}>{busy === 'save' ? 'Saving…' : 'Save Results'}</button>
          <button style={primaryBtn} disabled={!!busy || loading || !!error} onClick={onGenerate}>{busy === 'generate' ? 'Generating…' : 'Generate & Attach PDF'}</button>
        </div>
      </div>
    </div>
  )
}

function SectionHead({ children }) { return <div style={sectionHead}>{children}</div> }

// ── styles ──────────────────────────────────────────────────────────────
const overlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const card = { width: '100%', maxWidth: 760, maxHeight: '92vh', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const headerStyle = { padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }
const iconWrap = { width: 32, height: 32, borderRadius: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const bodyStyle = { padding: 20, overflowY: 'auto', minHeight: 0 }
const footerStyle = { padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end', background: C.page, flexShrink: 0 }
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }
const inputStyle = { width: '100%', padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }
const readOnlyValue = { padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: '#f4f7fb', border: `1px solid ${C.border}`, borderRadius: 6, minHeight: 17, wordBreak: 'break-word' }
const errorBox = { background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6, padding: '10px 12px', fontSize: 12.5, color: '#1a5a8a', marginTop: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
const introBox = { background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', fontSize: 12, color: C.textSecondary, lineHeight: 1.55, marginBottom: 14 }
const sectionHead = { fontSize: 12.5, fontWeight: 700, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${EMERALD}` }
const groupBar = { fontSize: 11, fontWeight: 700, color: '#fff', background: '#1c3d5e', padding: '5px 10px', borderRadius: 4, letterSpacing: 0.4, textTransform: 'uppercase', margin: '14px 0 10px' }
const samplingNote = { fontSize: 12, color: C.textSecondary, marginBottom: 10 }
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
const checkRow = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer', margin: '2px 0 12px' }
const unitCard = { border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10, background: '#fbfcfe' }
const unitHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', cursor: 'pointer' }
const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 4 }
const miniBtn = { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, padding: '3px 8px', fontSize: 11.5, color: '#1a5a8a', cursor: 'pointer' }
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: '#0f9d6a', cursor: 'pointer', marginTop: 2 }
const ghostBtn = { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer' }
const secondaryBtn = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: C.textPrimary, cursor: 'pointer' }
const primaryBtn = { background: EMERALD, border: `1px solid ${EMERALD}`, borderRadius: 6, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, color: '#04331f', cursor: 'pointer' }
