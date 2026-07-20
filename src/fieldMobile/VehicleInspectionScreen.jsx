// ─── VehicleInspectionScreen.jsx ─────────────────────────────────────────────
// Daily Vehicle Inspection for LEAP Pad. Two views in one file:
//
//   • VehiclePicker  (/field/vehicles) — the fleet roster. Tapping a vehicle
//     starts (or resumes) today's Daily Inspection via
//     create_vehicle_daily_inspection — one inspection per vehicle per day.
//
//   • VehicleInspection (/field/vehicle-inspection/<activityId>) — the
//     checklist, split into Pre-Trip and Return legs. Each leg has its
//     odometer + gas level fields; each item takes photos (camera capture →
//     canonical uploadPhoto: on-device compression, EXIF preserved,
//     fleet-evidence bucket) and, where required, an OK / Needs Repair
//     answer (Needs Repair forces a comment). Complete = the driver's
//     attestation — the server re-validates everything and routes one
//     Needs-Repair task to the Shop Steward if anything was flagged.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react'
import AppChrome, { PullIndicator } from './AppChrome'
import { usePullToRefresh } from './usePullToRefresh'
import {
  fetchFleetVehicles, startVehicleInspection, fetchVehicleInspection,
  saveVehicleInspectionLeg, saveVehicleInspectionItem, completeVehicleInspection,
  captureInspectionPhoto,
} from './fieldMobileService'
import { C, FONT, MONO, card, btnPrimary, btnSecondary } from './styles'

const GAS_LEVELS = ['E', '1/4', '1/2', '3/4', 'F']

// ── Vehicle picker ───────────────────────────────────────────────────────────

