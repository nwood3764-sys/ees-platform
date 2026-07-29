// =============================================================================
// ServiceProviderModule — onboarding pipeline for subcontractors / service
// providers. A dashboard of application stages (counts + click-to-filter) over
// a review list. Each application can be read in full (documents included),
// moved through the pipeline (Submitted → Under Review → Info Requested →
// Interview → Onboarding → Training → Approved), have clarification requested,
// be declined with a reason, or approved (which activates the account and
// emails the provider a portal invite). Mounted at /m/providers.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { C } from '../data/constants'
import {
  fetchServiceProviderApplications,
  approveWithoutInvite,
  sendPortalInvite,
  declineServiceProviderApplication,
  advanceApplication,
  createManualApplication,
  getDocumentSignedUrl,
  fetchApplicationActivities,
  logApplicationActivity,
} from '../data/serviceProviderService'

const TRADE_OPTS = [
  { v: 'hvac', l: 'HVAC' }, { v: 'electrical', l: 'Electrical' }, { v: 'weatherization', l: 'Weatherization' },
  { v: 'plumbing', l: 'Plumbing' }, { v: 'general_contractor', l: 'General Contractor' },
]
const STATE_OPTS = ['NC', 'WI', 'MI', 'CO', 'IN']

const MONO = 'JetBrains Mono, ui-monospace, monospace'
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')

// Activity-type accent (kept within the LEAP palette — no red/orange).
const ACT_TONE = { Email: '#7eb3e8', Call: '#2aab72', Meeting: '#1e466b', 'Site Visit': '#1e466b', 'Text Message': '#2aab72', Note: '#8fa0b8', Other: '#8fa0b8' }

// The pipeline, in order. `tone` maps to a chip/accent color (no red/orange).
const STAGE_FLOW = [
  { v: 'Application Submitted',                 label: 'New',            tone: '#7eb3e8' },
  { v: 'Application Under Review',              label: 'Under Review',   tone: '#7eb3e8' },
  { v: 'Application Additional Info Requested', label: 'Info Requested', tone: '#1e466b' },
  { v: 'Application Interview',                 label: 'Interview',      tone: '#1e466b' },
  { v: 'Application Onboarding',                label: 'Onboarding',     tone: '#1e466b' },
  { v: 'Application Training',                  label: 'Training',       tone: '#1e466b' },
  { v: 'Application Approved',                  label: 'Approved',       tone: '#2aab72' },
  { v: 'Application Declined',                  label: 'Declined',       tone: '#8fa0b8' },
]
const STAGE_BY_VALUE = Object.fromEntries(STAGE_FLOW.map((s) => [s.v, s]))
const TERMINAL = new Set(['Application Approved', 'Application Declined'])

function StageChip({ value, label }) {
  const s = STAGE_BY_VALUE[value]
  const tone = s?.tone || '#8fa0b8'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: tone + '22', color: tone === '#7eb3e8' ? '#1a5a8a' : tone, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone }} />
      {label || value}
    </span>
  )
}

