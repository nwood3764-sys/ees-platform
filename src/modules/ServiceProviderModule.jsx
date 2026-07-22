// =============================================================================
// ServiceProviderModule — internal review queue for subcontractor / service
// provider intake applications. Approve (activates the account + auto-invites
// the provider to the portal) or decline. Mounted at /m/providers.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { C } from '../data/constants'
import {
  fetchServiceProviderApplications,
  approveServiceProviderApplication,
  declineServiceProviderApplication,
} from '../data/serviceProviderService'

const MONO = 'JetBrains Mono, ui-monospace, monospace'
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

const STAGE_STYLE = {
  'Application Submitted':                { bg: '#e8f1fb', color: '#1e466b' },
  'Application Under Review':             { bg: '#e8f3fb', color: '#1a5a8a' },
  'Application Additional Info Requested':{ bg: '#e8f3fb', color: '#1a5a8a' },
  'Application Approved':                 { bg: '#e8f8f2', color: '#1a7a4e' },
  'Application Declined':                 { bg: '#eef1f6', color: '#4a5e7a' },
}

function Chip({ label }) {
  const s = STAGE_STYLE[label] || { bg: '#eef1f6', color: C.textSecondary }
  return <span style={{ background: s.bg, color: s.color, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{label || '—'}</span>
}

function ApplicationCard({ app, busy, onApprove, onDecline }) {
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)
  const stage = app.stage?.picklist_value
  const isPending = stage === 'Application Submitted' || stage === 'Application Under Review' || stage === 'Application Additional Info Requested'
  const contact = [app.spa_contact_first_name, app.spa_contact_last_name].filter(Boolean).join(' ')
  const email = app.spa_contact_email || app.spa_business_email

  const row = (k, v) => v ? <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}><span style={{ color: C.textMuted, minWidth: 150 }}>{k}</span><span style={{ color: C.textPrimary }}>{v}</span></div> : null

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, marginBottom: 12, boxShadow: '0 1px 2px rgba(13,26,46,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{app.spa_record_number}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginTop: 2 }}>{app.spa_company_legal_name}</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 3 }}>
            {[app.trade?.picklist_label, app.spa_home_state, contact].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            Submitted {fmtDate(app.spa_submitted_at)} · {app.spa_source || 'Manual Entry'}
            {app.spa_w9_document_id ? ' · W-9 on file' : ' · no W-9'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <Chip label={app.stage?.picklist_label} />
          {app.account?.account_service_provider_is_active && <span style={{ fontSize: 11, color: '#1a7a4e' }}>Account active</span>}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {row('Contact', [contact, app.spa_contact_title].filter(Boolean).join(', '))}
          {row('Email', email)}
          {row('Phone', app.spa_contact_phone || app.spa_business_phone)}
          {row('Website', app.spa_website)}
          {row('Entity type', app.spa_entity_type)}
          {row('License', [app.spa_license_number, app.spa_license_type, app.spa_license_state].filter(Boolean).join(' · '))}
          {row('License expires', app.spa_license_expiration_date ? fmtDate(app.spa_license_expiration_date) : null)}
          {row('GL carrier', app.spa_general_liability_carrier)}
          {row("Workers' comp", app.spa_workers_comp_carrier)}
          {row('Notes', app.spa_notes)}
          {app.spa_declined_reason && row('Declined reason', app.spa_declined_reason)}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: C.sky, cursor: 'pointer', fontSize: 13, padding: 0 }}>
          {open ? 'Hide details' : 'View details'}
        </button>
        <div style={{ flex: 1 }} />
        {isPending && !declining && (
          <>
            <button disabled={busy} onClick={() => onApprove(app)} style={{ padding: '8px 16px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              Approve &amp; invite
            </button>
            <button disabled={busy} onClick={() => setDeclining(true)} style={{ padding: '8px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Decline
            </button>
          </>
        )}
      </div>

      {isPending && declining && (
        <div style={{ marginTop: 12 }}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for declining (required)" style={{ width: '100%', padding: 10, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button disabled={busy || !reason.trim()} onClick={() => onDecline(app, reason.trim())} style={{ padding: '8px 16px', background: C.sky, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'default', opacity: reason.trim() ? 1 : 0.6 }}>Submit decline</button>
            <button onClick={() => { setDeclining(false); setReason('') }} style={{ padding: '8px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ServiceProviderModule() {
  const [apps, setApps] = useState(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('pending') // pending | all

  const load = useCallback(async () => {
    setErr('')
    try { setApps(await fetchServiceProviderApplications()) }
    catch (e) { setErr(e?.message || 'Failed to load applications.'); setApps([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const onApprove = async (app) => {
    setBusyId(app.id); setToast('')
    try {
      const r = await approveServiceProviderApplication(app.id)
      setToast(r?.invited ? `Approved — invite sent to ${r.email}.` : `Approved. ${r?.note || ''}`)
      await load()
    } catch (e) { setToast(e?.message || 'Approval failed.') }
    finally { setBusyId(null) }
  }
  const onDecline = async (app, reason) => {
    setBusyId(app.id); setToast('')
    try { await declineServiceProviderApplication(app.id, reason); setToast('Application declined.'); await load() }
    catch (e) { setToast(e?.message || 'Decline failed.') }
    finally { setBusyId(null) }
  }

  const shown = useMemo(() => {
    if (!apps) return []
    if (filter === 'all') return apps
    const pend = new Set(['Application Submitted', 'Application Under Review', 'Application Additional Info Requested'])
    return apps.filter((a) => pend.has(a.stage?.picklist_value))
  }, [apps, filter])
  const pendingCount = useMemo(() => (apps || []).filter((a) => ['Application Submitted', 'Application Under Review', 'Application Additional Info Requested'].includes(a.stage?.picklist_value)).length, [apps])

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: 0 }}>Service Provider Applications</h1>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Review subcontractor signups. Approving activates the account and emails the provider a portal invite.</div>
        </div>
        <div style={{ display: 'flex', gap: 6, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 3 }}>
          {[['pending', `Pending (${pendingCount})`], ['all', 'All']].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ padding: '6px 12px', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: filter === k ? C.emerald : 'transparent', color: filter === k ? '#06231a' : C.textSecondary }}>{l}</button>
          ))}
        </div>
      </div>

      {toast && <div style={{ marginTop: 16, background: '#e8f8f2', border: `1px solid ${C.emerald}`, color: '#1a7a4e', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{toast}</div>}
      {err && <div style={{ marginTop: 16, background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

      <div style={{ marginTop: 18 }}>
        {apps === null ? <div style={{ color: C.textMuted, fontSize: 14 }}>Loading…</div>
          : shown.length === 0 ? <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 22, color: C.textMuted, fontSize: 14 }}>{filter === 'pending' ? 'No applications awaiting review.' : 'No applications yet.'}</div>
          : shown.map((app) => <ApplicationCard key={app.id} app={app} busy={busyId === app.id} onApprove={onApprove} onDecline={onDecline} />)}
      </div>
    </div>
  )
}
