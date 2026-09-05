import { useState } from 'react'
import { C } from '../data/constants'
import { LoadingState } from './UI'
import { PINNED_TABLE, pinnedHeaderCell, ROW_RULE } from '../lib/pinnedTableHeader'
import { sizeEquipmentForLoad } from '../data/equipmentSizingService'

// Put in the loads, get back the machines that carry them.
//
// Nicholas, 2026-09-05: "Think of an energy auditor that's not an HVAC expert."
// So this screen asks for facts an auditor already has off the load calculation
// and never asks him to choose a tonnage, a model number or a brand.
//
// It is deliberately standalone: three numbers in, ranked machines out, nothing
// saved and no record involved. The same call fills itself in from the
// assessment when it is reached from an opportunity line item.

const FIELD = {
  width: '100%', padding: '8px 10px', border: `1px solid ${C.borderDark}`,
  borderRadius: 6, fontSize: 13, color: C.textPrimary, background: C.card,
  fontFamily: 'JetBrains Mono, monospace',
}
const LABEL = { fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 5, display: 'block' }
const HINT = { fontSize: 11, color: C.textMuted, marginTop: 4 }

function Num({ label, hint, value, onChange, placeholder }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <input type="number" inputMode="decimal" style={FIELD} value={value}
             placeholder={placeholder}
             onChange={e => onChange(e.target.value)} />
      {hint && <div style={HINT}>{hint}</div>}
    </div>
  )
}