function ApplicationCard({ app, busy, onAdvance, onRequestInfo, onDecline, onApprove, onInvite }) {
  const [open, setOpen] = useState(false)
  const [w9Busy, setW9Busy] = useState(false)
  const [panel, setPanel] = useState(null) // 'info' | 'decline' | null
  const [note, setNote] = useState('')
  const [acts, setActs] = useState(null)
  const [logType, setLogType] = useState('Note')
  const [logText, setLogText] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const stageVal = app.stage?.picklist_value
  const contact = [app.spa_contact_first_name, app.spa_contact_last_name].filter(Boolean).join(' ')
  const email = app.spa_contact_email || app.spa_business_email
  const declined = stageVal === 'Application Declined'
  const approved = stageVal === 'Application Approved' || app.account?.account_service_provider_is_active

  const openW9 = async () => {
    setW9Busy(true)
    try {
      const url = await getDocumentSignedUrl(app.spa_w9_document_id)
      if (url) window.open(url, '_blank', 'noopener'); else alert('The W-9 file could not be found.')
    } catch (e) { alert(e?.message || 'Could not open the W-9.') } finally { setW9Busy(false) }
  }

  // Communication trail — load lazily when the card is expanded, and refresh
  // after any parent pipeline action (busy true → false) so logged movements
  // (approve/decline/request-info/move) appear without a full remount.
  const loadActs = useCallback(async () => {
    try { setActs(await fetchApplicationActivities(app.id)) } catch { setActs([]) }
  }, [app.id])
  useEffect(() => { if (open && acts === null) loadActs() }, [open, acts, loadActs])
  const prevBusy = useRef(false)
  useEffect(() => {
    if (prevBusy.current && !busy && open) loadActs()
    prevBusy.current = busy
  }, [busy, open, loadActs])

  const addLog = async () => {
    const body = logText.trim(); if (!body) return
    setLogBusy(true)
    try {
      await logApplicationActivity(app.id, { activityType: logType, subject: `${logType} logged`, body })
      setLogText(''); await loadActs()
    } catch (e) { alert(e?.message || 'Could not save the entry.') } finally { setLogBusy(false) }
  }

  const row = (k, v) => v ? <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}><span style={{ color: C.textMuted, minWidth: 150 }}>{k}</span><span style={{ color: C.textPrimary }}>{v}</span></div> : null
  const btn = (label, onClick, kind = 'ghost') => {
    const styles = {
      primary: { background: C.emerald, color: '#06231a', border: 'none' },
      ghost: { background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}` },
      sky: { background: '#eef6ff', color: '#1a5a8a', border: `1px solid ${C.sky}` },
    }[kind]
    return <button disabled={busy} onClick={onClick} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, ...styles }}>{label}</button>
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 18, marginBottom: 12, boxShadow: '0 1px 2px rgba(13,26,46,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.textMuted }}>{app.spa_record_number}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, marginTop: 2 }}>{app.spa_company_legal_name}</div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 3 }}>{[app.trade?.picklist_label, app.spa_home_state, contact].filter(Boolean).join(' · ')}</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>Submitted {fmtDate(app.spa_submitted_at)} · {app.spa_source || 'Manual Entry'}{app.spa_w9_document_id ? ' · W-9 on file' : ' · no W-9'}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <StageChip value={stageVal} label={app.stage?.picklist_label} />
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
          {row('Applicant notes', app.spa_notes)}
          {row('Review notes', app.spa_decision_notes)}
          {row('Declined reason', app.spa_declined_reason)}
          <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 0 0', alignItems: 'center' }}>
            <span style={{ color: C.textMuted, minWidth: 150 }}>Documents</span>
            {app.spa_w9_document_id
              ? <button onClick={openW9} disabled={w9Busy} style={{ background: '#eef6ff', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 6, padding: '4px 12px', fontSize: 12.5, fontWeight: 600, cursor: w9Busy ? 'default' : 'pointer' }}>{w9Busy ? 'Opening…' : 'View W-9'}</button>
              : <span style={{ color: C.textMuted }}>No W-9 uploaded — request it before approving.</span>}
          </div>

          {/* communication trail */}
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, marginBottom: 8, letterSpacing: 0.2 }}>COMMUNICATION</div>

            {/* add entry */}
            <div style={{ background: '#f7f9fc', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <select value={logType} onChange={(e) => setLogType(e.target.value)} style={{ padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.borderDark}`, fontSize: 12.5, background: '#fff', color: C.textPrimary, cursor: 'pointer' }}>
                  {['Note', 'Call', 'Email', 'Meeting', 'Text Message', 'Site Visit', 'Other'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span style={{ fontSize: 11.5, color: C.textMuted }}>Log an interaction or leave an internal note.</span>
              </div>
              <textarea value={logText} onChange={(e) => setLogText(e.target.value)} rows={2} placeholder="What happened? (e.g. Called the owner to confirm license — left voicemail.)"
                style={{ width: '100%', padding: 9, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }} />
              <div style={{ marginTop: 6 }}>
                <button disabled={logBusy || !logText.trim()} onClick={addLog}
                  style={{ padding: '7px 14px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: logText.trim() ? 'pointer' : 'default', opacity: (logBusy || !logText.trim()) ? 0.6 : 1 }}>
                  {logBusy ? 'Saving…' : 'Add to log'}
                </button>
              </div>
            </div>

            {/* timeline */}
            <div style={{ marginTop: 10 }}>
              {acts === null ? <div style={{ fontSize: 12.5, color: C.textMuted }}>Loading history…</div>
                : acts.length === 0 ? <div style={{ fontSize: 12.5, color: C.textMuted }}>No communication logged yet.</div>
                : acts.map((a) => {
                  const tone = ACT_TONE[a.activity_type] || C.textMuted
                  return (
                    <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.border}` }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: tone, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: tone }}>{a.activity_type}</span>
                          {a.subject && <span style={{ fontSize: 12.5, color: C.textPrimary, fontWeight: 600 }}>{a.subject}</span>}
                          <span style={{ flex: 1 }} />
                          <span style={{ fontSize: 11.5, color: C.textMuted, whiteSpace: 'nowrap' }}>{fmtDateTime(a.performed_at)}</span>
                        </div>
                        {a.body && <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
                        {a.performed_by_name && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{a.performed_by_name}</div>}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      {/* action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', color: C.sky, cursor: 'pointer', fontSize: 13, padding: 0 }}>{open ? 'Hide details' : 'View details'}</button>
        <div style={{ flex: 1 }} />
        {declined ? (
          btn('Reopen', () => onAdvance(app, 'Application Under Review'), 'ghost')
        ) : (
          <>
            <label style={{ fontSize: 12, color: C.textMuted }}>Move to</label>
            <select disabled={busy} value="" onChange={(e) => { if (e.target.value) onAdvance(app, e.target.value) }}
              style={{ padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.borderDark}`, fontSize: 12.5, color: C.textPrimary, background: '#fff', cursor: 'pointer' }}>
              <option value="">Stage…</option>
              {STAGE_FLOW.filter((s) => !TERMINAL.has(s.v) && s.v !== stageVal).map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            {btn('Request info', () => { setPanel(panel === 'info' ? null : 'info'); setNote('') }, 'sky')}
            {btn('Decline', () => { setPanel(panel === 'decline' ? null : 'decline'); setNote('') }, 'ghost')}
            {approved
              ? btn('Send portal invite', () => onInvite(app), 'primary')
              : btn('Approve', () => onApprove(app), 'primary')}
          </>
        )}
      </div>

      {panel && !declined && (
        <div style={{ marginTop: 12, background: '#f7f9fc', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.textSecondary, marginBottom: 6 }}>
            {panel === 'info' ? 'What do you need from the applicant?' : 'Reason for declining'}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={panel === 'info' ? 'e.g. Please upload a current W-9 and proof of insurance.' : 'Reason (recorded on the application)'} style={{ width: '100%', padding: 10, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button disabled={busy || !note.trim()} onClick={() => { (panel === 'info' ? onRequestInfo : onDecline)(app, note.trim()); setPanel(null); setNote('') }}
              style={{ padding: '8px 16px', background: panel === 'info' ? C.sky : '#fff', color: panel === 'info' ? '#06231a' : C.textSecondary, border: panel === 'info' ? 'none' : `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: note.trim() ? 'pointer' : 'default', opacity: note.trim() ? 1 : 0.6 }}>
              {panel === 'info' ? 'Mark info requested' : 'Submit decline'}
            </button>
            <button onClick={() => { setPanel(null); setNote('') }} style={{ padding: '8px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function NewApplicationModal({ onClose, onCreated }) {
  const [v, setV] = useState({ company: '', firstName: '', lastName: '', email: '', phone: '', trade: 'hvac', state: 'NC' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }))
  const inp = { width: '100%', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', color: C.textPrimary }
  const lab = { fontSize: 11.5, fontWeight: 600, color: C.textSecondary, display: 'block', marginBottom: 5 }
  const submit = async () => {
    if (!v.company.trim()) { setErr('Company name is required.'); return }
    setBusy(true); setErr('')
    try {
      const r = await createManualApplication(v)
      onCreated?.(`Application ${r?.application_number || ''} created.`.trim())
    } catch (e) { setErr(e?.message || 'Could not create the application.'); setBusy(false) }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 12, width: 520, maxWidth: '94vw', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Start a provider application</div>
          <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2 }}>For a provider you're recruiting. It enters the pipeline as a new application (inactive account) you can then work through onboarding.</div>
        </div>
        <div style={{ padding: 18, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {err && <div style={{ flex: '1 1 100%', background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 7, padding: '8px 12px', fontSize: 13 }}>{err}</div>}
          <div style={{ flex: '1 1 100%' }}><label style={lab}>Company legal name *</label><input style={inp} value={v.company} onChange={set('company')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Contact first name</label><input style={inp} value={v.firstName} onChange={set('firstName')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Contact last name</label><input style={inp} value={v.lastName} onChange={set('lastName')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Email</label><input style={inp} type="email" value={v.email} onChange={set('email')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Phone</label><input style={inp} value={v.phone} onChange={set('phone')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Trade</label><select style={inp} value={v.trade} onChange={set('trade')}>{TRADE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>State</label><select style={inp} value={v.state} onChange={set('state')}>{STATE_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !v.company.trim()} style={{ padding: '9px 18px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !v.company.trim()) ? 0.6 : 1 }}>{busy ? 'Creating…' : 'Create application'}</button>
        </div>
      </div>
    </div>
  )
}

export default function ServiceProviderModule() {
  const [apps, setApps] = useState(null)
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('__pending') // stage value | '__pending' | '__all'
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try { setApps(await fetchServiceProviderApplications()) }
    catch (e) { setErr(e?.message || 'Failed to load applications.'); setApps([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (app, fn, msg) => {
    setBusyId(app.id); setToast('')
    try { const r = await fn(); setToast(typeof msg === 'function' ? msg(r) : msg); await load() }
    catch (e) { setToast(e?.message || 'Action failed.') }
    finally { setBusyId(null) }
  }
  // Each pipeline action records a communication-trail entry so the whole
  // onboarding history (moves, info requests, decisions, invites) is auditable.
  const logMove = (app, subject, body) => logApplicationActivity(app.id, { activityType: 'Note', subject, body }).catch(() => {})
  const onAdvance = (app, stage) => act(app, async () => {
    const r = await advanceApplication(app.id, stage)
    await logMove(app, `Moved to ${STAGE_BY_VALUE[stage]?.label || stage}`, null)
    return r
  }, `Moved to ${STAGE_BY_VALUE[stage]?.label || stage}.`)
  const onRequestInfo = (app, note) => act(app, async () => {
    const r = await advanceApplication(app.id, 'Application Additional Info Requested', note)
    await logMove(app, 'Information requested from applicant', note)
    return r
  }, 'Marked as information requested.')
  const onDecline = (app, reason) => act(app, async () => {
    const r = await declineServiceProviderApplication(app.id, reason)
    await logMove(app, 'Application declined', reason)
    return r
  }, 'Application declined.')
  const onApprove = (app) => act(app, async () => {
    const r = await approveWithoutInvite(app.id)
    await logMove(app, 'Approved — account activated', null)
    return r
  }, 'Approved — account activated. Send the portal invite when ready.')
  const onInvite = (app) => act(app, async () => {
    const r = await sendPortalInvite(app.id)
    await logMove(app, 'Portal invite sent', r?.email ? `Invite emailed to ${r.email}.` : null)
    return r
  }, (r) => r?.invited ? `Portal invite sent to ${r.email}.` : `${r?.note || 'Invite processed.'}`)

  const counts = useMemo(() => {
    const c = {}
    for (const a of apps || []) { const v = a.stage?.picklist_value || '—'; c[v] = (c[v] || 0) + 1 }
    return c
  }, [apps])
  const pendingSet = new Set(['Application Submitted', 'Application Under Review', 'Application Additional Info Requested', 'Application Interview', 'Application Onboarding', 'Application Training'])
  const pendingCount = (apps || []).filter((a) => pendingSet.has(a.stage?.picklist_value)).length

  const shown = useMemo(() => {
    if (!apps) return []
    if (filter === '__all') return apps
    if (filter === '__pending') return apps.filter((a) => pendingSet.has(a.stage?.picklist_value))
    return apps.filter((a) => a.stage?.picklist_value === filter)
  }, [apps, filter])

  const Tile = ({ id, label, count, tone, active }) => (
    <button onClick={() => setFilter(id)} style={{ textAlign: 'left', cursor: 'pointer', background: active ? '#fff' : C.card, border: `1.5px solid ${active ? (tone || C.emerald) : C.border}`, borderRadius: 10, padding: '12px 14px', minWidth: 118, boxShadow: active ? '0 2px 8px rgba(13,26,46,0.06)' : 'none' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.textPrimary, fontFamily: MONO }}>{count}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: tone || C.textSecondary, marginTop: 2 }}>{label}</div>
    </button>
  )

  return (
    <div style={{ padding: 24, maxWidth: 1040 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPrimary, margin: 0 }}>Service Provider Onboarding</h1>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>Review subcontractor applications, move them through the pipeline, and invite them to the portal once approved.</div>
        </div>
        <button onClick={() => setShowNew(true)} style={{ padding: '10px 16px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>+ New Application</button>
      </div>

      {showNew && <NewApplicationModal onClose={() => setShowNew(false)} onCreated={(msg) => { setShowNew(false); setToast(msg); load() }} />}

      {/* pipeline dashboard */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
        <Tile id="__pending" label="Pending" count={pendingCount} tone={C.emeraldMid} active={filter === '__pending'} />
        {STAGE_FLOW.map((s) => <Tile key={s.v} id={s.v} label={s.label} count={counts[s.v] || 0} tone={s.tone} active={filter === s.v} />)}
        <Tile id="__all" label="All" count={(apps || []).length} tone={C.textSecondary} active={filter === '__all'} />
      </div>

      {toast && <div style={{ marginTop: 16, background: '#e8f8f2', border: `1px solid ${C.emerald}`, color: '#1a7a4e', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{toast}</div>}
      {err && <div style={{ marginTop: 16, background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

      <div style={{ marginTop: 18 }}>
        {apps === null ? <div style={{ color: C.textMuted, fontSize: 14 }}>Loading…</div>
          : shown.length === 0 ? <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 22, color: C.textMuted, fontSize: 14 }}>No applications here.</div>
          : shown.map((app) => <ApplicationCard key={app.id} app={app} busy={busyId === app.id} onAdvance={onAdvance} onRequestInfo={onRequestInfo} onDecline={onDecline} onApprove={onApprove} onInvite={onInvite} />)}
      </div>
    </div>
  )
}