export function VehiclePicker({ navigate }) {
  const [rows, setRows]       = useState(null)
  const [error, setError]     = useState(null)
  const [busyId, setBusyId]   = useState(null)

  const load = useCallback(async () => {
    try { setError(null); setRows(await fetchFleetVehicles()) }
    catch (e) { setError(e.message || 'Could not load vehicles.') }
  }, [])
  useEffect(() => { load() }, [load])
  const pr = usePullToRefresh(load)

  const start = async (vehicle) => {
    if (busyId) return
    setBusyId(vehicle.id)
    try {
      const res = await startVehicleInspection(vehicle.id)
      navigate(`/field/vehicle-inspection/${res.activity_id}`)
    } catch (e) {
      setError(e.message || 'Could not start the inspection.')
    } finally { setBusyId(null) }
  }

  return (
    <AppChrome title="Vehicle Inspection" activeKey="home" navigate={navigate}>
      <PullIndicator {...pr} />
      <div style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, margin: '2px 2px 12px' }}>
        Pick your vehicle. Today’s inspection opens — or resumes if it was already started.
      </div>
      {error && <div style={{ ...card, padding: 14, color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {rows === null && !error && <div style={{ ...card, padding: 16, color: C.textMuted, fontSize: 14 }}>Loading vehicles…</div>}
      {rows !== null && rows.length === 0 && (
        <div style={{ ...card, padding: 16, color: C.textSecondary, fontSize: 14 }}>
          No vehicles in the fleet roster yet — an Admin adds them in LEAP.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(rows || []).map(v => (
          <button key={v.id} disabled={!!busyId} onClick={() => start(v)}
            style={{ ...card, textAlign: 'left', cursor: 'pointer', padding: 14, opacity: busyId && busyId !== v.id ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{v.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>{v.recordNumber}</span>
            </div>
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: C.textSecondary, marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {v.typeLabel && <span>{v.typeLabel}</span>}
              {v.plate && <span style={{ fontFamily: MONO }}>{v.plate}</span>}
              {v.odometer != null && <span>{Number(v.odometer).toLocaleString()} mi</span>}
              {busyId === v.id && <span style={{ color: C.emeraldMid, fontWeight: 700 }}>Opening…</span>}
            </div>
          </button>
        ))}
      </div>
    </AppChrome>
  )
}

// ── Inspection detail ────────────────────────────────────────────────────────

export default function VehicleInspection({ activityId, navigate }) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [toast, setToast]     = useState(null)
  const [busyItem, setBusyItem] = useState(null)   // item id with an upload/save in flight
  const [completing, setCompleting] = useState(false)
  const [missing, setMissing] = useState(null)      // server-reported gaps on complete
  const fileRef = useRef(null)
  const captureItemRef = useRef(null)

  const load = useCallback(async () => {
    try { setError(null); setData(await fetchVehicleInspection(activityId)) }
    catch (e) { setError(e.message || 'Could not load the inspection.') }
  }, [activityId])
  useEffect(() => { load() }, [load])
  const pr = usePullToRefresh(load)

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500) }
  const complete = data?.status === 'Vehicle Activity Complete'

  const triggerCapture = (item) => {
    captureItemRef.current = item
    if (fileRef.current) fileRef.current.click()
  }

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    const item = captureItemRef.current
    if (!file || !item) return
    setBusyItem(item.item_id)
    try {
      await captureInspectionPhoto({ file, itemId: item.item_id })
      flash(`Photo saved · ${item.name}`)
      await load()
    } catch (err) {
      setError(err.message || 'Photo upload failed.')
    } finally { setBusyItem(null) }
  }

  const setCondition = async (item, condition) => {
    let comment = item.comment || null
    if (condition === 'needs_repair') {
      comment = window.prompt(`What needs repair on "${item.name}"?`, item.comment || '')
      if (comment === null) return          // cancelled
      if (!comment.trim()) { setError('A comment is required for Needs Repair.'); return }
    }
    setBusyItem(item.item_id)
    try {
      await saveVehicleInspectionItem({ itemId: item.item_id, condition, comment })
      setMissing(null)
      await load()
    } catch (err) {
      setError(err.message || 'Could not save the item.')
    } finally { setBusyItem(null) }
  }

  const saveLeg = async (leg, odometer, gasLevel) => {
    if (!odometer || Number.isNaN(Number(odometer))) { setError('Enter the odometer reading.'); return }
    if (!gasLevel) { setError('Pick the gas level.'); return }
    try {
      await saveVehicleInspectionLeg({ activityId, leg, odometer: Number(odometer), gasLevel })
      setMissing(null); setError(null)
      flash(leg === 'pre_trip' ? 'Start odometer & gas saved' : 'Return odometer & gas saved')
      await load()
    } catch (err) {
      setError(err.message || 'Could not save.')
    }
  }

  const onComplete = async () => {
    if (completing) return
    if (!window.confirm('I have inspected the vehicle and found it to be in the condition listed above.')) return
    setCompleting(true)
    setMissing(null)
    try {
      const res = await completeVehicleInspection({ activityId })
      if (!res.ok) { setMissing(res.missing || []); return }
      flash(res.needs_repair_count > 0
        ? `Inspection complete — ${res.needs_repair_count} repair item(s) routed to the Shop Steward`
        : 'Inspection complete')
      await load()
    } catch (err) {
      setError(err.message || 'Could not complete the inspection.')
    } finally { setCompleting(false) }
  }

  const items = data?.items || []
  const preTrip = items.filter(i => i.leg === 'pre_trip')
  const returns = items.filter(i => i.leg === 'return')

  return (
    <AppChrome title="Daily Inspection" activeKey="home" navigate={navigate}>
      <PullIndicator {...pr} />
      <input ref={fileRef} type="file" accept="image/*" capture="environment"
        onChange={onFile} style={{ display: 'none' }} />

      {error && <div style={{ ...card, padding: 12, color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {toast && <div style={{ ...card, padding: 12, color: '#1a6e44', background: '#eafaf2', fontSize: 13, marginBottom: 10 }}>{toast}</div>}
      {!data && !error && <div style={{ ...card, padding: 16, color: C.textMuted, fontSize: 14 }}>Loading inspection…</div>}

      {data && (
        <>
          {/* Header */}
          <div style={{ ...card, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 800, color: C.textPrimary }}>{data.vehicle_name}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.textMuted, marginLeft: 'auto' }}>{data.record_number}</span>
            </div>
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: C.textSecondary, marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {data.vehicle_type && <span>{data.vehicle_type}</span>}
              {data.license_plate && <span style={{ fontFamily: MONO }}>{data.license_plate}</span>}
              <span>{data.activity_date}</span>
              <span style={{ fontWeight: 700, color: complete ? C.emeraldMid : C.textSecondary }}>{data.status}</span>
            </div>
          </div>

          <LegFields
            title="Start of day" leg="pre_trip" disabled={complete}
            odometer={data.odometer_start} gasLevel={data.gas_level_start} onSave={saveLeg} />

          <SectionHeading>Pre-trip checklist</SectionHeading>
          {preTrip.map(item => (
            <ItemCard key={item.item_id} item={item} disabled={complete}
              busy={busyItem === item.item_id}
              onPhoto={() => triggerCapture(item)} onCondition={setCondition} />
          ))}

          <LegFields
            title="Return" leg="return" disabled={complete}
            odometer={data.odometer_return} gasLevel={data.gas_level_return} onSave={saveLeg} />

          <SectionHeading>Return checklist</SectionHeading>
          {returns.map(item => (
            <ItemCard key={item.item_id} item={item} disabled={complete}
              busy={busyItem === item.item_id}
              onPhoto={() => triggerCapture(item)} onCondition={setCondition} />
          ))}

          {missing && missing.length > 0 && (
            <div style={{ ...card, padding: 14, margin: '12px 0', border: `1.5px solid ${C.borderDark}` }}>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: C.textPrimary, marginBottom: 6 }}>
                Still needed before completing:
              </div>
              {missing.map((m, i) => (
                <div key={i} style={{ fontFamily: FONT, fontSize: 12.5, color: C.textSecondary, marginTop: 3 }}>• {m}</div>
              ))}
            </div>
          )}

          {!complete ? (
            <button onClick={onComplete} disabled={completing}
              style={{ ...btnPrimary, width: '100%', minHeight: 48, marginTop: 14, opacity: completing ? 0.7 : 1 }}>
              {completing ? 'Completing…' : 'Complete Inspection'}
            </button>
          ) : (
            <div style={{ ...card, padding: 14, marginTop: 14, fontFamily: FONT, fontSize: 13, color: C.textSecondary }}>
              Inspected and attested by <strong style={{ color: C.textPrimary }}>{data.driver}</strong>
              {data.attested_at ? ` · ${new Date(data.attested_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : ''}
            </div>
          )}
        </>
      )}
    </AppChrome>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function SectionHeading({ children }) {
  return (
    <div style={{
      fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      textTransform: 'uppercase', color: C.textMuted, margin: '14px 2px 8px',
    }}>{children}</div>
  )
}

// Odometer + gas level for one leg, saved together. Local draft state so
// typing doesn't fire a network call per keystroke.
function LegFields({ title, leg, odometer, gasLevel, disabled, onSave }) {
  const [odo, setOdo] = useState(odometer != null ? String(odometer) : '')
  const [gas, setGas] = useState(gasLevel || '')
  useEffect(() => { setOdo(odometer != null ? String(odometer) : '') }, [odometer])
  useEffect(() => { setGas(gasLevel || '') }, [gasLevel])
  const saved = odometer != null && !!gasLevel
  const dirty = odo !== (odometer != null ? String(odometer) : '') || gas !== (gasLevel || '')

  return (
    <div style={{ ...card, padding: 14, marginBottom: 4 }}>
      <div style={{ fontFamily: FONT, fontSize: 13.5, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
        {title}
        {saved && !dirty && <span style={{ color: C.emeraldMid, marginLeft: 8, fontSize: 12 }}>✓ saved</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="number" inputMode="numeric" placeholder="Odometer"
          value={odo} disabled={disabled}
          onChange={e => setOdo(e.target.value)}
          style={{
            flex: '1 1 120px', minHeight: 44, boxSizing: 'border-box',
            fontFamily: MONO, fontSize: 15, color: C.textPrimary,
            border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
          }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {GAS_LEVELS.map(g => (
            <button key={g} disabled={disabled} onClick={() => setGas(g)}
              style={{
                appearance: 'none', cursor: 'pointer', minHeight: 44, minWidth: 42,
                fontFamily: MONO, fontSize: 13, fontWeight: 700,
                border: `1px solid ${gas === g ? C.emeraldMid : C.borderDark}`,
                background: gas === g ? '#eafaf2' : C.card,
                color: gas === g ? '#1a6e44' : C.textSecondary,
                borderRadius: 8, padding: '0 6px',
              }}>{g}</button>
          ))}
        </div>
        {!disabled && (
          <button onClick={() => onSave(leg, odo, gas)}
            style={{ ...btnSecondary, minHeight: 44, flex: '0 0 auto' }}>
            Save
          </button>
        )}
      </div>
    </div>
  )
}

function ItemCard({ item, disabled, busy, onPhoto, onCondition }) {
  const photosDone = item.photo_count >= item.photos_required
  const conditionDone = !item.requires_condition || !!item.condition
  const done = photosDone && conditionDone && (item.photos_required > 0 || item.requires_condition)

  return (
    <div style={{ ...card, padding: 12, marginBottom: 8, borderColor: done ? C.emerald : C.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{item.name}</span>
        {done && <span style={{ color: C.emeraldMid, fontSize: 13, fontWeight: 700, marginLeft: 'auto' }}>✓</span>}
      </div>
      {item.description && (
        <div style={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, marginTop: 3, lineHeight: 1.45 }}>
          {item.description}
        </div>
      )}
      {item.condition === 'needs_repair' && item.comment && (
        <div style={{ fontFamily: FONT, fontSize: 12.5, color: '#1e466b', background: '#e8f1fb', borderRadius: 6, padding: '6px 9px', marginTop: 6 }}>
          Needs repair: {item.comment}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(item.photos_required > 0 || item.photo_count > 0 || item.condition === 'needs_repair') && (
          <span style={{ fontFamily: MONO, fontSize: 11.5, color: photosDone ? C.emeraldMid : C.textSecondary }}>
            {item.photo_count}/{item.photos_required || item.photo_count || 0} photo{(item.photos_required || item.photo_count) === 1 ? '' : 's'}
          </span>
        )}
        {!disabled && (
          <>
            <button onClick={onPhoto} disabled={busy}
              style={{ ...btnSecondary, minHeight: 40, fontSize: 12.5 }}>
              {busy ? 'Uploading…' : (item.photo_count > 0 ? 'Add photo' : 'Take photo')}
            </button>
            {item.requires_condition && (
              <>
                <button onClick={() => onCondition(item, 'ok')} disabled={busy}
                  style={{
                    appearance: 'none', cursor: 'pointer', minHeight: 40, borderRadius: 8, padding: '0 14px',
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
                    border: `1px solid ${item.condition === 'ok' ? C.emeraldMid : C.borderDark}`,
                    background: item.condition === 'ok' ? '#eafaf2' : C.card,
                    color: item.condition === 'ok' ? '#1a6e44' : C.textSecondary,
                  }}>OK</button>
                <button onClick={() => onCondition(item, 'needs_repair')} disabled={busy}
                  style={{
                    appearance: 'none', cursor: 'pointer', minHeight: 40, borderRadius: 8, padding: '0 14px',
                    fontFamily: FONT, fontSize: 12.5, fontWeight: 700,
                    border: `1px solid ${item.condition === 'needs_repair' ? '#7eb3e8' : C.borderDark}`,
                    background: item.condition === 'needs_repair' ? '#e8f1fb' : C.card,
                    color: item.condition === 'needs_repair' ? '#1e466b' : C.textSecondary,
                  }}>Needs Repair</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