export default function EquipmentSizingTool() {
  const [heating, setHeating] = useState('')
  const [cooling, setCooling] = useState('')
  const [designTemp, setDesignTemp] = useState('')
  const [ducting, setDucting] = useState('')
  const [maxCooling, setMaxCooling] = useState('115')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ready = heating !== '' && designTemp !== ''

  async function run() {
    setBusy(true); setError(''); setRows(null)
    try {
      setRows(await sizeEquipmentForLoad({
        heatingLoadBtuh: Number(heating),
        coolingLoadBtuh: cooling === '' ? null : Number(cooling),
        winterDesignTempF: Number(designTemp),
        ducting: ducting || null,
        coolingMaxPct: Number(maxCooling) || 115,
        limit: 25,
      }))
    } catch (e) {
      setError(e.message || 'The sizing check could not be run.')
    } finally { setBusy(false) }
  }

  // Below 5F nothing is published, so the figure is an estimate. That has to be
  // visible on the row it applies to, not buried in a footnote.
  const anyEstimated = (rows || []).some(r => r.output_basis === 'estimated')

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary, margin: 0 }}>
          Equipment Sizing
        </h1>
        <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
          Enter the design loads from the load calculation. LEAP checks every certified
          heat pump in the catalogue against them and ranks what carries the load.
        </div>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <Num label="Design heating load (BTU/h)" value={heating} onChange={setHeating}
               placeholder="30000" hint="From the Manual J" />
          <Num label="Design cooling load (BTU/h)" value={cooling} onChange={setCooling}
               placeholder="18000" hint="Leave blank to rank on heating only" />
          <Num label="Winter design temperature (°F)" value={designTemp} onChange={setDesignTemp}
               placeholder="-3" hint="The 99% outdoor design temperature" />
          <div>
            <label style={LABEL}>System type</label>
            <select style={FIELD} value={ducting} onChange={e => setDucting(e.target.value)}>
              <option value="">Ducted and ductless</option>
              <option value="Ducted">Ducted only</option>
              <option value="Ductless">Ductless only</option>
            </select>
            <div style={HINT}>What the building can take</div>
          </div>
          <Num label="Cooling oversize limit (%)" value={maxCooling} onChange={setMaxCooling}
               placeholder="115"
               hint="115 is the mixed-climate rule; a heating-dominant climate allows more" />
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={run} disabled={!ready || busy}
            style={{ background: ready && !busy ? C.emerald : C.border,
                     color: ready && !busy ? '#08351f' : C.textMuted,
                     border: 'none', borderRadius: 6, padding: '9px 18px',
                     fontSize: 13, fontWeight: 600,
                     cursor: ready && !busy ? 'pointer' : 'not-allowed' }}>
            {busy ? 'Checking…' : 'Find equipment'}
          </button>
          {!ready && (
            <span style={{ fontSize: 12, color: C.textMuted }}>
              A heating load and a design temperature are needed before anything can be sized.
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: C.card, border: `1px solid ${C.sky}`, borderLeft: `3px solid ${C.sky}`,
                      borderRadius: 6, padding: '12px 14px', fontSize: 12.5, color: C.textPrimary, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {busy && <LoadingState />}

      {rows && rows.length === 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '18px 20px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.textPrimary, marginBottom: 6 }}>
            Nothing in the catalogue matches those loads.
          </div>
          <div style={{ fontSize: 12.5, color: C.textSecondary }}>
            The cooling load filters the catalogue before anything is ranked, so a cooling
            figure far from any certified machine will empty the list. Try widening the
            cooling oversize limit, clearing the cooling load, or allowing both system types.
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          {anyEstimated && (
            <div style={{ background: C.cardSecondary, border: `1px solid ${C.borderDark}`,
                          borderLeft: `3px solid ${C.sky}`, borderRadius: 6,
                          padding: '11px 14px', fontSize: 12.5, color: C.textPrimary, marginBottom: 12 }}>
              <strong>Some figures below are estimated.</strong> Certified performance is published
              at 47°F, 17°F and 5°F only. Below 5°F the output is extrapolated from the 17°F–5°F
              slope, never above the published 5°F figure. Rows marked <em>estimated</em> have not
              been measured at this temperature by anyone.
            </div>
          )}

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                        overflow: 'auto', maxHeight: '60vh' }}>
            <table style={PINNED_TABLE}>
              <thead>
                <tr>
                  {['Equipment', 'Type', 'Compressor',
                    `Output at ${designTemp}°F`, 'Heating', 'Balance point',
                    'Back-up', 'Cooling', 'HSPF2', 'What it means'].map(h => (
                    <th key={h} style={{ ...pinnedHeaderCell(), fontSize: 11, textAlign: 'left',
                                         whiteSpace: 'nowrap', padding: '9px 12px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.product_id}>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textPrimary }}>
                      <div style={{ fontWeight: 600 }}>{r.manufacturer}</div>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: C.textSecondary }}>
                        {r.model_number}
                      </div>
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12, color: C.textSecondary }}>{r.ducting}</td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12, color: C.textSecondary }}>{r.compressor}</td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textPrimary,
                                 fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                      {r.output_at_design_btuh?.toLocaleString()}
                      {r.output_basis === 'estimated' && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: C.sky,
                                       fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em' }}>EST</span>
                      )}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5,
                                 fontFamily: 'JetBrains Mono, monospace',
                                 color: Number(r.heating_coverage_pct) >= 100 ? C.emeraldMid : C.textSecondary,
                                 fontWeight: Number(r.heating_coverage_pct) >= 100 ? 600 : 400 }}>
                      {r.heating_coverage_pct}%
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textSecondary,
                                 fontFamily: 'JetBrains Mono, monospace' }}>
                      {r.balance_point_f == null ? '—' : `${r.balance_point_f}°F`}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textSecondary,
                                 fontFamily: 'JetBrains Mono, monospace' }}>
                      {Number(r.supplemental_heat_kw) === 0 ? 'none' : `${r.supplemental_heat_kw} kW`}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textSecondary,
                                 fontFamily: 'JetBrains Mono, monospace' }}>
                      {r.cooling_coverage_pct == null ? '—' : `${r.cooling_coverage_pct}%`}
                    </td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12.5, color: C.textSecondary,
                                 fontFamily: 'JetBrains Mono, monospace' }}>{r.hspf2 ?? '—'}</td>
                    <td style={{ ...ROW_RULE, padding: '9px 12px', fontSize: 12, color: C.textSecondary,
                                 minWidth: 260 }}>{r.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 10 }}>
            Balance point is the coldest outdoor temperature a machine keeps up on its own;
            a dash means it carries the load all the way down to the design temperature.
            Performance is the manufacturer's certified data, the same filings the public
            cold-climate list publishes.
          </div>
        </>
      )}
    </div>
  )
}
