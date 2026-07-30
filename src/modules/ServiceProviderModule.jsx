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
import ConversationPanelWidget from '../components/ConversationPanel'
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
  fetchOnboardingSteps,
  setOnboardingStep,
  emailProviderInvite,
  emailApplicationInvitation,
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
  const [coiBusy, setCoiBusy] = useState(false)
  const [panel, setPanel] = useState(null) // 'info' | 'decline' | null
  const [note, setNote] = useState('')
  const [acts, setActs] = useState(null)
  const [logType, setLogType] = useState('Note')
  const [logText, setLogText] = useState('')
  const [logBusy, setLogBusy] = useState(false)
  const [steps, setSteps] = useState(null)
  const [stepBusyId, setStepBusyId] = useState(null)
  const stageVal = app.stage?.picklist_value
  const contact = [app.spa_contact_first_name, app.spa_contact_last_name].filter(Boolean).join(' ')
  const email = app.spa_contact_email || app.spa_business_email
  const declined = stageVal === 'Application Declined'
  const approved = stageVal === 'Application Approved' || app.account?.account_service_provider_is_active

  // All declared trades (primary first), falling back to the single trade FK.
  const tradeList = (app.trades || [])
    .filter((t) => t.spt_is_deleted !== true)
    .sort((a, b) => (b.spt_is_primary ? 1 : 0) - (a.spt_is_primary ? 1 : 0))
    .map((t) => t.spt_name)
  const tradeText = tradeList.length ? tradeList.join(', ') : app.trade?.picklist_label

  const openDoc = async (documentId, label, setBusy) => {
    setBusy(true)
    try {
      const url = await getDocumentSignedUrl(documentId)
      if (url) window.open(url, '_blank', 'noopener'); else alert(`The ${label} file could not be found.`)
    } catch (e) { alert(e?.message || `Could not open the ${label}.`) } finally { setBusy(false) }
  }
  const openW9 = () => openDoc(app.spa_w9_document_id, 'W-9', setW9Busy)
  const openCoi = () => openDoc(app.spa_coi_document_id, 'COI', setCoiBusy)

  // Communication trail — load lazily when the card is expanded, and refresh
  // after any parent pipeline action (busy true → false) so logged movements
  // (approve/decline/request-info/move) appear without a full remount.
  const loadActs = useCallback(async () => {
    try { setActs(await fetchApplicationActivities(app.id)) } catch { setActs([]) }
  }, [app.id])
  const loadSteps = useCallback(async () => {
    try { setSteps(await fetchOnboardingSteps(app.id)) } catch { setSteps([]) }
  }, [app.id])
  useEffect(() => { if (open && acts === null) loadActs() }, [open, acts, loadActs])
  useEffect(() => { if (open && steps === null) loadSteps() }, [open, steps, loadSteps])
  const prevBusy = useRef(false)
  useEffect(() => {
    if (prevBusy.current && !busy && open) loadActs()
    prevBusy.current = busy
  }, [busy, open, loadActs])

  const toggleStep = async (s) => {
    setStepBusyId(s.id)
    try {
      const complete = !s.is_complete
      await setOnboardingStep(s.id, complete, null)
      if (complete) await logApplicationActivity(app.id, { activityType: 'Note', subject: `Onboarding: ${s.name} completed` }).catch(() => {})
      await loadSteps()
    } catch (e) { alert(e?.message || 'Could not update the step.') } finally { setStepBusyId(null) }
  }
  const reqSteps = (steps || []).filter((s) => s.is_required)
  const reqDone = reqSteps.filter((s) => s.is_complete).length
  const onboardingComplete = reqSteps.length > 0 && reqDone === reqSteps.length

  // Soft-gate the portal invite on onboarding completeness (staff can override).
  const handleInvite = async () => {
    let s = steps
    if (s === null) { try { s = await fetchOnboardingSteps(app.id) } catch { s = [] } setSteps(s) }
    const req = (s || []).filter((x) => x.is_required)
    const done = req.filter((x) => x.is_complete).length
    if (req.length && done < req.length) {
      if (!window.confirm(`Onboarding isn't complete (${done}/${req.length} required steps done). Send the portal invite anyway?`)) return
    }
    onInvite(app)
  }

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
          <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 3 }}>{[tradeText, app.spa_home_state, contact].filter(Boolean).join(' · ')}</div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>Submitted {fmtDate(app.spa_submitted_at)} · {app.spa_source || 'Manual Entry'}{app.spa_w9_document_id ? ' · W-9' : ' · no W-9'}{app.spa_coi_document_id ? ' · COI' : ''}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <StageChip value={stageVal} label={app.stage?.picklist_label} />
          {app.account?.account_service_provider_is_active && <span style={{ fontSize: 11, color: '#1a7a4e' }}>Account active</span>}
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          {row('Trades', tradeText)}
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
          <div style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 0 0', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: C.textMuted, minWidth: 150 }}>Documents</span>
            {app.spa_w9_document_id
              ? <button onClick={openW9} disabled={w9Busy} style={{ background: '#eef6ff', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 6, padding: '4px 12px', fontSize: 12.5, fontWeight: 600, cursor: w9Busy ? 'default' : 'pointer' }}>{w9Busy ? 'Opening…' : 'View W-9'}</button>
              : <span style={{ color: C.textMuted }}>No W-9 on file</span>}
            {app.spa_coi_document_id
              ? <button onClick={openCoi} disabled={coiBusy} style={{ background: '#eef6ff', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 6, padding: '4px 12px', fontSize: 12.5, fontWeight: 600, cursor: coiBusy ? 'default' : 'pointer' }}>{coiBusy ? 'Opening…' : 'View COI'}</button>
              : <span style={{ color: C.textMuted }}>No COI on file</span>}
          </div>

          {/* onboarding checklist */}
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, letterSpacing: 0.2 }}>ONBOARDING</div>
              {reqSteps.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: onboardingComplete ? '#1a7a4e' : C.textMuted }}>
                  {reqDone}/{reqSteps.length} required complete{onboardingComplete ? ' · ready to invite' : ''}
                </span>
              )}
            </div>
            {steps === null ? <div style={{ fontSize: 12.5, color: C.textMuted }}>Loading checklist…</div>
              : steps.length === 0 ? <div style={{ fontSize: 12.5, color: C.textMuted }}>No onboarding steps configured.</div>
              : steps.map((s) => (
                <button key={s.id} type="button" disabled={stepBusyId === s.id || declined} onClick={() => toggleStep(s)}
                  style={{ display: 'flex', width: '100%', textAlign: 'left', alignItems: 'flex-start', gap: 10, padding: '7px 0', background: 'none', border: 'none', borderTop: `1px solid ${C.border}`, cursor: (stepBusyId === s.id || declined) ? 'default' : 'pointer', opacity: stepBusyId === s.id ? 0.6 : 1 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 5, marginTop: 1, flexShrink: 0, border: `1.5px solid ${s.is_complete ? C.emerald : C.borderDark}`, background: s.is_complete ? C.emerald : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {s.is_complete && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#06231a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>{s.name}{s.is_required ? '' : <span style={{ color: C.textMuted, fontWeight: 400 }}> · optional</span>}</span>
                    {s.is_complete && (s.completed_by_name || s.completed_at) && (
                      <span style={{ display: 'block', fontSize: 11, color: C.textMuted, marginTop: 1 }}>{[s.completed_by_name, s.completed_at ? fmtDate(s.completed_at) : null].filter(Boolean).join(' · ')}</span>
                    )}
                    {s.notes && <span style={{ display: 'block', fontSize: 12, color: C.textSecondary, marginTop: 1 }}>{s.notes}</span>}
                  </span>
                </button>
              ))}
          </div>

          {/* email — real two-way email threaded on the provider's account,
              exactly like any other record (send via Graph, replies auto-thread) */}
          {app.account?.id && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, marginBottom: 8, letterSpacing: 0.2 }}>EMAIL</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>Send emails to this provider and read their replies here — threaded on their account. Use <strong>New Email</strong> below.</div>
              <ConversationPanelWidget
                widget={{ widget_title: 'Emails with this provider', widget_config: { fk: 'account_id', channel_filter: 'email' } }}
                parentRecordId={app.account.id}
              />
            </div>
          )}

          {/* internal communication log — calls, meetings, notes, and
              auto-recorded pipeline actions (not customer-facing) */}
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.textSecondary, marginBottom: 8, letterSpacing: 0.2 }}>INTERNAL LOG — CALLS, MEETINGS &amp; NOTES</div>

            {/* add entry */}
            <div style={{ background: '#f7f9fc', borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <select value={logType} onChange={(e) => setLogType(e.target.value)} style={{ padding: '5px 8px', borderRadius: 7, border: `1px solid ${C.borderDark}`, fontSize: 12.5, background: '#fff', color: C.textPrimary, cursor: 'pointer' }}>
                  {['Note', 'Call', 'Meeting', 'Text Message', 'Site Visit', 'Other'].map((t) => <option key={t} value={t}>{t}</option>)}
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
              ? btn('Send portal invite', handleInvite, 'primary')
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
  const [sendInvite, setSendInvite] = useState(true)
  const [inviteNote, setInviteNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }))
  const inp = { width: '100%', padding: '9px 11px', border: `1px solid ${C.borderDark}`, borderRadius: 7, fontSize: 13.5, fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff', color: C.textPrimary }
  const lab = { fontSize: 11.5, fontWeight: 600, color: C.textSecondary, display: 'block', marginBottom: 5 }
  const wantsInvite = sendInvite && v.email.trim()
  const submit = async () => {
    if (!v.company.trim()) { setErr('Company name is required.'); return }
    if (sendInvite && !v.email.trim()) { setErr('Add an email address to send the invitation, or turn the invitation off.'); return }
    setBusy(true); setErr('')
    try {
      const r = await createManualApplication(v)
      let msg = `Application ${r?.application_number || ''} created.`.trim()
      if (wantsInvite && r?.account_id) {
        try {
          await emailApplicationInvitation({
            accountId: r.account_id, toEmail: v.email.trim(),
            toName: [v.firstName, v.lastName].filter(Boolean).join(' ') || v.company,
            personalNote: inviteNote,
          })
          msg = `Application ${r?.application_number || ''} created and invitation emailed to ${v.email.trim()}.`.trim()
        } catch (e2) {
          msg = `Application ${r?.application_number || ''} created, but the invitation email didn't send (${e2?.message || 'failed'}). You can email them from the record.`.trim()
        }
      }
      onCreated?.(msg)
    } catch (e) { setErr(e?.message || 'Could not create the application.'); setBusy(false) }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 12, width: 520, maxWidth: '94vw', boxShadow: '0 20px 50px -12px rgba(0,0,0,0.28)', maxHeight: '92vh', overflow: 'auto' }}>
        <div style={{ padding: '16px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary }}>Invite a provider to apply</div>
          <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2 }}>For a contractor you're recruiting. It enters the pipeline as a new application and, if you like, emails them a welcome message with a link to submit their full application.</div>
        </div>
        <div style={{ padding: 18, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {err && <div style={{ flex: '1 1 100%', background: '#e8f1fb', border: `1px solid ${C.sky}`, color: '#1a5a8a', borderRadius: 7, padding: '8px 12px', fontSize: 13 }}>{err}</div>}
          <div style={{ flex: '1 1 100%' }}><label style={lab}>Company legal name *</label><input style={inp} value={v.company} onChange={set('company')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Contact first name</label><input style={inp} value={v.firstName} onChange={set('firstName')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Contact last name</label><input style={inp} value={v.lastName} onChange={set('lastName')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Email{sendInvite ? ' *' : ''}</label><input style={inp} type="email" value={v.email} onChange={set('email')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Phone</label><input style={inp} value={v.phone} onChange={set('phone')} /></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>Trade</label><select style={inp} value={v.trade} onChange={set('trade')}>{TRADE_OPTS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
          <div style={{ flex: '1 1 200px' }}><label style={lab}>State</label><select style={inp} value={v.state} onChange={set('state')}>{STATE_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>

          <div style={{ flex: '1 1 100%', marginTop: 4, background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, cursor: 'pointer' }}>
              <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: C.emerald, cursor: 'pointer' }} />
              <span>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.textPrimary }}>Email them an invitation to apply</span>
                <span style={{ display: 'block', fontSize: 12, color: C.textMuted, marginTop: 1 }}>A friendly welcome email with a link to submit their full application (company info, trades, service area, W-9, and Certificate of Insurance).</span>
              </span>
            </label>
            {sendInvite && (
              <div style={{ marginTop: 10 }}>
                <label style={lab}>Add a personal note <span style={{ color: C.textMuted, fontWeight: 400 }}>· optional</span></label>
                <textarea value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} rows={2} placeholder="e.g. Great meeting you at the trade show — looking forward to working together." style={{ ...inp, resize: 'vertical' }} />
              </div>
            )}
          </div>
        </div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '9px 16px', background: '#fff', color: C.textSecondary, border: `1px solid ${C.borderDark}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !v.company.trim()} style={{ padding: '9px 18px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: (busy || !v.company.trim()) ? 0.6 : 1 }}>{busy ? (wantsInvite ? 'Sending…' : 'Creating…') : (wantsInvite ? 'Create & send invitation' : 'Create application')}</button>
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
    // Always save the invite link to the trail so it's never lost.
    if (r?.invite_url) await logApplicationActivity(app.id, { activityType: 'Note', subject: 'Portal invite link generated', body: r.invite_url }).catch(() => {})
    // Email it through the Graph pipeline (reliable delivery), threaded on the account.
    if (r?.invite_url && r?.email && app.account?.id) {
      try {
        const res = await emailProviderInvite({ accountId: app.account.id, contactId: app.spa_primary_contact_id, toEmail: r.email, toName: app.spa_company_legal_name, inviteUrl: r.invite_url })
        r._emailed = true; r._mailbox = res.mailbox
        await logApplicationActivity(app.id, { activityType: 'Email', subject: 'Portal invite emailed', body: `Invite sent to ${r.email} from ${res.mailbox}.`, direction: 'outbound' }).catch(() => {})
      } catch (e) { r._emailErr = e?.message || 'email failed' }
    }
    return r
  }, (r) => r?._emailed
      ? `Portal invite emailed to ${r.email}.`
      : r?._emailErr
        ? `Approved & invite link generated, but the email didn't send (${r._emailErr}). The link is saved in the log — send it from the Email panel.`
        : (r?.note || 'Invite processed.'))

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
        <button onClick={() => setShowNew(true)} style={{ padding: '10px 16px', background: C.emerald, color: '#06231a', border: 'none', borderRadius: 8, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>+ Invite a Provider</button>
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
