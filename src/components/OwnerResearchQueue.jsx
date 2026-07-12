import { useState, useEffect, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon, LoadingState, ErrorState } from './UI'
import { useToast } from './Toast'
import {
  listReviewQueue,
  findAccountMatches,
  approveIdentifiedOrganization,
  rejectIdentifiedOrganization,
  buildRelatedOrgOptions,
  promoteCandidateToContact,
  findContactMatches,
  normalizePhoneForContact,
  normalizeEmailForContact,
  rejectCandidate,
  isPlaceholderOrgName,
} from '../data/ownerResearchService'

// ---------------------------------------------------------------------------
// OwnerResearchQueue — the "Owner Research" section of the Outreach module.
//
// The cross-record review workspace for everything owner research produced:
//   * Identified organizations awaiting approval — approving matches or
//     creates the real Account and (with explicit confirmation) repoints the
//     property off its placeholder owner.
//   * Decision-maker candidates awaiting review — approving creates a real
//     Contact (with an edit-before-save step); rejecting keeps the row with
//     an explicit reason.
//
// Approval is the ONLY path from research findings to CRM records; the
// record-level PropertyOwnerResearchPanel stays as the drill-down view.
// Palette: LEAP design system — navy/sky/emerald only, no red/orange.
// ---------------------------------------------------------------------------

