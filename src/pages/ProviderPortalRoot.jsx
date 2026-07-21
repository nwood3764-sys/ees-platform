// =============================================================================
// ProviderPortalRoot — the Service Provider Portal (mounted at /provider-portal).
//
// A purpose-built external surface for approved service providers
// (subcontractors). It reuses the LEAP design system (C tokens, navy sidebar,
// 54px topbar) but is its own component — it does not reuse the customer
// Project Portal's screens, which are built for property owners.
//
// Two things a provider does here:
//   1. Review a priced proposal EES issued (installed measures x payout rate)
//      and Accept or Decline it — their window into the work orders assigned
//      to them, grouped by project.
//   2. Track their invoices and payments (the payment section).
//
// All data comes from get_provider_portal_data() and is hard-scoped to the
// caller's own provider account server-side.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, hasSupabaseConfig } from '../lib/supabase'
import { C, STATUS_CFG } from '../data/constants'
import {
  fetchPortalUserSelf,
  fetchProviderPortalData,
  respondToProposal,
} from '../data/providerPortalService'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif'
const MONO = 'JetBrains Mono, ui-monospace, monospace'

const money = (n) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

// ─── Small primitives (inline-styled to match the LEAP portal shell) ─────────
function IconBolt({ size = 20, color = C.emerald }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  )
}
function Ico({ d, size = 18, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  )
}
const ICON = {
  work: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></>,
  pay: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
}

function StatusBadge({ label }) {
  const cfg = STATUS_CFG[label] || { bg: '#eef1f6', color: C.textSecondary, dot: C.textMuted }
  if (!label) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: cfg.bg, color: cfg.color, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: cfg.dot }} />
      {label}
    </span>
  )
}

function Centered({ children }) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, background: C.page, color: C.textSecondary, fontFamily: FONT, textAlign: 'center', padding: 24 }}>
      {children}
    </div>
  )
}
function SignOutLink({ onClick }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', color: C.sky, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
      Sign out
    </button>
  )
}

