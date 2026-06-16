import { useMemo, useState } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'

// =====================================================================
// OutreachFilterPanel
//
// Left-rail filter panel for the Outreach Map view. Mirrors the
// Manus NC Property Outreach Priority Dashboard filter surface — open
// search across multiple text fields plus state / county / account /
// subsidy / units / disaster / contract expiration / energy burden
// dropdowns and sliders.
//
// Stateless: parent owns the filter state. This component only renders
// controls and emits change events via the updateFilter callback.
//
// The empty filter shape:
//   {
//     search: '',
//     states: new Set(),       // multi-select: ['WI','NC','MI',...]
//     county: 'all',           // single select
//     account: 'all',          // single select
//     subsidyType: 'all',
//     unitsMin: null,
//     unitsMax: null,
//     hasDisaster: 'all',      // 'all' | 'yes' | 'no'
//     contractExpiringWithin: 'all',  // 'all' | '2' | '5' | '10'  (years)
//     energyBurdenMin: null,
//     showEngaged: false,
//   }
//
// `applyFilters(rows, filters)` (exported) is the canonical filter
// applicator. Map view and viewport-list both run through it so they
// stay in lockstep.
// =====================================================================

export const EMPTY_FILTERS = {
  search: '',
  states: new Set(),
  county: 'all',
  account: 'all',
  subsidyType: 'all',
  unitsMin: null,
  unitsMax: null,
  hasDisaster: 'all',
  contractExpiringWithin: 'all',
  energyBurdenMin: null,
  showEngaged: false,
}

export function countActiveFilters(f) {
  let n = 0
  if (f.search && f.search.trim().length > 0) n++
  if (f.states.size > 0) n++
  if (f.county !== 'all') n++
  if (f.account !== 'all') n++
  if (f.subsidyType !== 'all') n++
  if (f.unitsMin != null) n++
  if (f.unitsMax != null) n++
  if (f.hasDisaster !== 'all') n++
  if (f.contractExpiringWithin !== 'all') n++
  if (f.energyBurdenMin != null) n++
  if (f.showEngaged) n++
  return n
}

