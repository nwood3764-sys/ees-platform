// =============================================================================
// ProjectPortalRoot — customer-facing Project Portal
//
// Mounted at /project-portal (and /project-portal/*) via path-based routing in
// main.jsx. Stands alone — no staff sidebar/topbar chrome. A property owner or
// property manager signs in with Supabase Auth; their portal_users row
// (linked by auth_user_id) plus their explicit grants in
// portal_user_property_grants determine what they see. The tree comes from the
// get_portal_project_tracker() RPC.
//
// Navigation mirrors the approved demo:
//   1. Property dashboard — portfolio stats + per-building progress cards
//   2. Building detail     — unit/opportunity stage cards + opportunity table
//   3. Opportunity stage   — 10-phase stage bar (stageOrder / 10 * 100)
//
// Program colors follow the platform palette (no red/orange anywhere):
//   HOMES → emerald (#3ecf8e), HEAR → sky (#7eb3e8).
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C } from '../data/constants'
import {
  fetchPortalUserSelf,
  fetchProjectTracker,
  opportunityPct,
  rollupOpportunities,
  allOpportunities,
  TOTAL_PHASES,
} from '../data/projectPortalService'

// Canonical 10-phase labels for the stage bar dots (index 1..10). These match
// the per-record-type opportunity stage lifecycles authored for MF-HOMES and
// MF-HEAR; the portal shows the short phase label under each dot.
const PHASE_SHORT = [
  '',                       // 0 — not started (no dot label)
  'Income Qualification',
  'Energy Assessment',
  'Energy Modeling',
  'Project Reservation',
  'Project Planning',
  'Implementation',
  'Commissioning',
  'Payment Request',
  'Final Inspection',
  'Payment Issued',
]

// HOMES vs HEAR accent. Program label contains 'HEAR' or 'HOMES'.
function programAccent(program) {
  if (program && /HEAR/i.test(program)) return C.sky
  return C.emerald
}
function programTag(program) {
  if (program && /HEAR/i.test(program)) return 'HEAR'
  if (program && /HOMES/i.test(program)) return 'HOMES'
  return program || 'Program'
}

