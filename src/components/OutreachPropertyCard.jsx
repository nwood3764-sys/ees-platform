import { useEffect, useState } from 'react'
import { C } from '../data/constants'
import { fetchPropertyDetail } from '../data/outreachPropertiesService'

// ---------------------------------------------------------------------------
// OutreachPropertyCard.jsx
//
// Slide-in detail overlay for a single property, opened by clicking a marker
// on the Outreach map (or a row Open action). Read-only. Mirrors the column
// layout of the source HUD lookup card: Property Details · Building Info ·
// Program Flags · Owner/Management · Contracts · Energy Burden (DOE) ·
// Disaster Exposure (NC only) · EPC eligibility · research links.
//
// Data comes from fetchPropertyDetail (extended outreach_properties_v +
// property_hud_contract_lines). Sections whose program block is null are
// hidden — a LIHTC-only property shows no Section 8 contract section, etc.
//
// Utilities & Heating and the numeric Score Breakdown are intentionally NOT
// rendered: HUD's APIs do not carry utility provider/rate/equipment, and the
// scores are derived metrics not yet computed in LEAP. The layout reserves
// their position via a single muted "Not yet available in LEAP" note so they
// can be dropped in later without rearranging the card.
//
// Design system only: emerald/navy/sky/neutral; SVG icons; Inter. No red.
// ---------------------------------------------------------------------------

const fmtDate = (d) => {
  if (!d) return '—'
  try {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return String(d)
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return String(d) }
}
const fmtMoney = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }))
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString())
const dash = (s) => (s == null || s === '' ? '—' : s)

// LIHTC credit-type code → label
const CREDIT_TYPE = { '1': '30% present value', '2': '70% present value', '3': 'Both', '4': 'Tax-exempt bond' }

function Icon({ path, size = 14, color = C.textSecondary }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      {path}
    </svg>
  )
}
const ICONS = {
  pin: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="1" /><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01" /></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></>,
  user: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  doc: <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
  bolt: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></>,
  storm: <><path d="M12 2v6M12 16v6M4 12h6M16 12h6" /><circle cx="12" cy="12" r="3" /></>,
  link: <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  close: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
}

function Section({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <Icon path={icon} size={13} color={C.textMuted} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.textMuted }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 12.5, lineHeight: 1.45 }}>
      <span style={{ color: C.textSecondary, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.textPrimary, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{children}</span>
    </div>
  )
}

function FlagItem({ on, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', fontSize: 12.5 }}>
      <span style={{
        width: 16, height: 16, borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: on ? C.emerald : C.page, border: `1px solid ${on ? C.emerald : C.borderDark}`,
      }}>
        {on && <Icon path={ICONS.check} size={10} color="#fff" />}
      </span>
      <span style={{ color: on ? C.textPrimary : C.textMuted, fontWeight: on ? 600 : 400 }}>{label}</span>
    </div>
  )
}

function ProgramBadge({ label, tone = 'emerald' }) {
  const bg = tone === 'emerald' ? 'rgba(62,207,142,0.12)' : tone === 'sky' ? 'rgba(126,179,232,0.16)' : 'rgba(13,26,46,0.06)'
  const fg = tone === 'emerald' ? C.emeraldMid : tone === 'sky' ? '#3f72a8' : C.textSecondary
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 100, background: bg, color: fg, letterSpacing: '0.02em' }}>{label}</span>
  )
}