export function applyFilters(rows, f) {
  if (!Array.isArray(rows)) return []
  let out = rows

  // Open search — case-insensitive substring across the visible text
  // fields. Matches the Manus dashboard placeholder exactly.
  const q = (f.search || '').trim().toLowerCase()
  if (q.length > 0) {
    out = out.filter(r => {
      const haystack = [
        r.name, r.address, r.county, r.state, r.zip,
        r.account, r.hudPropertyId, r.hudContractNumber,
        r.accountHudParticipantNumber,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }

  if (f.states.size > 0) out = out.filter(r => f.states.has(r.state))

  if (f.county     !== 'all') out = out.filter(r => r.county  === f.county)
  if (f.account    !== 'all') out = out.filter(r => r.account === f.account)
  if (f.subsidyType!== 'all') out = out.filter(r => r.hudSubsidyType === f.subsidyType)

  if (f.unitsMin != null) out = out.filter(r => (r.units ?? 0) >= f.unitsMin)
  if (f.unitsMax != null) out = out.filter(r => (r.units ?? 0) <= f.unitsMax)

  if (f.hasDisaster === 'yes') out = out.filter(r => r.hasDisasterExposure)
  if (f.hasDisaster === 'no')  out = out.filter(r => !r.hasDisasterExposure)

  if (f.contractExpiringWithin !== 'all') {
    const years   = Number(f.contractExpiringWithin)
    const horizon = new Date()
    horizon.setFullYear(horizon.getFullYear() + years)
    const horizonIso = horizon.toISOString().slice(0, 10)
    out = out.filter(r => r.contractExpiration && r.contractExpiration <= horizonIso)
  }

  if (f.energyBurdenMin != null) {
    out = out.filter(r => (r.energyBurden ?? 0) >= f.energyBurdenMin)
  }

  if (!f.showEngaged) out = out.filter(r => !r.hasActiveOpportunity)

  return out
}

// ---------- internal styles ----------
const labelStyle = {
  fontSize: 10.5, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 0.5, marginBottom: 5, display: 'block',
}
const inputStyle = {
  width: '100%', padding: '7px 10px', fontSize: 12.5,
  border: `1px solid ${C.border}`, borderRadius: 6,
  background: C.card, color: C.textPrimary,
}
const sectionStyle = { marginBottom: 16 }

// ---------- component ----------
export default function OutreachFilterPanel({
  allProperties,         // unfiltered rows — used to derive dropdown options
  filters,
  updateFilter,
  resetFilters,
  visibleCount,
  totalCount,
}) {
  // Derived option lists. Recomputed when the input dataset changes,
  // not on every keystroke.
  const { counties, accounts, subsidyTypes, states } = useMemo(() => {
    const cSet = new Set(), aSet = new Set(), sSet = new Set(), stSet = new Set()
    for (const r of (allProperties || [])) {
      if (r.county)         cSet.add(r.county)
      if (r.account && r.account !== '—') aSet.add(r.account)
      if (r.hudSubsidyType) sSet.add(r.hudSubsidyType)
      if (r.state)          stSet.add(r.state)
    }
    return {
      counties:     [...cSet].sort(),
      accounts:     [...aSet].sort(),
      subsidyTypes: [...sSet].sort(),
      states:       [...stSet].sort(),
    }
  }, [allProperties])

  const [accountQuery, setAccountQuery] = useState('')
  const filteredAccounts = useMemo(() => {
    const q = accountQuery.trim().toLowerCase()
    if (q.length === 0) return accounts.slice(0, 100)
    return accounts.filter(a => a.toLowerCase().includes(q)).slice(0, 100)
  }, [accountQuery, accounts])

  const toggleState = (s) => {
    const next = new Set(filters.states)
    if (next.has(s)) next.delete(s); else next.add(s)
    updateFilter('states', next)
  }

  const activeCount = countActiveFilters(filters)

  return (
    <div style={{
      width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden',
      background: C.card, padding: '14px 16px',
      borderRight: `1px solid ${C.border}`,
    }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <Icon path="M3 4h18M6 12h12M10 20h4" size={15} color={C.textPrimary} />
          <div style={{ fontSize:13, fontWeight:600, color:C.textPrimary }}>Filters</div>
          {activeCount > 0 && (
            <span style={{
              background:'#3ecf8e', color:'#fff', borderRadius:10, padding:'1px 8px',
              fontSize:10.5, fontWeight:600,
            }}>{activeCount}</span>
          )}
        </div>
        {activeCount > 0 && (
          <button onClick={resetFilters}
            style={{
              background:'transparent', border:'none', cursor:'pointer',
              fontSize:11.5, color:C.textSecondary, padding:'4px 6px',
              display:'flex', alignItems:'center', gap:4,
            }}>
            <Icon path="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" size={11} color={C.textSecondary} />
            Reset
          </button>
        )}
      </div>

      {/* Open search */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Search</label>
        <div style={{ position:'relative' }}>
          <Icon path="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" size={13} color={C.textMuted} />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Name, address, city, ZIP, account, HUD ID…"
            style={{ ...inputStyle, paddingLeft: 30 }}
          />
          <div style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
            <Icon path="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" size={13} color={C.textMuted} />
          </div>
          {filters.search && (
            <button onClick={() => updateFilter('search', '')}
              style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'transparent', border:'none', cursor:'pointer', padding:0 }}>
              <Icon path="M18 6L6 18M6 6l12 12" size={13} color={C.textMuted} />
            </button>
          )}
        </div>
      </div>

      {/* State chips */}
      <div style={sectionStyle}>
        <label style={labelStyle}>State</label>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
          {states.length === 0 && <span style={{ fontSize:11, color:C.textMuted }}>—</span>}
          {states.map(s => {
            const active = filters.states.has(s)
            return (
              <button key={s} onClick={() => toggleState(s)}
                style={{
                  padding:'4px 11px', fontSize:11.5, fontWeight:600,
                  borderRadius:14, cursor:'pointer',
                  background: active ? '#3ecf8e' : C.page,
                  border: `1px solid ${active ? '#2aab72' : C.border}`,
                  color: active ? '#fff' : C.textSecondary,
                }}>{s}</button>
            )
          })}
        </div>
      </div>

      {/* County */}
      <div style={sectionStyle}>
        <label style={labelStyle}>County</label>
        <select value={filters.county} onChange={(e) => updateFilter('county', e.target.value)} style={inputStyle}>
          <option value="all">All counties</option>
          {counties.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Account / Organization */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Account / Organization</label>
        {filters.account === 'all' ? (
          <>
            <input
              type="text"
              value={accountQuery}
              onChange={(e) => setAccountQuery(e.target.value)}
              placeholder="Search accounts…"
              style={{ ...inputStyle, marginBottom: 4 }}
            />
            {accountQuery.length > 0 && (
              <div style={{
                maxHeight: 180, overflowY: 'auto',
                border: `1px solid ${C.border}`, borderRadius: 6,
                background: C.page,
              }}>
                {filteredAccounts.length === 0 && (
                  <div style={{ padding:'8px 10px', fontSize:12, color:C.textMuted }}>No matches</div>
                )}
                {filteredAccounts.map(a => (
                  <div key={a} onClick={() => { updateFilter('account', a); setAccountQuery('') }}
                    style={{ padding:'7px 10px', fontSize:12, color:C.textPrimary, cursor:'pointer', borderBottom:`1px solid ${C.border}` }}>
                    {a}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'7px 10px', fontSize:12, background:'#e8f8f2',
            border:'1px solid #2aab72', borderRadius:6, color:'#1a7a4e', fontWeight:500,
          }}>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{filters.account}</span>
            <button onClick={() => updateFilter('account', 'all')}
              style={{ background:'transparent', border:'none', cursor:'pointer', padding:0, marginLeft:8 }}>
              <Icon path="M18 6L6 18M6 6l12 12" size={12} color="#1a7a4e" />
            </button>
          </div>
        )}
      </div>

      {/* Subsidy type */}
      <div style={sectionStyle}>
        <label style={labelStyle}>HUD Subsidy Type</label>
        <select value={filters.subsidyType} onChange={(e) => updateFilter('subsidyType', e.target.value)} style={inputStyle}>
          <option value="all">All subsidy types</option>
          {subsidyTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Units min / max */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Units</label>
        <div style={{ display:'flex', gap:8 }}>
          <input
            type="number" min={0} placeholder="Min"
            value={filters.unitsMin ?? ''}
            onChange={(e) => updateFilter('unitsMin', e.target.value === '' ? null : Number(e.target.value))}
            style={inputStyle}
          />
          <input
            type="number" min={0} placeholder="Max"
            value={filters.unitsMax ?? ''}
            onChange={(e) => updateFilter('unitsMax', e.target.value === '' ? null : Number(e.target.value))}
            style={inputStyle}
          />
        </div>
      </div>

      {/* Disaster exposure */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Disaster Exposure</label>
        <select value={filters.hasDisaster} onChange={(e) => updateFilter('hasDisaster', e.target.value)} style={inputStyle}>
          <option value="all">Any</option>
          <option value="yes">Has disaster exposure</option>
          <option value="no">No disaster exposure</option>
        </select>
      </div>

      {/* Contract expiration window */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Contract Expiration</label>
        <select value={filters.contractExpiringWithin} onChange={(e) => updateFilter('contractExpiringWithin', e.target.value)} style={inputStyle}>
          <option value="all">Any expiration</option>
          <option value="2">Expiring within 2 years</option>
          <option value="5">Expiring within 5 years</option>
          <option value="10">Expiring within 10 years</option>
        </select>
      </div>

      {/* Energy burden minimum */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Energy Burden (min)</label>
        <input
          type="number" min={0} max={1} step={0.01} placeholder="e.g. 0.06"
          value={filters.energyBurdenMin ?? ''}
          onChange={(e) => updateFilter('energyBurdenMin', e.target.value === '' ? null : Number(e.target.value))}
          style={inputStyle}
        />
        <div style={{ fontSize:10.5, color:C.textMuted, marginTop:4 }}>Decimal — 0.06 = 6% of income on energy</div>
      </div>

      {/* Show engaged toggle */}
      <div style={sectionStyle}>
        <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:C.textPrimary }}>
          <input
            type="checkbox"
            checked={filters.showEngaged}
            onChange={(e) => updateFilter('showEngaged', e.target.checked)}
            style={{ cursor:'pointer' }}
          />
          Include properties with active opportunity
        </label>
      </div>

      {/* Result count footer */}
      <div style={{
        marginTop: 6, padding:'8px 10px',
        background: C.page, border:`1px solid ${C.border}`, borderRadius:6,
        fontSize: 11.5, color: C.textSecondary,
      }}>
        <span style={{ fontWeight:700, color:C.textPrimary }}>{(visibleCount ?? 0).toLocaleString()}</span>
        {' of '}
        <span style={{ fontWeight:700, color:C.textPrimary }}>{(totalCount ?? 0).toLocaleString()}</span>
        {' properties match'}
      </div>
    </div>
  )
}
