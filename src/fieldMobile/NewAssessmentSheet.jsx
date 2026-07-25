// ─── NewAssessmentSheet.jsx ──────────────────────────────────────────────────
// Self-service Single-Family Energy Assessment creation from LEAP Pad.
// The auditor walks four short phases, selecting existing records or creating
// what's missing:
//   1. Owner   — the BUILDING OWNER account (owner-occupied or rental):
//                search accounts, or type a new owner name.
//   2. Property — search, or enter the address to create it under the owner.
//   3. Building — pick an existing building, or create one by choosing its
//                 type: Single Family Detached (no units — the building IS
//                 the home) or Single Family Attached (each home is a unit).
//   4. Unit    — attached only: pick a unit or type a new one. Detached
//                skips straight to creation.
// create_assessment_work_order stands up whatever is missing (account →
// property → building → unit → opportunity/project), creates the work order
// + today's appointment assigned to the auditor, and routes a Field Data
// Verification Review task when new records were created.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import {
  searchAccounts, searchProperties, fetchBuildingsForAssessment,
  fetchUnitsForBuilding, createAssessmentWorkOrder,
} from './fieldMobileService'
import { C, FONT, card, btnPrimary, btnSecondary, btnDisabled } from './styles'

const inputStyle = {
  width: '100%', boxSizing: 'border-box', minHeight: 48,
  fontFamily: FONT, fontSize: 16, color: C.textPrimary,
  border: `1px solid ${C.borderDark}`, borderRadius: 8, padding: '10px 12px',
  background: C.card,
}

function ListButton({ title, sub, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        appearance: 'none', cursor: 'pointer', textAlign: 'left',
        border: `1px solid ${C.borderDark}`, background: C.card,
        borderRadius: 8, padding: '12px 14px', minHeight: 44, width: '100%',
      }}>
      <span style={{ display: 'block', fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{title}</span>
      {sub && <span style={{ display: 'block', fontFamily: FONT, fontSize: 12.5, color: C.textMuted, marginTop: 1 }}>{sub}</span>}
    </button>
  )
}

function DashedButton({ label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        appearance: 'none', cursor: 'pointer', textAlign: 'center', width: '100%',
        border: `1.5px dashed ${C.borderDark}`, background: C.cardSecondary,
        borderRadius: 8, padding: '12px 14px', minHeight: 44,
        fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary,
      }}>
      {label}
    </button>
  )
}