// ─── SVG icons (1.5px stroke, no fill) ───────────────────────────────────────
const Icon = ({ d, size = 18, stroke = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke}
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const IconBolt = <Icon d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />} />
const IconHome = <Icon d={<><path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1H5a1 1 0 01-1-1V10.5z" /><path d="M9 22V12h6v10" /></>} />
const IconCheck = <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-5" /></>} />
const IconChevL = <Icon d={<polyline points="15 18 9 12 15 6" />} />

// ─── Stage bar (10 dots; matches demo stage/10*100) ──────────────────────────
function StageBar({ stageOrder, accent }) {
  const pct = opportunityPct(stageOrder)
  return (
    <div style={{ margin: '6px 0 2px' }}>
      <div style={{
        position: 'relative', height: 4, background: C.border,
        borderRadius: 10, marginBottom: 18,
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${pct}%`, background: accent, borderRadius: 10,
          transition: 'width .25s ease',
        }} />
        <div style={{
          position: 'absolute', top: -7, left: 0, right: 0,
          display: 'flex', justifyContent: 'space-between',
        }}>
          {Array.from({ length: TOTAL_PHASES }, (_, i) => {
            const phase = i + 1
            const done = stageOrder >= phase
            const current = stageOrder === phase
            return (
              <div key={phase} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 18 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: done ? accent : C.card,
                  border: `2px solid ${done ? accent : C.borderDark}`,
                  color: done ? '#fff' : C.textMuted,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700,
                  boxShadow: current ? `0 0 0 3px ${accent}33` : 'none',
                }}>
                  {done ? '✓' : phase}
                </div>
                <div style={{
                  fontSize: 8.5, color: current ? C.textPrimary : C.textMuted,
                  fontWeight: current ? 700 : 500, marginTop: 4, textAlign: 'center',
                  width: 56, lineHeight: 1.15,
                }}>
                  {PHASE_SHORT[phase]}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Stat pill ───────────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || C.textPrimary }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>{label}</div>
    </div>
  )
}

// ─── Login gate (portal users authenticate with Supabase Auth) ───────────────
function LoginGate({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) { setErr('Sign-in failed. Check your email and password.'); return }
    onSignedIn()
  }

  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, boxShadow: '0 1px 3px rgba(13,26,46,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <div style={{ width: 30, height: 30, background: C.emerald, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{IconBolt}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>Project Portal</div>
            <div style={{ fontSize: 11, color: C.textMuted }}>Energy Efficiency Services of Wisconsin</div>
          </div>
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="username"
          style={{ width: '100%', margin: '4px 0 12px', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13, outline: 'none' }} />
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Password</label>
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ width: '100%', margin: '4px 0 16px', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13, outline: 'none' }} />
        {err && <div style={{ fontSize: 12, color: C.sky, marginBottom: 12 }}>{err}</div>}
        <button onClick={submit} disabled={busy}
          style={{ width: '100%', padding: '10px', background: C.emerald, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  )
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({ crumb, onCrumbClick, userName, onSignOut }) {
  return (
    <div style={{ background: C.card, borderBottom: `1px solid ${C.border}`, height: 54, display: 'flex', alignItems: 'center', padding: '0 20px', position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ width: 26, height: 26, background: C.emerald, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{IconBolt}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>Project Portal</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 18, fontSize: 12.5, color: C.textSecondary }}>
        {crumb.map((c, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: C.textMuted }}>/</span>}
            <span onClick={() => c.onClick && onCrumbClick(c)} style={{ cursor: c.onClick ? 'pointer' : 'default', color: c.onClick ? C.textSecondary : C.textPrimary, fontWeight: c.onClick ? 500 : 700 }}>{c.label}</span>
          </span>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 12.5, color: C.textSecondary }}>{userName}</span>
        <button onClick={onSignOut} style={{ fontSize: 12, color: C.textSecondary, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 10px', cursor: 'pointer' }}>Sign Out</button>
      </div>
    </div>
  )
}

// ─── Property dashboard ──────────────────────────────────────────────────────
function PropertyDashboard({ property, onOpenBuilding }) {
  const opps = allOpportunities(property)
  const homes = opps.filter((o) => programTag(o.program) === 'HOMES')
  const hear = opps.filter((o) => programTag(o.program) === 'HEAR')
  const r = rollupOpportunities(opps)

  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ background: C.sidebar, borderRadius: 12, padding: '20px 24px', color: '#fff', marginBottom: 18 }}>
        <div style={{ fontSize: 19, fontWeight: 700 }}>{property.name}</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.7)', marginTop: 3 }}>
          {[property.city, property.state].filter(Boolean).join(', ')}
          {property.totalUnits != null && ` · ${property.totalUnits} units`}
          {property.totalBuildings != null && ` · ${property.totalBuildings} buildings`}
        </div>
        <div style={{ display: 'flex', gap: 28, marginTop: 16 }}>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: C.emerald }}>{r.complete}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>Complete</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: C.sky }}>{r.inProgress}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>In Progress</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,.55)' }}>{r.notStarted}</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>Not Started</div></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 22 }}>
        <Stat label="Total Opportunities" value={r.total} />
        <Stat label="HOMES Opportunities" value={homes.length} color={C.emerald} />
        <Stat label="HEAR Opportunities" value={hear.length} color={C.sky} />
        <Stat label="Buildings" value={(property.buildings || []).length} />
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textPrimary, marginBottom: 10 }}>Buildings</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
        {(property.buildings || []).map((b) => {
          const bo = b.opportunities || []
          const br = rollupOpportunities(bo)
          const avgPct = bo.length ? Math.round(bo.reduce((s, o) => s + opportunityPct(o.stageOrder), 0) / bo.length) : 0
          return (
            <div key={b.id} onClick={() => onOpenBuilding(b)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: C.emerald }}>{IconHome}</span>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.textPrimary }}>{b.name}</div>
              </div>
              {b.address && <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 8 }}>{b.address}{b.totalUnits != null ? ` · ${b.totalUnits} units` : ''}</div>}
              <div style={{ height: 4, background: C.border, borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: `${avgPct}%`, background: C.emerald }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.textSecondary }}>
                <span>{bo.length} opportunit{bo.length === 1 ? 'y' : 'ies'}</span>
                <span>{br.complete} complete</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Building detail ─────────────────────────────────────────────────────────
function BuildingDetail({ building, onOpenOpportunity }) {
  const bo = building.opportunities || []
  const r = rollupOpportunities(bo)
  return (
    <div style={{ padding: 22, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>{building.name}</div>
      <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 16 }}>{building.address}{building.totalUnits != null ? ` · ${building.totalUnits} units` : ''}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 20 }}>
        <Stat label="Opportunities" value={r.total} />
        <Stat label="Complete" value={r.complete} color={C.emerald} />
        <Stat label="In Progress" value={r.inProgress} color={C.sky} />
        <Stat label="Not Started" value={r.notStarted} color={C.textMuted} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12 }}>
        {bo.map((o) => {
          const accent = programAccent(o.program)
          return (
            <div key={o.id} onClick={() => onOpenOpportunity(o)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: accent, background: `${accent}1a`, padding: '2px 8px', borderRadius: 5 }}>{programTag(o.program)}</span>
                <span style={{ fontSize: 11, color: C.textMuted, fontFamily: 'monospace' }}>{o.recordNumber}</span>
              </div>
              <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 8 }}>{o.stageLabel}</div>
              <div style={{ height: 4, background: C.border, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${opportunityPct(o.stageOrder)}%`, background: accent }} />
              </div>
            </div>
          )
        })}
        {bo.length === 0 && <div style={{ fontSize: 12.5, color: C.textMuted }}>No opportunities for this building yet.</div>}
      </div>
    </div>
  )
}