export default function OutreachPropertyCard({ propertyId, onClose, onOpenAccount, onOpenRecord, onAdvance }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(null)
    fetchPropertyDetail(propertyId)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(e => { if (alive) { setErr(e); setLoading(false) } })
    return () => { alive = false }
  }, [propertyId])

  // Esc to close
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const gmaps = data && data.latitude != null && data.longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${data.latitude},${data.longitude}`
    : (data ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([data.street, data.city, data.state, data.zip].filter(Boolean).join(', '))}` : null)

  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.42)', zIndex: 1200,
        animation: 'leapFade 180ms ease',
      }} />
      {/* panel */}
      <div role="dialog" aria-label="Property detail" style={{
        position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(440px, 100vw)',
        background: C.card, zIndex: 1201, boxShadow: '-8px 0 32px rgba(7,17,31,0.18)',
        display: 'flex', flexDirection: 'column', animation: 'leapSlideIn 220ms cubic-bezier(0.22,1,0.36,1)',
      }}>
        <style>{`
          @keyframes leapSlideIn { from { transform: translateX(24px); opacity: 0.4 } to { transform: translateX(0); opacity: 1 } }
          @keyframes leapFade { from { opacity: 0 } to { opacity: 1 } }
        `}</style>

        {/* header */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, lineHeight: 1.3 }}>
              {loading ? 'Loading…' : dash(data?.name)}
            </div>
            {data && (
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
                {[data.city, data.state, data.zip].filter(Boolean).join(', ')}
              </div>
            )}
            {data && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
                {data.inMfAssisted && <ProgramBadge label="Section 8 / MF" tone="emerald" />}
                {data.inLihtc && <ProgramBadge label="LIHTC" tone="sky" />}
                {data.inPublicHousing && <ProgramBadge label="Public Housing" tone="emerald" />}
                {data.epcEligible === true && <ProgramBadge label="EPC Eligible" tone="emerald" />}
                {data.epcEligible === false && <ProgramBadge label="EPC: RAD-converted" tone="neutral" />}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, lineHeight: 0,
          }}>
            <Icon path={ICONS.close} size={18} color={C.textMuted} />
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {loading && <div style={{ color: C.textMuted, fontSize: 13, padding: '20px 0' }}>Loading property detail…</div>}
          {err && <div style={{ color: '#3f72a8', fontSize: 13, padding: '12px 14px', background: 'rgba(126,179,232,0.12)', borderRadius: 8 }}>
            Couldn’t load this property’s detail. Try again or open the full record.
          </div>}

          {data && !loading && (
            <>
              {/* Property Details */}
              <Section icon={ICONS.pin} title="Property Details">
                <Row label="Address">{dash(data.street)}</Row>
                <Row label="City">{dash(data.city)}</Row>
                <Row label="County">{dash(data.county)}</Row>
                <Row label="State">{dash(data.state)}</Row>
                <Row label="ZIP">{dash(data.zip)}</Row>
                <Row label="Category">{dash(data.category)}</Row>
                {data.hudPropertyId && <Row label="HUD Property ID"><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{data.hudPropertyId}</span></Row>}
                {data.lihtcProjectId && <Row label="LIHTC ID"><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{data.lihtcProjectId}</span></Row>}
                {gmaps && (
                  <a href={gmaps} target="_blank" rel="noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 8, padding: '7px 12px',
                    background: C.emerald, color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  }}>
                    <Icon path={ICONS.pin} size={13} color="#fff" /> View on Google Maps
                  </a>
                )}
              </Section>

              {/* Building Info */}
              <Section icon={ICONS.building} title="Building Info">
                <Row label="Building Type">{dash(data.buildingType)}</Row>
                <Row label="Total Units">{fmtNum(data.totalUnits)}</Row>
                <Row label="Assisted Units">{fmtNum(data.assistedUnits)}</Row>
                <Row label="Buildings">{fmtNum(data.totalBuildings)}</Row>
                <Row label="Year Built">{dash(data.yearBuilt)}</Row>
              </Section>

              {/* Program Flags */}
              <Section icon={ICONS.flag} title="Program Flags">
                <FlagItem on={data.isSubsidized} label="Subsidized" />
                <FlagItem on={data.isSec8} label="Section 8" />
                <FlagItem on={data.is202811} label="202 / 811 Elderly / Disabled" />
                <FlagItem on={data.isPac || data.isPrac} label="PAC / PRAC" />
                <FlagItem on={data.isRadConverted} label="RAD Converted" />
                <FlagItem on={data.inLihtc} label="LIHTC" />
                <FlagItem on={data.inPublicHousing} label="Public Housing (Section 9)" />
              </Section>

              {/* Contracts (one-to-many) */}
              {data.contracts && data.contracts.length > 0 && (
                <Section icon={ICONS.doc} title={`HUD Contracts (${data.contracts.length})`}>
                  {data.contracts.map((c, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: C.page, borderRadius: 7, marginBottom: 7, border: `1px solid ${C.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: C.textPrimary }}>{dash(c.number)}</span>
                        <span style={{ fontSize: 10.5, color: C.textSecondary, fontWeight: 600 }}>{dash(c.programType)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: C.textSecondary }}>
                        <span>{c.units != null ? `${fmtNum(c.units)} units` : ''}</span>
                        <span>Expires {fmtDate(c.expiration)}</span>
                      </div>
                    </div>
                  ))}
                </Section>
              )}

              {/* LIHTC block */}
              {data.lihtc && (
                <Section icon={ICONS.doc} title="LIHTC">
                  {data.lihtc.projectName && <Row label="Project">{data.lihtc.projectName}</Row>}
                  <Row label="Allocation">{fmtMoney(data.lihtc.allocation)}</Row>
                  <Row label="Total Units">{fmtNum(data.lihtc.totalUnits)}</Row>
                  <Row label="Low-Income Units">{fmtNum(data.lihtc.lowIncomeUnits)}</Row>
                  <Row label="Placed in Service">{dash(data.lihtc.yearPlacedInService)}</Row>
                  <Row label="Credit Type">{CREDIT_TYPE[data.lihtc.creditType] || dash(data.lihtc.creditType)}</Row>
                  {(data.lihtc.targetElderly || data.lihtc.targetDisabled || data.lihtc.targetHomeless) && (
                    <Row label="Target Population">
                      {[data.lihtc.targetElderly && 'Elderly', data.lihtc.targetDisabled && 'Disabled', data.lihtc.targetHomeless && 'Homeless'].filter(Boolean).join(', ')}
                    </Row>
                  )}
                </Section>
              )}

              {/* Public Housing block */}
              {data.publicHousing && (
                <Section icon={ICONS.building} title="Public Housing (Section 9)">
                  <Row label="Authority">{dash(data.publicHousing.authorityName)}</Row>
                  <Row label="PHA Code"><span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}>{dash(data.publicHousing.participantCode)}</span></Row>
                  <Row label="Development">{dash(data.publicHousing.developmentCode)}</Row>
                  <Row label="Total Units">{fmtNum(data.publicHousing.totalUnits)}</Row>
                  <Row label="Occupied">{data.publicHousing.pctOccupied != null ? `${fmtNum(data.publicHousing.totalOccupied)} (${Math.round(data.publicHousing.pctOccupied)}%)` : fmtNum(data.publicHousing.totalOccupied)}</Row>
                  <FlagItem on={data.publicHousing.scatteredSite} label="Scattered Site" />
                  {data.publicHousing.earliestConstructionYear && <Row label="Earliest Built">{data.publicHousing.earliestConstructionYear}</Row>}
                  {data.publicHousing.avgUtilityAllowance != null && <Row label="Avg Utility Allowance">{fmtMoney(data.publicHousing.avgUtilityAllowance)}/mo</Row>}
                  {data.publicHousing.authorityPhone && <Row label="Authority Phone">{data.publicHousing.authorityPhone}</Row>}
                </Section>
              )}

              {/* Owner / Management */}
              <Section icon={ICONS.user} title="Owner / Management">
                {data.accountId && data.accountName ? (
                  <Row label="Owner Account">
                    <button onClick={() => onOpenAccount?.(data.accountId)} style={{
                      background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                      color: C.emeraldMid, fontWeight: 700, fontSize: 12.5, textDecoration: 'underline', textUnderlineOffset: 2,
                    }}>{data.accountName}</button>
                  </Row>
                ) : (
                  <Row label="Owner Account">{dash(data.accountName)}</Row>
                )}
                {data.managementOrg && <Row label="Management">{data.managementOrg}</Row>}
                {data.managementPhone && <Row label="Mgmt Phone">{data.managementPhone}</Row>}
                {data.managementEmail && <Row label="Mgmt Email">{data.managementEmail}</Row>}
                {data.reacScore && <Row label="REAC Score">{data.reacScore}{data.reacDate ? ` (${fmtDate(data.reacDate)})` : ''}</Row>}
              </Section>

              {/* Energy Burden (DOE LEAD) — shown only if present */}
              {(data.energyBurden != null || data.avgEnergyCost != null) && (
                <Section icon={ICONS.bolt} title="Energy Burden (DOE LEAD)">
                  {data.energyBurden != null && <Row label="Energy Burden">{data.energyBurden}% of income</Row>}
                  {data.avgEnergyCost != null && <Row label="Avg Monthly Energy">{fmtMoney(data.avgEnergyCost)}</Row>}
                  {data.lowIncomePct != null && <Row label="Low-Income Share">{Math.round(data.lowIncomePct)}%</Row>}
                </Section>
              )}

              {/* Disaster Exposure — NC only */}
              {data.disaster && (
                <Section icon={ICONS.storm} title="Disaster Exposure (FEMA)">
                  <Row label="Declared Disasters">{fmtNum(data.disaster.declarationCount)}</Row>
                  <Row label="Hurricane Declarations">{fmtNum(data.disaster.hurricaneCount)}</Row>
                  <Row label="Most Recent">{fmtDate(data.disaster.mostRecent)}</Row>
                </Section>
              )}

              {/* Research links */}
              <Section icon={ICONS.link} title="Research Links">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {gmaps && <LinkChip href={gmaps} label="Google Maps" />}
                  <LinkChip href="https://www.hud.gov/program_offices/public_indian_housing/reac/products/prodpass" label="HUD REAC" />
                  <LinkChip href="https://nhpd.preservationdatabase.org/" label="NHPD" />
                  {data.lihtcProjectId && <LinkChip href={`https://lihtc.huduser.gov/`} label="LIHTC DB" />}
                </div>
              </Section>

              {/* Utilities & Heating (EIA + gas territory + heating heuristic) */}
              {(data.electricUtility || data.gasUtility || data.heatingEstimate || data.hasGasService != null) && (
                <Section icon={ICONS.bolt} title="Utilities & Heating">
                  {data.electricUtility && <Row label="Electric Utility">{data.electricUtility}</Row>}
                  {data.electricRate != null && data.electricRate > 0 && <Row label="Electric Rate">{(data.electricRate * 100).toFixed(2)}¢/kWh</Row>}
                  {data.electricUtilityType && <Row label="Utility Type">{data.electricUtilityType}</Row>}
                  <Row label="Gas Service">{data.hasGasService === false ? 'Not available' : data.hasGasService === true ? 'Available' : '—'}</Row>
                  {data.gasUtility && <Row label="Gas Utility">{data.gasUtility}</Row>}
                  {data.heatingEstimate && <Row label="Heating (Est.)">{data.heatingEstimate}</Row>}
                  <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, fontStyle: 'italic' }}>
                    Electric/rate from EIA 861; gas by county territory; heating estimated from age, type &amp; fuel.
                  </div>
                </Section>
              )}

              {/* Reserved (not yet in LEAP) */}
              <div style={{ marginTop: 4, padding: '10px 12px', background: C.page, borderRadius: 7, border: `1px dashed ${C.borderDark}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 3 }}>
                  Score Breakdown
                </div>
                <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.4 }}>
                  Computed priority scores (age, disaster, weatherization) are not yet implemented in LEAP. Reserved for a future build.
                </div>
              </div>
            </>
          )}
        </div>

        {/* sticky action footer — preserves advance/open-record from the card */}
        {data && !loading && (
          <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 16px', display: 'flex', gap: 10, background: C.card }}>
            <button onClick={() => onOpenRecord?.(data.id)} style={{
              flex: 1, padding: '9px 12px', background: C.card, border: `1px solid ${C.borderDark}`, borderRadius: 7,
              color: C.textPrimary, fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
            }}>Open Property Record</button>
            <button onClick={() => onAdvance?.(data)} style={{
              flex: 1, padding: '9px 12px', background: C.emerald, border: 'none', borderRadius: 7,
              color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
            }}>Advance to Opportunity →</button>
          </div>
        )}
      </div>
    </>
  )
}

function LinkChip({ href, label }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px',
      background: C.page, border: `1px solid ${C.border}`, borderRadius: 6,
      fontSize: 11.5, fontWeight: 600, color: C.textSecondary, textDecoration: 'none',
    }}>
      <Icon path={ICONS.link} size={11} color={C.textMuted} /> {label}
    </a>
  )
}