const labelStyle = {
  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted,
}
const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  border: 'none', borderRadius: 6, padding: '7px 12px',
  fontWeight: 600, fontSize: 12, cursor: 'pointer',
  transition: 'all 200ms ease', whiteSpace: 'nowrap',
}
const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${C.border}`, borderRadius: 6,
  background: C.card, color: C.textPrimary, boxSizing: 'border-box',
}

function SourceBadge({ source }) {
  const isWeb = source === 'Web Research'
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontSize: 9.5, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 7px',
      borderRadius: 3, whiteSpace: 'nowrap',
      background: isWeb ? 'rgba(126,179,232,0.15)' : 'rgba(62,207,142,0.12)',
      color: isWeb ? C.sky : C.emeraldMid || '#2aab72',
      border: `1px solid ${isWeb ? C.sky : C.emerald}`,
    }}>{source}</span>
  )
}

function contactBits(candidate) {
  const emails = (Array.isArray(candidate.orc_emails) ? candidate.orc_emails : [])
    .map(e => (typeof e === 'string' ? e : e?.email || e?.emailAddress || e?.address))
    .filter(Boolean)
  const phones = (Array.isArray(candidate.orc_phones) ? candidate.orc_phones : [])
    .map(p => (typeof p === 'string' ? p : p?.number || p?.phoneNumber || p?.internationalNumber))
    .filter(Boolean)
  return { emails, phones }
}

// Evidence for an identified org lives in the stage results (staged runs) or
// the raw response (legacy single-pass runs).
function orgEvidence(request) {
  const stage = request.orq_stage_results?.['Owner Identification'] || {}
  const notes = stage.identification_notes || request.orq_raw_response?.identification_notes || null
  const urls = Array.isArray(stage.evidence_urls) ? stage.evidence_urls.filter(u => typeof u === 'string') : []
  return { notes, urls }
}

// The account the approved contact should land on: the candidate's own
// account unless it's a placeholder and the request's identified org has
// already been approved onto a real account.
function contactAccountIdFor(candidate) {
  const ownName = candidate.account?.account_name
  if (ownName && !isPlaceholderOrgName(ownName)) return candidate.orc_account_id
  return candidate.request?.orq_approved_account_id || candidate.orc_account_id
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(7,17,31,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: C.card, borderRadius: 10, width: 'min(560px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 12px 40px rgba(7,17,31,0.4)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1 }}>{children}</div>
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{footer}</div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, display: 'block', fontWeight: 500 }}>{label}</label>
      <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
      {hint && <div style={{ fontSize: 11.5, color: C.sky, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// ── Approve-organization dialog ─────────────────────────────────────────────

const RELATIONSHIP_LABELS = {
  parent: 'parent company — will be set as this account’s parent',
  subsidiary: 'subsidiary — will be created as a child of this account',
  management: 'management organization — created standalone (a manager isn’t necessarily owned by the owner)',
}

function ApproveOrgModal({ request, onClose, onApproved }) {
  const toast = useToast()
  const [accountName, setAccountName] = useState(request.orq_company_name || '')
  const [matches, setMatches] = useState(null)      // null = loading
  const [choice, setChoice] = useState('new')       // 'new' | account id
  const [repoint, setRepoint] = useState(!!request.orq_property_id)
  const relatedOptions = useMemo(() => buildRelatedOrgOptions(request), [request])
  // Parent + subsidiaries default on (the hierarchy is the point); a
  // standalone management org defaults off — reviewer opts in.
  const [relatedChecked, setRelatedChecked] = useState(() =>
    new Set(relatedOptions.filter(o => o.relationship !== 'management').map(o => o.name)))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    findAccountMatches(request.orq_company_name, request.orq_company_domain)
      .then(m => {
        if (cancelled) return
        setMatches(m)
        const strong = m.find(x => x.matchStrength === 'strong')
        if (strong) setChoice(strong.id)
      })
      .catch(() => { if (!cancelled) setMatches([]) })
    return () => { cancelled = true }
  }, [request])

  const handleApprove = async () => {
    setWorking(true)
    setError(null)
    try {
      const { account, relatedAccounts, relatedErrors } = await approveIdentifiedOrganization(request, {
        existingAccountId: choice === 'new' ? null : choice,
        repointProperty: repoint,
        accountName: choice === 'new' ? accountName : null,
        relatedOrgs: relatedOptions.filter(o => relatedChecked.has(o.name)),
      })
      const relatedNote = relatedAccounts.length
        ? ` ${relatedAccounts.length} related account${relatedAccounts.length === 1 ? '' : 's'} linked.`
        : ''
      toast?.success?.((choice === 'new'
        ? `Account ${account.account_record_number} created for ${account.account_name}.`
        : `Linked to existing account ${account.account_record_number}.`) + relatedNote)
      if (relatedErrors.length) {
        toast?.error?.(`Some related accounts failed — ${relatedErrors.join(' · ')}`)
      }
      onApproved()
    } catch (e) {
      setError(e?.message || 'Approval failed.')
    } finally {
      setWorking(false)
    }
  }

  const propertyLabel = request.property
    ? `${request.property.property_name} (${request.property.property_city || '?'}, ${request.property.property_state || '?'})`
    : null
  const currentOwner = request.account?.account_name || null

  return (
    <Modal
      title="Approve Identified Organization"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={working}
            style={{ ...btnBase, background: C.page, border: `1px solid ${C.border}`, color: C.textSecondary }}>
            Cancel
          </button>
          <button onClick={handleApprove} disabled={working || (choice === 'new' && !accountName.trim())}
            style={{ ...btnBase, background: working ? C.border : C.emerald, color: '#fff', padding: '8px 16px' }}>
            {working ? 'Approving…' : choice === 'new' ? 'Create Account & Approve' : 'Link Account & Approve'}
          </button>
        </>
      }>
      <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14, lineHeight: 1.55 }}>
        Research ({request.orq_record_number}) identified{' '}
        <span style={{ fontWeight: 600, color: C.textPrimary }}>{request.orq_company_name}</span>
        {request.orq_company_domain ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}> · {request.orq_company_domain}</span> : null}
        {propertyLabel ? <> as the owner of <span style={{ fontWeight: 600, color: C.textPrimary }}>{propertyLabel}</span></> : null}.
      </div>

      <div style={{ ...labelStyle, marginBottom: 8 }}>Account</div>
      {matches === null ? (
        <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 12 }}>Checking for existing accounts…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {matches.map(m => (
            <label key={m.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              border: `1px solid ${choice === m.id ? C.emerald : C.border}`, borderRadius: 6,
              background: choice === m.id ? 'rgba(62,207,142,0.06)' : '#f7f9fc', cursor: 'pointer', fontSize: 12.5,
            }}>
              <input type="radio" checked={choice === m.id} onChange={() => setChoice(m.id)} />
              <span style={{ fontWeight: 600, color: C.textPrimary }}>{m.account_name}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>{m.account_record_number}</span>
              <span style={{
                marginLeft: 'auto', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: m.matchStrength === 'strong' ? (C.emeraldMid || '#2aab72') : C.sky,
              }}>{m.matchStrength === 'strong' ? 'Likely match' : 'Possible match'}</span>
            </label>
          ))}
          <label style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
            border: `1px solid ${choice === 'new' ? C.emerald : C.border}`, borderRadius: 6,
            background: choice === 'new' ? 'rgba(62,207,142,0.06)' : '#f7f9fc', cursor: 'pointer', fontSize: 12.5,
          }}>
            <input type="radio" checked={choice === 'new'} onChange={() => setChoice('new')} />
            <span style={{ fontWeight: 600, color: C.textPrimary }}>Create a new account</span>
            {matches.length === 0 && <span style={{ color: C.textMuted, fontSize: 11.5 }}>(no existing account matched)</span>}
          </label>
        </div>
      )}

      {choice === 'new' && (
        <Field label="Account name (edit before creating — keep it clean)" value={accountName} onChange={setAccountName} />
      )}

      {relatedOptions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Corporate Structure</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {relatedOptions.map(o => (
              <label key={o.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={relatedChecked.has(o.name)}
                  onChange={() => setRelatedChecked(prev => {
                    const n = new Set(prev)
                    if (n.has(o.name)) n.delete(o.name); else n.add(o.name)
                    return n
                  })}
                  style={{ marginTop: 2 }}
                />
                <span>
                  Also create/link <span style={{ fontWeight: 600 }}>{o.name}</span>
                  <span style={{ color: C.textSecondary }}> — {RELATIONSHIP_LABELS[o.relationship]}</span>
                </span>
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
            Existing accounts are matched by name and linked — never duplicated.
          </div>
        </div>
      )}

      {request.orq_property_id && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: C.textPrimary, cursor: 'pointer', marginTop: 4 }}>
          <input type="checkbox" checked={repoint} onChange={e => setRepoint(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Repoint the property to this account
            {currentOwner ? <span style={{ color: C.textSecondary }}> — currently owned by “{currentOwner}”</span> : null}.
          </span>
        </label>
      )}

      {error && (
        <div style={{ background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`, color: C.textPrimary, borderRadius: 6, padding: '10px 12px', marginTop: 12, fontSize: 13 }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

