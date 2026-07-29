// ---------------------------------------------------------------------------
// CombustionSafetyNotificationModal — the "line editor" for the Focus on Energy
// IRA Multifamily "Notification of Combustion Safety (Large Multifamily 5+
// Units)" form. It is opened from a BUILDING record (the data's natural home)
// and is a required submittal for the WI-IRA-MF-HOMES Final Project Payment
// Request.
//
// The captured results are stored on diagnostic_tests rows (record type
// "Combustion Safety Notification") — one building-level Common Areas / Shared
// Equipment row plus one row per sampled unit — with mechanical ventilation on
// the building record. Generation renders the official form (combustion_safety
// engine in paperworkModel.js) and attaches the PDF to the building.
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

export default function CombustionSafetyNotificationModal({ buildingId, building, onClose }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(null)          // 'save' | 'generate'
  const [genError, setGenError] = useState(null)
  const [openUnits, setOpenUnits] = useState({})  // per-unit collapse state

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const c = await loadCombustionContext(buildingId)
        if (!alive) return
        setCtx(c)
        setDraft({
          owner: { ...c.owner },
          ventilation: { ...c.ventilation },
          common: { ...c.common },
          samples: c.samples.map(s => ({ ...s })),
          totalUnits: c.totalUnits,
        })
        setOpenUnits({ 0: true })
      } catch (e) {
        if (alive) setError(e.message || String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [buildingId])

  const opt = (field) => (ctx?.options?.[field] || [])
  const setCommon = (k, v) => setDraft(d => ({ ...d, common: { ...d.common, [k]: v } }))
  const setVent = (k, v) => setDraft(d => ({ ...d, ventilation: { ...d.ventilation, [k]: v } }))
  const setOwner = (k, v) => setDraft(d => ({ ...d, owner: { ...d.owner, [k]: v } }))
  const setSample = (i, k, v) => setDraft(d => {
    const s = d.samples.slice(); s[i] = { ...s[i], [k]: v }; return { ...d, samples: s }
  })
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
    setDraft(d => ({ ...d, samples: [...d.samples, blank] }))
    setOpenUnits(o => ({ ...o, [draft.samples.length]: true }))
  }
  const removeSample = (i) => setDraft(d => ({ ...d, samples: d.samples.filter((_, j) => j !== i) }))

  const persist = () => saveCombustionSafetyNotification({
    buildingId, ventilation: draft.ventilation, common: draft.common, samples: draft.samples,
  })

  const onSave = async () => {
    setBusy('save'); setGenError(null)
    try { await persist(); toast.success('Combustion safety results saved to this building') }
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
      try {
        const file = new File([blob], filename, { type: 'application/pdf' })
        await uploadDocument({
          file, relatedObject: 'buildings', relatedId: buildingId,
          documentType: 'submittal', name: filename, category: 'combustion_safety_notification',
        })
      } catch (e) { /* attach is best-effort — never block the download */ console.warn('attach failed', e) }
      downloadBlob(blob, filename)
      toast.success('Notification generated, downloaded, and attached to the building')
    } catch (e) {
      setGenError(e.message || String(e)); toast.error(`Generation failed — ${e.message || e}`)
    } finally { setBusy(null) }
  }

  // ── shared field renderers ────────────────────────────────────────────
  const Sel = ({ value, onChange, options, placeholder = 'Select…' }) => (
    <select style={inputStyle} value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
  const Chk = ({ label, checked, onChange }) => (
    <label style={checkRow}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
  const Field = ({ label, children }) => (
    <div style={{ marginBottom: 10 }}><label style={labelStyle}>{label}</label>{children}</div>
  )

  // Gas leak + ambient CO block (shared by common area and each unit).
  const GasAmbient = ({ rec, set }) => (
    <>
      <div style={grid2}>
        <Field label="Gas Leak"><Sel value={rec.gas_leak_result} options={opt('gas_leak_result')} onChange={v => set('gas_leak_result', v)} /></Field>
        <Field label="Gas Leak — Location(s)"><input style={inputStyle} value={rec.gas_leak_location || ''} onChange={e => set('gas_leak_location', e.target.value)} placeholder="If found…" /></Field>
      </div>
      <Chk label="Gas detector(s) installed" checked={rec.gas_detector_installed} onChange={v => set('gas_detector_installed', v)} />
      <div style={grid2}>
        <Field label="Ambient Carbon Monoxide"><Sel value={rec.ambient_co_result} options={opt('ambient_co_result')} onChange={v => set('ambient_co_result', v)} /></Field>
        <Field label="CO Detector — Location(s)"><input style={inputStyle} value={rec.co_detector_location || ''} onChange={e => set('co_detector_location', e.target.value)} /></Field>
      </div>
      <Chk label="Carbon monoxide detector(s) installed" checked={rec.co_detector_installed} onChange={v => set('co_detector_installed', v)} />
    </>
  )

  return (
    <div style={overlay} onClick={busy ? undefined : onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={iconWrap}><Icon name="file-text" size={16} color="#0f9d6a" /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.textPrimary }}>Notification of Combustion Safety</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>
                Large Multifamily (5+ Units) · {building?.building_number_or_name || building?.building_name || 'Building'}
              </div>
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
                One form is completed per building. Results are saved to this building’s diagnostic
                test records; generating produces the official Focus on Energy form and attaches it
                to the building. Required for the WI-IRA-MF-HOMES Final Project Payment Request.
              </div>

              {/* Common areas / shared equipment */}
              <SectionHead>Common Areas / Shared Equipment</SectionHead>
              <GasAmbient rec={draft.common} set={setCommon} />
              <div style={grid2}>
                <Field label="Heating Plant — CO Levels"><Sel value={draft.common.heating_plant_co_status} options={opt('heating_plant_co_status')} onChange={v => setCommon('heating_plant_co_status', v)} /></Field>
                <Field label="Heating Plant — Spillage"><Sel value={draft.common.heating_plant_spillage} options={opt('heating_plant_spillage')} onChange={v => setCommon('heating_plant_spillage', v)} /></Field>
                <Field label="Water Heater(s) — CO Levels"><Sel value={draft.common.water_heater_co_status} options={opt('water_heater_co_status')} onChange={v => setCommon('water_heater_co_status', v)} /></Field>
                <Field label="Water Heater(s) — Spillage"><Sel value={draft.common.water_heater_spillage} options={opt('water_heater_spillage')} onChange={v => setCommon('water_heater_spillage', v)} /></Field>
              </div>
              <Field label="Notes / Comments / Reason(s) for not testing">
                <textarea style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }} value={draft.common.notes || ''} onChange={e => setCommon('notes', e.target.value)} />
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
                        <GasAmbient rec={u} set={(k, v) => setSample(i, k, v)} />
                        <div style={grid2}>
                          <Field label="Furnace / Boiler — CO Levels"><Sel value={u.furnace_co_status} options={opt('heating_plant_co_status')} onChange={v => setSample(i, 'furnace_co_status', v)} /></Field>
                          <Field label="Furnace / Boiler — Spillage"><Sel value={u.furnace_spillage} options={opt('heating_plant_spillage')} onChange={v => setSample(i, 'furnace_spillage', v)} /></Field>
                          <Field label="Water Heater(s) — CO Levels"><Sel value={u.water_heater_co_status} options={opt('water_heater_co_status')} onChange={v => setSample(i, 'water_heater_co_status', v)} /></Field>
                          <Field label="Water Heater(s) — Spillage"><Sel value={u.water_heater_spillage} options={opt('water_heater_spillage')} onChange={v => setSample(i, 'water_heater_spillage', v)} /></Field>
                          <Field label="Stove(s) — CO Levels"><Sel value={u.stove_co_status} options={opt('stove_co_status')} onChange={v => setSample(i, 'stove_co_status', v)} /></Field>
                        </div>
                        <Field label="Notes / Comments / Reason(s) for not testing">
                          <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={u.notes || ''} onChange={e => setSample(i, 'notes', e.target.value)} />
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
                <Field label="Ventilation"><Sel value={draft.ventilation.status} options={opt('combustion_ventilation_status')} onChange={v => setVent('status', v)} /></Field>
                <Field label="Existing Total CFM"><input style={inputStyle} type="number" min="0" value={draft.ventilation.cfm || ''} onChange={e => setVent('cfm', e.target.value)} /></Field>
              </div>
              <Field label="Notes / Comments">
                <textarea style={{ ...inputStyle, minHeight: 40, resize: 'vertical' }} value={draft.ventilation.notes || ''} onChange={e => setVent('notes', e.target.value)} />
              </Field>

              {/* Property / owner */}
              <SectionHead>Property Information</SectionHead>
              <div style={grid2}>
                <Field label="Owner / Management Company Name"><input style={inputStyle} value={draft.owner.name || ''} onChange={e => setOwner('name', e.target.value)} /></Field>
                <Field label="Owner / Management Company Address"><input style={inputStyle} value={draft.owner.address || ''} onChange={e => setOwner('address', e.target.value)} /></Field>
                <Field label="City, State ZIP"><input style={inputStyle} value={draft.owner.cityStateZip || ''} onChange={e => setOwner('cityStateZip', e.target.value)} /></Field>
              </div>

              {genError && <div style={errorBox}>{genError}</div>}
            </>
          )}
        </div>

        <div style={footerStyle}>
          <button style={ghostBtn} onClick={busy ? undefined : onClose}>Cancel</button>
          <button style={secondaryBtn} disabled={!!busy || loading || !!error} onClick={onSave}>
            {busy === 'save' ? 'Saving…' : 'Save Results'}
          </button>
          <button style={primaryBtn} disabled={!!busy || loading || !!error} onClick={onGenerate}>
            {busy === 'generate' ? 'Generating…' : 'Generate & Attach PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionHead({ children }) {
  return <div style={sectionHead}>{children}</div>
}