export default function NewAssessmentSheet({ onClose, onCreated, onError }) {
  // Phases: 'owner' → 'property' → 'building' → 'unit' → submit.
  const [phase, setPhase] = useState('owner')
  const [busy, setBusy] = useState(false)

  // Owner (account)
  const [acctQuery, setAcctQuery] = useState('')
  const [acctResults, setAcctResults] = useState(null)
  const [acctSearching, setAcctSearching] = useState(false)
  const [account, setAccount] = useState(null)        // {id, name} — existing
  const [newAccountName, setNewAccountName] = useState('') // creating

  // Property
  const [propQuery, setPropQuery] = useState('')
  const [propResults, setPropResults] = useState(null)
  const [propSearching, setPropSearching] = useState(false)
  const [property, setProperty] = useState(null)      // existing property row, or null
  const [newAddr, setNewAddr] = useState({ street: '', city: '', state: '', zip: '' })
  const [addrOpen, setAddrOpen] = useState(false)

  // Building
  const [buildings, setBuildings] = useState(null)
  const [building, setBuilding] = useState(null)      // existing building row, or null
  const [newBuildingType, setNewBuildingType] = useState(null)  // 'single_family_detached' | 'single_family_attached'

  // Unit (attached only)
  const [units, setUnits] = useState(null)
  const [unit, setUnit] = useState(null)              // {id, unit_number} or null
  const [newUnitName, setNewUnitName] = useState('')

  const ownerLabel = account ? account.account_name : (newAccountName.trim() || null)

  const searchOwners = async (q) => {
    setAcctQuery(q)
    if (q.trim().length < 2) { setAcctResults(null); return }
    setAcctSearching(true)
    try { setAcctResults(await searchAccounts(q)) }
    catch { setAcctResults([]) }
    finally { setAcctSearching(false) }
  }

  const searchProps = async (q) => {
    setPropQuery(q)
    if (q.trim().length < 2) { setPropResults(null); return }
    setPropSearching(true)
    try { setPropResults(await searchProperties(q)) }
    catch { setPropResults([]) }
    finally { setPropSearching(false) }
  }

  const pickProperty = async (p) => {
    setProperty(p)
    setBusy(true)
    try {
      const blds = await fetchBuildingsForAssessment(p.id)
      setBuildings(blds)
      setPhase('building')
    } catch (e) {
      onError(e.message || 'Could not load buildings.')
    } finally { setBusy(false) }
  }

  const pickBuilding = async (b) => {
    setBuilding(b)
    if (b.record_type_value === 'single_family_detached') {
      // Detached: the building IS the home — no unit.
      await submit({ buildingId: b.id, unitId: null, newUnit: null })
      return
    }
    setBusy(true)
    try {
      const us = await fetchUnitsForBuilding(b.id)
      setUnits(us)
      setPhase('unit')
    } catch (e) {
      onError(e.message || 'Could not load units.')
    } finally { setBusy(false) }
  }

  const chooseNewBuildingType = async (t) => {
    setNewBuildingType(t)
    if (t === 'single_family_detached') {
      await submit({ buildingId: null, newType: t, unitId: null, newUnit: null })
    } else {
      setUnits([])   // brand-new building has no units yet — type the first one
      setPhase('unit')
    }
  }

  const submit = async ({ buildingId = building?.id ?? null, newType = newBuildingType,
                          unitId = unit?.id ?? null, newUnit = newUnitName.trim() || null } = {}) => {
    setBusy(true)
    try {
      const res = await createAssessmentWorkOrder({
        accountId: account?.id ?? null,
        newAccountName: account ? null : (newAccountName.trim() || null),
        propertyId: property?.id ?? null,
        newStreet: property ? null : newAddr.street.trim(),
        newCity: property ? null : newAddr.city.trim(),
        newState: property ? null : newAddr.state.trim(),
        newZip: property ? null : newAddr.zip.trim(),
        buildingId, newBuildingType: buildingId ? null : newType,
        unitId, newUnitName: unitId ? null : newUnit,
      })
      onCreated(res)
    } catch (e) {
      onError(e.message || 'Could not create the assessment.')
    } finally { setBusy(false) }
  }

  const back = () => {
    if (phase === 'unit') { setUnit(null); setNewUnitName(''); setPhase('building'); return }
    if (phase === 'building') { setBuilding(null); setNewBuildingType(null); setBuildings(null); setPhase('property'); return }
    if (phase === 'property') { setProperty(null); setAddrOpen(false); setPhase('owner'); return }
    onClose()
  }

  const sub = phase === 'owner' ? 'Who owns this building? Owner-occupied or rental — select the owner, or add them.'
    : phase === 'property' ? `Owner: ${ownerLabel || '—'} · Find the property, or enter the address.`
    : phase === 'building' ? 'Select the building, or create it by choosing its type.'
    : 'Each attached home is a unit — select it, or type a new one.'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(7,17,31,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: C.card, width: '100%', maxWidth: 520,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)',
        maxHeight: '88dvh', overflowY: 'auto',
      }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 18, color: C.textPrimary, marginBottom: 4 }}>
          New Assessment
        </div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 16 }}>{sub}</div>

        {/* ── Phase: owner ── */}
        {phase === 'owner' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <input
              type="text" value={acctQuery} placeholder="Search owners by name…"
              onChange={(e) => searchOwners(e.target.value)} style={inputStyle}
            />
            {acctSearching && <div style={{ fontSize: 13, color: C.textMuted }}>Searching…</div>}
            {(acctResults || []).map((a) => (
              <ListButton key={a.id} title={a.account_name} sub={a.account_record_number}
                onClick={() => { setAccount(a); setNewAccountName(''); setPhase('property') }} />
            ))}
            {acctResults !== null && acctResults.length === 0 && !acctSearching && (
              <div style={{ fontSize: 13, color: C.textMuted }}>No matching owners.</div>
            )}
            <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted, textAlign: 'center', margin: '4px 0' }}>
              — or add a new owner —
            </div>
            <input
              type="text" value={newAccountName} placeholder="New owner name (person or company)"
              onChange={(e) => { setNewAccountName(e.target.value); setAccount(null) }} style={inputStyle}
            />
            <button
              onClick={() => setPhase('property')}
              disabled={!newAccountName.trim()}
              style={newAccountName.trim() ? { ...btnPrimary, minHeight: 46 } : { ...btnDisabled, minHeight: 46 }}
            >
              Continue with new owner
            </button>
          </div>
        )}

        {/* ── Phase: property ── */}
        {phase === 'property' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {!addrOpen && (
              <>
                <input
                  type="text" value={propQuery} placeholder="Search properties by name or street…"
                  onChange={(e) => searchProps(e.target.value)} style={inputStyle}
                />
                {propSearching && <div style={{ fontSize: 13, color: C.textMuted }}>Searching…</div>}
                {(propResults || []).map((p) => (
                  <ListButton key={p.id}
                    title={p.property_name || p.property_street}
                    sub={[p.property_street, p.property_city, p.property_state].filter(Boolean).join(', ')}
                    disabled={busy}
                    onClick={() => pickProperty(p)} />
                ))}
                {propResults !== null && propResults.length === 0 && !propSearching && (
                  <div style={{ fontSize: 13, color: C.textMuted }}>No matching properties.</div>
                )}
                <DashedButton label="Property is not in the list — enter the address" onClick={() => setAddrOpen(true)} />
              </>
            )}
            {addrOpen && (
              <>
                <input type="text" value={newAddr.street} placeholder="Street address"
                  onChange={(e) => setNewAddr((a) => ({ ...a, street: e.target.value }))} style={inputStyle} />
                <input type="text" value={newAddr.city} placeholder="City"
                  onChange={(e) => setNewAddr((a) => ({ ...a, city: e.target.value }))} style={inputStyle} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" value={newAddr.state} placeholder="State" maxLength={2}
                    onChange={(e) => setNewAddr((a) => ({ ...a, state: e.target.value }))}
                    style={{ ...inputStyle, flex: '0 0 90px', textTransform: 'uppercase' }} />
                  <input type="text" value={newAddr.zip} placeholder="ZIP" inputMode="numeric"
                    onChange={(e) => setNewAddr((a) => ({ ...a, zip: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }} />
                </div>
                <button
                  onClick={() => { setProperty(null); setBuildings([]); setPhase('building') }}
                  disabled={!(newAddr.street.trim() && newAddr.city.trim() && newAddr.state.trim() && newAddr.zip.trim())}
                  style={(newAddr.street.trim() && newAddr.city.trim() && newAddr.state.trim() && newAddr.zip.trim())
                    ? { ...btnPrimary, minHeight: 46 } : { ...btnDisabled, minHeight: 46 }}
                >
                  Continue with this address
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Phase: building ── */}
        {phase === 'building' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {(buildings || []).map((b) => (
              <ListButton key={b.id}
                title={b.building_number_or_name || b.building_name}
                sub={b.record_type_value === 'single_family_detached' ? 'Single Family Detached — no units'
                  : b.record_type_value === 'single_family_attached' ? 'Single Family Attached — pick the unit next'
                  : (b.record_type_value || null)}
                disabled={busy}
                onClick={() => pickBuilding(b)} />
            ))}
            {(buildings || []).length > 0 && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted, textAlign: 'center', margin: '4px 0' }}>
                — or create the building —
              </div>
            )}
            <ListButton title="Single Family Detached" sub="One home, no units — the assessment lives on the building"
              disabled={busy} onClick={() => chooseNewBuildingType('single_family_detached')} />
            <ListButton title="Single Family Attached" sub="Townhome / duplex — each attached home is a unit"
              disabled={busy} onClick={() => chooseNewBuildingType('single_family_attached')} />
          </div>
        )}

        {/* ── Phase: unit (attached only) ── */}
        {phase === 'unit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {(units || []).map((u) => (
              <ListButton key={u.id} title={u.unit_number} disabled={busy}
                onClick={async () => { setUnit(u); await submit({ unitId: u.id, newUnit: null }) }} />
            ))}
            {(units || []).length > 0 && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textMuted, textAlign: 'center', margin: '4px 0' }}>
                — or add a new unit —
              </div>
            )}
            <input type="text" value={newUnitName} placeholder='Unit (e.g. "A", "101", "Left")'
              onChange={(e) => { setNewUnitName(e.target.value); setUnit(null) }} style={inputStyle} />
            <button
              onClick={() => submit({ unitId: null, newUnit: newUnitName.trim() })}
              disabled={busy || !newUnitName.trim()}
              style={(busy || !newUnitName.trim()) ? { ...btnDisabled, minHeight: 46 } : { ...btnPrimary, minHeight: 46 }}
            >
              {busy ? 'Creating…' : 'Create Assessment'}
            </button>
          </div>
        )}

        {busy && phase !== 'unit' && (
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 12 }}>Working…</div>
        )}

        <button onClick={back} disabled={busy} style={{ ...btnSecondary, width: '100%' }}>
          {phase === 'owner' ? 'Cancel' : 'Back'}
        </button>
      </div>
    </div>
  )
}