// ─── Opportunity stage view ──────────────────────────────────────────────────
function OpportunityDetail({ opportunity }) {
  const accent = programAccent(opportunity.program)
  return (
    <div style={{ padding: 22, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: accent, background: `${accent}1a`, padding: '3px 9px', borderRadius: 5 }}>{programTag(opportunity.program)}</span>
        <span style={{ fontSize: 11.5, color: C.textMuted, fontFamily: 'monospace' }}>{opportunity.recordNumber}</span>
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: C.textPrimary, marginBottom: 2 }}>{opportunity.name}</div>
      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 22 }}>Current stage: <strong>{opportunity.stageLabel}</strong></div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '26px 26px 18px' }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textPrimary, marginBottom: 18 }}>Program Progress</div>
        <StageBar stageOrder={opportunity.stageOrder} accent={accent} />
        <div style={{ marginTop: 34, fontSize: 12, color: C.textSecondary }}>
          {opportunity.stageOrder >= TOTAL_PHASES
            ? 'All program phases are complete.'
            : opportunity.stageOrder > 0
              ? `Phase ${opportunity.stageOrder} of ${TOTAL_PHASES} — ${opportunityPct(opportunity.stageOrder)}% through the program lifecycle.`
              : 'This opportunity has not started its program lifecycle yet.'}
        </div>
      </div>
    </div>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function ProjectPortalRoot() {
  const [phase, setPhase] = useState('loading')      // loading | login | ready | error | notportal
  const [self, setSelf] = useState(null)
  const [tree, setTree] = useState([])
  const [view, setView] = useState({ screen: 'dashboard', propertyId: null, buildingId: null, opportunityId: null })
  const [errMsg, setErrMsg] = useState(null)

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const me = await fetchPortalUserSelf()
      if (!me) { setPhase('login'); return }
      if (me.status !== 'Active') { setPhase('notportal'); setErrMsg('Your portal access is not active. Contact your project coordinator.'); return }
      setSelf(me)
      const t = await fetchProjectTracker()
      if (t.error === 'no_portal_user') { setPhase('notportal'); setErrMsg('This account is not set up as a portal user.'); return }
      setTree(t.properties || [])
      // Land on the first property if there's exactly one (the common case).
      const first = (t.properties || [])[0]
      setView({ screen: 'dashboard', propertyId: first ? first.id : null, buildingId: null, opportunityId: null })
      setPhase('ready')
    } catch (e) {
      setErrMsg(e?.message || 'Failed to load the portal.')
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig) { setPhase('error'); setErrMsg('Portal is not configured.'); return }
    load()
  }, [load])

  const signOut = async () => { await supabase.auth.signOut(); setSelf(null); setTree([]); setPhase('login') }

  if (phase === 'loading') return <Centered>Loading your projects…</Centered>
  if (phase === 'login') return <LoginGate onSignedIn={load} />
  if (phase === 'notportal') return <Centered>{errMsg}<SignOutLink onClick={signOut} /></Centered>
  if (phase === 'error') return <Centered>{errMsg || 'Something went wrong.'}<SignOutLink onClick={signOut} /></Centered>

  // Resolve current selections.
  const property = tree.find((p) => p.id === view.propertyId) || tree[0] || null
  const building = property && view.buildingId ? (property.buildings || []).find((b) => b.id === view.buildingId) : null
  const opportunity = building && view.opportunityId ? (building.opportunities || []).find((o) => o.id === view.opportunityId) : null

  // Breadcrumb
  const crumb = [{ label: 'Properties', onClick: tree.length > 1 ? () => setView({ screen: 'properties' }) : null }]
  if (property) crumb.push({ label: property.name, onClick: (building || opportunity) ? () => setView({ screen: 'dashboard', propertyId: property.id }) : null })
  if (building) crumb.push({ label: building.name, onClick: opportunity ? () => setView({ screen: 'building', propertyId: property.id, buildingId: building.id }) : null })
  if (opportunity) crumb.push({ label: programTag(opportunity.program), onClick: null })

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <TopBar crumb={crumb} onCrumbClick={(c) => c.onClick && c.onClick()} userName={self?.full_name || ''} onSignOut={signOut} />

      {view.screen === 'properties' && tree.length > 1 && (
        <div style={{ padding: 22, maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginBottom: 12 }}>Your Properties</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
            {tree.map((p) => (
              <div key={p.id} onClick={() => setView({ screen: 'dashboard', propertyId: p.id })} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '16px', cursor: 'pointer' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{p.name}</div>
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>{[p.city, p.state].filter(Boolean).join(', ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.screen === 'dashboard' && property && (
        <PropertyDashboard property={property} onOpenBuilding={(b) => setView({ screen: 'building', propertyId: property.id, buildingId: b.id })} />
      )}
      {view.screen === 'building' && building && (
        <BuildingDetail building={building} onOpenOpportunity={(o) => setView({ screen: 'opportunity', propertyId: property.id, buildingId: building.id, opportunityId: o.id })} />
      )}
      {view.screen === 'opportunity' && opportunity && (
        <OpportunityDetail opportunity={opportunity} />
      )}

      {view.screen === 'dashboard' && !property && (
        <Centered>You don't have any properties assigned yet. Contact your project coordinator.</Centered>
      )}
    </div>
  )
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, fontFamily: 'Inter, system-ui, sans-serif', color: C.textSecondary, fontSize: 13.5, textAlign: 'center' }}>
      {children}
    </div>
  )
}
function SignOutLink({ onClick }) {
  return <button onClick={onClick} style={{ fontSize: 12.5, color: C.sky, background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Sign out</button>
}