// ── styles ──────────────────────────────────────────────────────────────
const overlay = { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }
const card = { width: '100%', maxWidth: 760, maxHeight: '92vh', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const headerStyle = { padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }
const iconWrap = { width: 32, height: 32, borderRadius: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const bodyStyle = { padding: 20, overflowY: 'auto', minHeight: 0 }
const footerStyle = { padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end', background: C.page, flexShrink: 0 }
const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }
const inputStyle = { width: '100%', padding: '7px 9px', fontSize: 12.5, color: C.textPrimary, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, boxSizing: 'border-box' }
const errorBox = { background: '#e8f1fb', border: '1px solid #bcd9f2', borderRadius: 6, padding: '10px 12px', fontSize: 12.5, color: '#1a5a8a', marginTop: 10, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
const introBox = { background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 12px', fontSize: 12, color: C.textSecondary, lineHeight: 1.55, marginBottom: 14 }
const sectionHead = { fontSize: 12.5, fontWeight: 700, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${EMERALD}` }
const samplingNote = { fontSize: 12, color: C.textSecondary, marginBottom: 10 }
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }
const checkRow = { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer', margin: '2px 0 10px' }
const unitCard = { border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 10, background: '#fbfcfe' }
const unitHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', cursor: 'pointer' }
const iconBtn = { background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', padding: 4 }
const miniBtn = { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, padding: '3px 8px', fontSize: 11.5, color: '#1a5a8a', cursor: 'pointer' }
const addBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, color: '#0f9d6a', cursor: 'pointer', marginTop: 2 }
const ghostBtn = { background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12.5, color: C.textSecondary, cursor: 'pointer' }
const secondaryBtn = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, color: C.textPrimary, cursor: 'pointer' }
const primaryBtn = { background: EMERALD, border: `1px solid ${EMERALD}`, borderRadius: 6, padding: '8px 16px', fontSize: 12.5, fontWeight: 700, color: '#04331f', cursor: 'pointer' }