// ── Approve-person (edit-then-approve) dialog ───────────────────────────────

function ApprovePersonModal({ candidate, onClose, onApproved }) {
  const toast = useToast()
  const { emails, phones } = contactBits(candidate)
  const [fullName, setFullName] = useState(candidate.orc_full_name || '')
  const [title, setTitle] = useState(candidate.orc_job_title || '')
  const [email, setEmail] = useState(emails[0] || '')
  const [phone, setPhone] = useState(phones[0] || '')
  const [linkedin, setLinkedin] = useState(candidate.orc_linkedin_url || '')
  const [contactMatches, setContactMatches] = useState(null)   // null = loading
  const [contactChoice, setContactChoice] = useState('new')    // 'new' | contact id
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  const accountId = contactAccountIdFor(candidate)
  const accountName = accountId === candidate.orc_account_id
    ? candidate.account?.account_name
    : candidate.request?.orq_company_name
  const placeholderAccount = isPlaceholderOrgName(candidate.account?.account_name)
    && !candidate.request?.orq_approved_account_id

  // Duplicate check: does this person already exist as a Contact?
  useEffect(() => {
    let cancelled = false
    findContactMatches({ fullName: candidate.orc_full_name, email: emails[0] || null, accountId })
      .then(m => {
        if (cancelled) return
        setContactMatches(m)
        const strong = m.find(x => x.matchStrength === 'strong')
        if (strong) setContactChoice(strong.id)
      })
      .catch(() => { if (!cancelled) setContactMatches([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, accountId])

  const handleApprove = async () => {
    setWorking(true)
    setError(null)
    try {
      const contact = await promoteCandidateToContact(candidate, {
        overrides: { fullName, title, email, phone, linkedin },
        accountId,
        existingContactId: contactChoice === 'new' ? null : contactChoice,
      })
      toast?.success?.(contact.existing
        ? `Linked to existing contact ${contact.contact_record_number} — new info filled in, nothing overwritten.`
        : `Contact ${contact.contact_record_number} created for ${fullName}.`)
      onApproved()
    } catch (e) {
      setError(e?.message || 'Approval failed.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Modal
      title="Approve — Create Contact"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={working}
            style={{ ...btnBase, background: C.page, border: `1px solid ${C.border}`, color: C.textSecondary }}>
            Cancel
          </button>
          <button onClick={handleApprove} disabled={working || !fullName.trim()}
            style={{ ...btnBase, background: working ? C.border : C.emerald, color: '#fff', padding: '8px 16px' }}>
            {working ? 'Creating…' : 'Create Contact'}
          </button>
        </>
      }>
      <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14 }}>
        Review and correct before this becomes a Contact on{' '}
        <span style={{ fontWeight: 600, color: C.textPrimary }}>{accountName || 'the owner-group account'}</span>.
        {placeholderAccount && (
          <div style={{ marginTop: 6, color: C.textPrimary, background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`, borderRadius: 6, padding: '8px 10px' }}>
            The owner account on file is a placeholder — approve the identified organization first so this contact lands on the real account.
          </div>
        )}
      </div>
      {contactMatches && contactMatches.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Possible Existing Contact</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {contactMatches.map(m => (
              <label key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                border: `1px solid ${contactChoice === m.id ? C.emerald : C.border}`, borderRadius: 6,
                background: contactChoice === m.id ? 'rgba(62,207,142,0.06)' : '#f7f9fc', cursor: 'pointer', fontSize: 12.5,
              }}>
                <input type="radio" checked={contactChoice === m.id} onChange={() => setContactChoice(m.id)} />
                <span style={{ fontWeight: 600, color: C.textPrimary }}>{m.contact_name}</span>
                <span style={{ color: C.textSecondary }}>{[m.contact_title, m.contact_email].filter(Boolean).join(' · ')}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>{m.contact_record_number}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                  color: m.matchStrength === 'strong' ? (C.emeraldMid || '#2aab72') : C.sky,
                }}>{m.matchStrength === 'strong' ? 'Likely same person' : 'Possible match'}</span>
              </label>
            ))}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
              border: `1px solid ${contactChoice === 'new' ? C.emerald : C.border}`, borderRadius: 6,
              background: contactChoice === 'new' ? 'rgba(62,207,142,0.06)' : '#f7f9fc', cursor: 'pointer', fontSize: 12.5,
            }}>
              <input type="radio" checked={contactChoice === 'new'} onChange={() => setContactChoice('new')} />
              <span style={{ fontWeight: 600, color: C.textPrimary }}>Create a new contact</span>
            </label>
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
            Linking fills in missing info on the existing contact — it never overwrites what's already there.
          </div>
        </div>
      )}

      <Field label="Full name" value={fullName} onChange={setFullName} />
      <Field label="Title" value={title} onChange={setTitle} />
      <Field label="Email" value={email} onChange={setEmail} placeholder="Publicly listed or revealed email"
        hint={email.trim() && !normalizeEmailForContact(email)
          ? 'Not a valid email format — it will be left off the contact (stays on the research record).'
          : null} />
      <Field label="Phone" value={phone} onChange={setPhone}
        hint={phone.trim()
          ? (normalizePhoneForContact(phone)
              ? (normalizePhoneForContact(phone) !== phone.trim() ? `Will be saved as ${normalizePhoneForContact(phone)} (LEAP stores 10-digit numbers).` : null)
              : 'Not a 10-digit US number — it will be left off the contact (stays on the research record).')
          : null} />
      <Field label="LinkedIn URL" value={linkedin} onChange={setLinkedin} />
      {error && (
        <div style={{ background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`, color: C.textPrimary, borderRadius: 6, padding: '10px 12px', fontSize: 13 }}>
          {error}
        </div>
      )}
    </Modal>
  )
}

// ── The queue ───────────────────────────────────────────────────────────────

export default function OwnerResearchQueue({ onOpenRecord }) {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [orgs, setOrgs] = useState([])
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [selected, setSelected] = useState(() => new Set())
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [approveOrg, setApproveOrg] = useState(null)
  const [approvePerson, setApprovePerson] = useState(null)
  const [bulkWorking, setBulkWorking] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const q = await listReviewQueue()
      setOrgs(q.orgs)
      setPeople(q.people)
      setSelected(new Set())
      setError(null)
    } catch (e) {
      setError(e?.message || 'Failed to load the review queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const states = useMemo(() => {
    const s = new Set()
    for (const o of orgs) if (o.property?.property_state) s.add(o.property.property_state)
    for (const p of people) if (p.property?.property_state) s.add(p.property.property_state)
    return [...s].sort()
  }, [orgs, people])

  const matchesFilters = useCallback((state, texts, source) => {
    if (stateFilter !== 'all' && state !== stateFilter) return false
    if (sourceFilter !== 'all' && source && source !== sourceFilter) return false
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      if (!texts.some(t => t && String(t).toLowerCase().includes(needle))) return false
    }
    return true
  }, [stateFilter, sourceFilter, search])

  const visibleOrgs = orgs.filter(o => matchesFilters(
    o.property?.property_state || null,
    [o.orq_company_name, o.orq_company_domain, o.property?.property_name, o.account?.account_name, o.orq_record_number],
    null,
  ))
  const visiblePeople = people.filter(p => matchesFilters(
    p.property?.property_state || null,
    [p.orc_full_name, p.orc_job_title, p.orc_company_name, p.property?.property_name, p.account?.account_name, p.orc_record_number],
    p.orc_source,
  ))

  const withBusy = async (id, fn) => {
    setBusyIds(prev => new Set(prev).add(id))
    try { await fn() }
    finally {
      setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const handleRejectOrg = async (request) => {
    if (!window.confirm(`Reject "${request.orq_company_name}" as the identified owner? The finding stays on ${request.orq_record_number} for the record.`)) return
    await withBusy(request.id, async () => {
      try {
        await rejectIdentifiedOrganization(request.id)
        await refresh()
      } catch (e) { setError(e?.message || 'Reject failed.') }
    })
  }

  // One-click reject — no reason demanded. The row itself is kept (LEAP
  // never hard-deletes) so future research runs can skip already-reviewed
  // people instead of resurfacing them.
  const handleRejectPerson = async (candidate) => {
    await withBusy(candidate.id, async () => {
      try {
        await rejectCandidate(candidate.id, null)
        await refresh()
      } catch (e) { setError(e?.message || 'Reject failed.') }
    })
  }

  const toggleSelected = (id) => {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const handleBulkApprove = async () => {
    const chosen = visiblePeople.filter(p => selected.has(p.id))
    if (chosen.length === 0) return
    if (!window.confirm(`Create ${chosen.length} contact${chosen.length === 1 ? '' : 's'} from the selected candidates (as found, no edits)?`)) return
    setBulkWorking(true)
    let created = 0
    const failures = []
    for (const cand of chosen) {
      try {
        await promoteCandidateToContact(cand, { accountId: contactAccountIdFor(cand) })
        created++
      } catch (e) {
        failures.push(`${cand.orc_full_name}: ${e?.message || 'failed'}`)
      }
    }
    setBulkWorking(false)
    if (created > 0) toast?.success?.(`${created} contact${created === 1 ? '' : 's'} created.`)
    if (failures.length > 0) setError(`Some approvals failed — ${failures.join(' · ')}`)
    await refresh()
  }

  if (loading) return <LoadingState />
  if (error && orgs.length === 0 && people.length === 0) return <ErrorState error={error} onRetry={() => { setLoading(true); refresh() }} />

  const openProperty = (p) => p?.id && onOpenRecord?.({ table: 'properties', id: p.id, name: p.property_name || '' })
  const openAccount = (a) => a?.id && onOpenRecord?.({ table: 'accounts', id: a.id, name: a.account_name || '' })

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, margin: 0 }}>Owner Research Review Queue</h1>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            Approve findings into real Accounts and Contacts — or reject them with a reason. Nothing reaches the CRM without review.
          </div>
        </div>
        <button onClick={() => { setLoading(true); refresh() }}
          style={{ ...btnBase, background: 'transparent', color: C.textPrimary, border: `1px solid ${C.borderDark || C.border}` }}>
          <Icon path="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-4M20 14a8 8 0 01-14 4" size={13} color={C.textSecondary} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search people, organizations, properties…"
          style={{ ...inputStyle, width: 280 }}
        />
        <select value={stateFilter} onChange={e => setStateFilter(e.target.value)} style={{ ...inputStyle, width: 130 }}>
          <option value="all">All states</option>
          {states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ ...inputStyle, width: 160 }}>
          <option value="all">All sources</option>
          <option value="Web Research">Web Research</option>
          <option value="Lusha">Lusha</option>
        </select>
      </div>

      {error && (
        <div style={{ background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`, color: C.textPrimary, borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Identified organizations */}
      <div style={{ ...labelStyle, marginBottom: 8 }}>
        Identified Organizations Awaiting Approval{visibleOrgs.length ? ` (${visibleOrgs.length})` : ''}
      </div>
      {visibleOrgs.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: 13, padding: '4px 0 16px' }}>None pending.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
          {visibleOrgs.map(req => {
            const { notes, urls } = orgEvidence(req)
            const busy = busyIds.has(req.id)
            return (
              <div key={req.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 260, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: C.textPrimary }}>{req.orq_company_name}</span>
                      {req.orq_company_domain && (
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: C.textSecondary }}>{req.orq_company_domain}</span>
                      )}
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: C.textMuted }}>{req.orq_record_number}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 4 }}>
                      Identified as the owner of{' '}
                      {req.property ? (
                        <a onClick={() => openProperty(req.property)} style={{ color: C.sky, cursor: 'pointer', fontWeight: 600 }}>
                          {req.property.property_name} ({req.property.property_city || '?'}, {req.property.property_state || '?'})
                        </a>
                      ) : 'this record'}
                      {req.account?.account_name ? <> — currently on <a onClick={() => openAccount(req.account)} style={{ color: C.sky, cursor: 'pointer' }}>{req.account.account_name}</a></> : null}
                    </div>
                    {notes && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 5, fontStyle: 'italic' }}>{notes}</div>}
                    {urls.length > 0 && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        {urls.slice(0, 5).map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.sky, textDecoration: 'none' }}>Evidence {i + 1} ↗</a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setApproveOrg(req)} disabled={busy}
                      style={{ ...btnBase, background: C.emerald, color: '#fff' }}>
                      {busy ? 'Working…' : 'Approve Organization…'}
                    </button>
                    <button onClick={() => handleRejectOrg(req)} disabled={busy}
                      style={{ ...btnBase, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}` }}>
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* People */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={labelStyle}>
          People Awaiting Review{visiblePeople.length ? ` (${visiblePeople.length})` : ''}
        </span>
        {selected.size > 0 && (
          <button onClick={handleBulkApprove} disabled={bulkWorking}
            style={{ ...btnBase, background: C.emerald, color: '#fff', padding: '6px 12px', fontSize: 11.5 }}>
            {bulkWorking ? 'Creating contacts…' : `Approve ${selected.size} Selected`}
          </button>
        )}
      </div>
      {visiblePeople.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: 13, padding: '4px 0' }}>
          Nothing awaiting review. Run research from a property or account record — findings land here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visiblePeople.map(cand => {
            const { emails, phones } = contactBits(cand)
            const busy = busyIds.has(cand.id)
            const sourceUrls = Array.isArray(cand.orc_source_urls) ? cand.orc_source_urls.filter(u => typeof u === 'string') : []
            return (
              <div key={cand.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={selected.has(cand.id)} onChange={() => toggleSelected(cand.id)} style={{ marginTop: 3 }} />
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: C.textPrimary }}>{cand.orc_full_name}</span>
                      <SourceBadge source={cand.orc_source} />
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: C.textMuted }}>{cand.orc_record_number}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 3 }}>
                      {[cand.orc_job_title, cand.orc_company_name].filter(Boolean).join(' · ') || '—'}
                      {cand.property && (
                        <>
                          {' · '}
                          <a onClick={() => openProperty(cand.property)} style={{ color: C.sky, cursor: 'pointer' }}>
                            {cand.property.property_name} ({cand.property.property_state || '?'})
                          </a>
                        </>
                      )}
                    </div>
                    {(emails.length > 0 || phones.length > 0) && (
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: C.textPrimary, marginTop: 5 }}>
                        {[...emails, ...phones].join('  ·  ')}
                      </div>
                    )}
                    {cand.orc_notes && (
                      <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 5, fontStyle: 'italic' }}>{cand.orc_notes}</div>
                    )}
                    {(sourceUrls.length > 0 || cand.orc_linkedin_url) && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        {cand.orc_linkedin_url && (
                          <a href={cand.orc_linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.sky, textDecoration: 'none', fontWeight: 600 }}>LinkedIn ↗</a>
                        )}
                        {sourceUrls.slice(0, 4).map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.sky, textDecoration: 'none' }}>Source {i + 1} ↗</a>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setApprovePerson(cand)} disabled={busy}
                      style={{ ...btnBase, padding: '6px 10px', fontSize: 11.5, background: C.emerald, color: '#fff' }}>
                      {busy ? 'Working…' : 'Approve…'}
                    </button>
                    <button onClick={() => handleRejectPerson(cand)} disabled={busy}
                      style={{ ...btnBase, padding: '6px 10px', fontSize: 11.5, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}` }}>
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {approveOrg && (
        <ApproveOrgModal
          request={approveOrg}
          onClose={() => setApproveOrg(null)}
          onApproved={async () => { setApproveOrg(null); await refresh() }}
        />
      )}
      {approvePerson && (
        <ApprovePersonModal
          candidate={approvePerson}
          onClose={() => setApprovePerson(null)}
          onApproved={async () => { setApprovePerson(null); await refresh() }}
        />
      )}
    </div>
  )
}