// ─── Login gate ──────────────────────────────────────────────────────────────
function LoginGate({ onSignedIn }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
      if (error) throw error
      onSignedIn()
    } catch (e2) {
      setErr(e2?.message || 'Unable to sign in.')
    } finally {
      setBusy(false)
    }
  }

  const field = { width: '100%', padding: '11px 12px', border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 14, fontFamily: FONT, marginTop: 6, boxSizing: 'border-box' }
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.sidebar, fontFamily: FONT }}>
      <form onSubmit={submit} style={{ background: C.card, borderRadius: 12, padding: 32, width: 380, maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <IconBolt /> <span style={{ fontWeight: 700, fontSize: 18, color: C.textPrimary }}>LEAP</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, marginTop: 14 }}>Service Provider Portal</div>
        <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4, marginBottom: 18 }}>Sign in to review and manage your work orders.</div>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary }}>Email
          <input style={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, display: 'block', marginTop: 14 }}>Password
          <input style={field} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </label>
        {err && <div style={{ color: C.sky, fontSize: 13, marginTop: 12 }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 20, padding: '11px 12px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ provider, view, setView, onSignOut, counts }) {
  const NavItem = ({ id, label, icon, badge }) => {
    const active = view === id
    return (
      <button onClick={() => setView(id)} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '10px 14px', background: active ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', borderLeft: `3px solid ${active ? C.emerald : 'transparent'}`, color: active ? C.navActive : C.navInactive, cursor: 'pointer', fontSize: 14, fontWeight: active ? 600 : 500, fontFamily: FONT }}>
        <Ico d={icon} color={active ? C.emerald : C.navInactive} />
        <span style={{ flex: 1 }}>{label}</span>
        {badge ? <span style={{ background: C.emerald, color: '#06231a', fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 7px' }}>{badge}</span> : null}
      </button>
    )
  }
  return (
    <div style={{ width: 240, minWidth: 240, background: C.sidebar, display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <IconBolt /><div><div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>LEAP</div><div style={{ color: C.navInactive, fontSize: 11 }}>Service Providers</div></div>
      </div>
      <div style={{ padding: '12px 0', flex: 1 }}>
        <NavItem id="work" label="Work Orders" icon={ICON.work} badge={counts.pending || 0} />
        <NavItem id="payments" label="Payments" icon={ICON.pay} />
      </div>
      <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ color: C.navActive, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{provider?.name || 'Service Provider'}</div>
        <button onClick={onSignOut} style={{ marginTop: 8, background: 'none', border: 'none', color: C.navInactive, cursor: 'pointer', fontSize: 12, padding: 0 }}>Sign out</button>
      </div>
    </div>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: '0 1px 2px rgba(13,26,46,0.04)', ...style }}>{children}</div>
}
function SectionHeader({ children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, margin: 0 }}>{children}</h2>
      {right}
    </div>
  )
}

// ─── Proposal card (review / accept / decline) ───────────────────────────────
function ProposalCard({ p, onAccept, onDecline, busy }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const isOpen = p.status_value === 'Proposal Issued'
  return (
    <Card style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{p.record_number}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, marginTop: 2 }}>{p.project_name || p.name || 'Proposal'}</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>{[p.property_name, p.state].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge label={p.status} />
          <div style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, marginTop: 8, fontFamily: MONO }}>{money(p.total_amount)}</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>total payout</div>
        </div>
      </div>

      {p.lines?.length > 0 && (
        <div style={{ marginTop: 14, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f7f9fc', color: C.textSecondary, textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Measure</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Qty</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Rate</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={l.id || i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 12px', color: C.textPrimary }}>{l.measure}{l.work_order_number ? <span style={{ color: C.textMuted, fontFamily: MONO, fontSize: 11 }}> · {l.work_order_number}</span> : null}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: MONO }}>{l.quantity}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: MONO }}>{money(l.unit_rate)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: MONO, fontWeight: 600 }}>{money(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.declined_reason && <div style={{ marginTop: 10, fontSize: 13, color: C.textSecondary }}>Declined: {p.declined_reason}</div>}

      {isOpen && !declining && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button disabled={busy} onClick={() => onAccept(p.id)} style={{ padding: '9px 18px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Accept</button>
          <button disabled={busy} onClick={() => setDeclining(true)} style={{ padding: '9px 18px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Decline</button>
        </div>
      )}
      {isOpen && declining && (
        <div style={{ marginTop: 14 }}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for declining (required)" rows={2} style={{ width: '100%', padding: 10, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontFamily: FONT, fontSize: 13, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button disabled={busy || !reason.trim()} onClick={() => onDecline(p.id, reason.trim())} style={{ padding: '9px 18px', background: C.sky, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'default', opacity: reason.trim() ? 1 : 0.6 }}>Submit decline</button>
            <button onClick={() => { setDeclining(false); setReason('') }} style={{ padding: '9px 18px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Work order card ─────────────────────────────────────────────────────────
function WorkOrderCard({ wo }) {
  return (
    <Card style={{ padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{wo.record_number}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, marginTop: 2 }}>{wo.name || wo.work_type}</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>{[wo.work_type, wo.building_name, wo.unit_name].filter(Boolean).join(' · ')}</div>
          {wo.scheduled_start_date && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Scheduled {fmtDate(wo.scheduled_start_date)}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge label={wo.acceptance_status || wo.status} />
          {wo.agreed_payout != null && <div style={{ fontFamily: MONO, fontWeight: 700, color: C.textPrimary, marginTop: 8 }}>{money(wo.agreed_payout)}</div>}
        </div>
      </div>
      {wo.special_instructions && <div style={{ marginTop: 10, fontSize: 13, color: C.textSecondary, background: '#f7f9fc', borderRadius: 6, padding: '8px 10px' }}>{wo.special_instructions}</div>}
    </Card>
  )
}

// ─── Invoice card ────────────────────────────────────────────────────────────
function InvoiceCard({ inv }) {
  return (
    <Card style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{inv.record_number}</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>Invoice date {fmtDate(inv.invoice_date)}{inv.due_date ? ` · due ${fmtDate(inv.due_date)}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StatusBadge label={inv.status} />
          <div style={{ fontSize: 18, fontWeight: 800, color: C.textPrimary, marginTop: 8, fontFamily: MONO }}>{money(inv.total_amount)}</div>
          {Number(inv.amount_paid) > 0 && <div style={{ fontSize: 12, color: C.textMuted }}>{money(inv.amount_paid)} paid</div>}
        </div>
      </div>
      {inv.lines?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {inv.lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderTop: i ? `1px solid ${C.border}` : 'none', color: C.textSecondary }}>
              <span>{l.description}{l.work_order_number ? <span style={{ fontFamily: MONO, fontSize: 11, color: C.textMuted }}> · {l.work_order_number}</span> : null}</span>
              <span style={{ fontFamily: MONO }}>{money(l.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {inv.payments?.length > 0 && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>Payments</div>
          {inv.payments.map((pay, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.textSecondary, padding: '3px 0' }}>
              <span>{fmtDate(pay.date)}{pay.method ? ` · ${pay.method}` : ''}{pay.status ? ` · ${pay.status}` : ''}</span>
              <span style={{ fontFamily: MONO }}>{money(pay.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Root ────────────────────────────────────────────────────────────────────
export default function ProviderPortalRoot() {
  const [phase, setPhase] = useState('loading') // loading | login | notportal | error | ready
  const [errMsg, setErrMsg] = useState('')
  const [self, setSelf] = useState(null)
  const [data, setData] = useState({ provider: null, proposals: [], workOrders: [], invoices: [] })
  const [view, setView] = useState('work')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const me = await fetchPortalUserSelf()
      if (!me) { setPhase('login'); return }
      if (me.record_type !== 'Provider User') {
        setPhase('notportal'); setErrMsg('This login is not set up as a service provider account.'); return
      }
      if (!['Portal User Active', 'Portal User Invited'].includes(me.status)) {
        setPhase('notportal'); setErrMsg('Your portal access is not active yet. Contact your EES coordinator.'); return
      }
      setSelf(me)
      const d = await fetchProviderPortalData()
      if (d.error === 'no_portal_user' || d.error === 'no_provider_account') {
        setPhase('notportal'); setErrMsg('This account is not linked to a service provider yet. Contact your EES coordinator.'); return
      }
      setData(d)
      setPhase('ready')
    } catch (e) {
      setErrMsg(e?.message || 'Failed to load the portal.'); setPhase('error')
    }
  }, [])

  useEffect(() => {
    if (!hasSupabaseConfig) { setPhase('error'); setErrMsg('Portal is not configured.'); return }
    load()
  }, [load])

  const signOut = async () => { await supabase.auth.signOut(); setSelf(null); setData({ provider: null, proposals: [], workOrders: [], invoices: [] }); setPhase('login') }

  const doAccept = async (id) => {
    setBusy(true); setToast('')
    try { await respondToProposal(id, true); setToast('Proposal accepted.'); await load() }
    catch (e) { setToast(e?.message || 'Could not accept.') }
    finally { setBusy(false); setView('work') }
  }
  const doDecline = async (id, reason) => {
    setBusy(true); setToast('')
    try { await respondToProposal(id, false, reason); setToast('Proposal declined.'); await load() }
    catch (e) { setToast(e?.message || 'Could not decline.') }
    finally { setBusy(false); setView('work') }
  }

  const openProposals = useMemo(() => data.proposals.filter((p) => p.status_value === 'Proposal Issued'), [data.proposals])
  const otherProposals = useMemo(() => data.proposals.filter((p) => p.status_value !== 'Proposal Issued'), [data.proposals])
  const woByProject = useMemo(() => {
    const groups = new Map()
    for (const wo of data.workOrders) {
      const key = wo.project_id || 'none'
      if (!groups.has(key)) groups.set(key, { name: wo.project_name || 'Unassigned', items: [] })
      groups.get(key).items.push(wo)
    }
    return [...groups.values()]
  }, [data.workOrders])

  if (phase === 'loading') return <Centered><IconBolt /><div>Loading your work orders…</div></Centered>
  if (phase === 'login') return <LoginGate onSignedIn={load} />
  if (phase === 'notportal') return <Centered><div style={{ maxWidth: 420 }}>{errMsg}</div><SignOutLink onClick={signOut} /></Centered>
  if (phase === 'error') return <Centered><div style={{ maxWidth: 420 }}>{errMsg || 'Something went wrong.'}</div><SignOutLink onClick={signOut} /></Centered>

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: FONT, background: C.page }}>
      <Sidebar provider={data.provider} view={view} setView={setView} onSignOut={signOut} counts={{ pending: openProposals.length }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ height: 54, minHeight: 54, background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{view === 'work' ? 'Work Orders' : 'Payments'}</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>{data.provider?.name}</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {toast && <div style={{ marginBottom: 16, background: '#e8f8f2', border: `1px solid ${C.emerald}`, color: '#1a7a4e', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{toast}</div>}

          {view === 'work' && (
            <div style={{ maxWidth: 860 }}>
              <SectionHeader right={<span style={{ fontSize: 12, color: C.textMuted }}>{openProposals.length} awaiting response</span>}>Proposals to Review</SectionHeader>
              {openProposals.length === 0
                ? <Card style={{ padding: 20, color: C.textMuted, fontSize: 14, marginBottom: 24 }}>No proposals awaiting your response.</Card>
                : openProposals.map((p) => <ProposalCard key={p.id} p={p} onAccept={doAccept} onDecline={doDecline} busy={busy} />)}

              <div style={{ marginTop: 20 }}>
                <SectionHeader>My Work Orders</SectionHeader>
                {woByProject.length === 0
                  ? <Card style={{ padding: 20, color: C.textMuted, fontSize: 14 }}>No work orders assigned yet.</Card>
                  : woByProject.map((g, i) => (
                    <div key={i} style={{ marginBottom: 18 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textSecondary, margin: '0 0 8px' }}>{g.name}</div>
                      {g.items.map((wo) => <WorkOrderCard key={wo.id} wo={wo} />)}
                    </div>
                  ))}
              </div>

              {otherProposals.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <SectionHeader>Past Proposals</SectionHeader>
                  {otherProposals.map((p) => <ProposalCard key={p.id} p={p} onAccept={doAccept} onDecline={doDecline} busy={busy} />)}
                </div>
              )}
            </div>
          )}

          {view === 'payments' && (
            <div style={{ maxWidth: 860 }}>
              <SectionHeader right={<span style={{ fontSize: 12, color: C.textMuted }}>{data.invoices.length} invoice{data.invoices.length === 1 ? '' : 's'}</span>}>Invoices & Payments</SectionHeader>
              {data.invoices.length === 0
                ? <Card style={{ padding: 20, color: C.textMuted, fontSize: 14 }}>No invoices yet. Invoices appear here once EES processes your completed work.</Card>
                : data.invoices.map((inv) => <InvoiceCard key={inv.id} inv={inv} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
