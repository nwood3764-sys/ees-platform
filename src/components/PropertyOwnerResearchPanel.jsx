import { useState, useEffect, useCallback, useMemo } from 'react'
import { C } from '../data/constants'
import { Icon } from './UI'
import { useToast } from './Toast'
import {
  fetchResearchTarget,
  fetchTargetJobTitles,
  listResearchForRecord,
  runOwnerResearch,
  waitForRequestCompletion,
  enrichCandidates,
  dismissCandidate,
  promoteCandidateToContact,
  buildManualSearchLinks,
} from '../data/ownerResearchService'

// ---------------------------------------------------------------------------
// PropertyOwnerResearchPanel
//
// Standalone card on Account (owner group) and Property records. Finds the
// decision makers who can approve energy-efficiency work — CEO, asset
// manager, facilities director — NOT site property-management staff.
//
// Research actions:
//   1. Deep Research — the staged pipeline (Owner Identification →
//      Organization Research → Decision Maker Discovery → Contact Info
//      Gathering). Each stage runs with its own time budget; the panel shows
//      live stage progress. Ends "Ready for Review" — findings flow into the
//      Owner Research queue in the Outreach module.
//   2. Lusha Search  — NO CREDITS. Names + titles + has-email/phone flags.
//   3. Reveal Contact Info — PAID Lusha credits, per selected person only.
//
// Every person found is an ORC- candidate record: promote it to a real
// Contact on the owner-group account, or dismiss it. Manual search shortcut
// links (Google / LinkedIn / state registry) cover the human follow-up.
//
// Palette: LEAP design system — navy/sky/emerald only, no red/orange.
// ---------------------------------------------------------------------------

const card = {
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: 20, marginBottom: 16,
}
const labelStyle = {
  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.1em', textTransform: 'uppercase', color: C.textMuted,
}
const btnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  border: 'none', borderRadius: 6, padding: '8px 14px',
  fontWeight: 600, fontSize: 12.5, cursor: 'pointer',
  transition: 'all 200ms ease', whiteSpace: 'nowrap',
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

export default function PropertyOwnerResearchPanel({ tableName, recordId }) {
  const toast = useToast()
  const [target, setTarget] = useState(null)
  const [jobTitles, setJobTitles] = useState([])
  const [requests, setRequests] = useState([])
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState(null)
  const [runStage, setRunStage] = useState(null)
  const [busyCandidateId, setBusyCandidateId] = useState(null)
  const [error, setError] = useState(null)
  const [showDismissed, setShowDismissed] = useState(false)

  const refresh = useCallback(async () => {
    if (!recordId) return
    try {
      const res = await listResearchForRecord(tableName, recordId)
      setRequests(res.requests)
      setCandidates(res.candidates)
    } catch (e) {
      setError(e?.message || 'Failed to load research history.')
    }
  }, [tableName, recordId])

  useEffect(() => {
    let cancelled = false
    if (!recordId) return
    setLoading(true)
    Promise.all([
      fetchResearchTarget(tableName, recordId),
      fetchTargetJobTitles(),
      listResearchForRecord(tableName, recordId),
    ])
      .then(([t, titles, res]) => {
        if (cancelled) return
        setTarget(t)
        setJobTitles(titles)
        setRequests(res.requests)
        setCandidates(res.candidates)
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'Failed to load the research panel.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tableName, recordId])

  const manualLinks = useMemo(
    () => (target ? buildManualSearchLinks(target) : []),
    [target],
  )

  async function handleRun(action) {
    if (!target) return
    setRunningAction(action)
    setRunStage(null)
    setError(null)
    try {
      const runTarget = target.companyName
        ? target
        : { ...target, companyName: effectiveCompanyName, companyDomain: effectiveCompanyDomain }
      let res = await runOwnerResearch(action, runTarget)
      let request = res?.request
      if (res?.background && request?.id) {
        // Staged research runs server-side in the background — poll until done,
        // surfacing the live stage so the user can watch it work.
        await refresh()
        request = await waitForRequestCompletion(request.id, {
          onProgress: (row) => setRunStage(row.orq_stage || null),
        })
      }
      if (request?.orq_status === 'Research Request Failed') {
        throw new Error(request.orq_error_message || 'Research run failed.')
      }
      const n = request?.orq_total_results ?? (res?.candidates?.length || 0)
      const readyForReview = request?.orq_status === 'Research Request Ready for Review'
      toast?.success?.(n > 0
        ? `Research complete — ${n} decision maker candidate${n === 1 ? '' : 's'} found${readyForReview ? ', ready for review in the Outreach queue' : ''}.`
        : readyForReview
          ? 'Research complete — the identified owner organization is ready for review in the Outreach queue.'
          : 'Research complete — no candidates found. Try the other method or the manual links.')
      await refresh()
    } catch (e) {
      setError(e?.message || 'Research run failed.')
      await refresh()
    } finally {
      setRunningAction(null)
      setRunStage(null)
    }
  }

  async function handleEnrich(candidate) {
    if (!window.confirm(`Reveal contact info for ${candidate.orc_full_name}? This spends Lusha credits.`)) return
    setBusyCandidateId(candidate.id)
    setError(null)
    try {
      await enrichCandidates(candidate.orc_request_id, [candidate.id])
      toast?.success?.(`Contact info revealed for ${candidate.orc_full_name}.`)
      await refresh()
    } catch (e) {
      setError(e?.message || 'Enrich failed.')
    } finally {
      setBusyCandidateId(null)
    }
  }

  async function handlePromote(candidate) {
    setBusyCandidateId(candidate.id)
    setError(null)
    try {
      const contact = await promoteCandidateToContact(candidate)
      toast?.success?.(contact.existing
        ? `${candidate.orc_full_name} already exists as ${contact.contact_record_number} — linked, missing info filled in.`
        : `Contact ${contact.contact_record_number} created for ${candidate.orc_full_name}.`)
      await refresh()
    } catch (e) {
      setError(e?.message || 'Promote failed.')
    } finally {
      setBusyCandidateId(null)
    }
  }

  async function handleDismiss(candidate) {
    setBusyCandidateId(candidate.id)
    setError(null)
    try {
      await dismissCandidate(candidate.id)
      await refresh()
    } catch (e) {
      setError(e?.message || 'Dismiss failed.')
    } finally {
      setBusyCandidateId(null)
    }
  }

  const visibleCandidates = candidates.filter(c =>
    showDismissed || c.orc_status !== 'Research Candidate Dismissed')
  const lastRequest = requests[0] || null
  // When the CRM owner is a placeholder, a completed web-research run may have
  // identified the real owner organization — use it for subsequent runs.
  const identifiedRequest = target?.ownerUnknown
    ? requests.find(r =>
        ['Research Request Completed', 'Research Request Ready for Review'].includes(r.orq_status)
        && r.orq_company_name) || null
    : null
  const effectiveCompanyName = target?.companyName || identifiedRequest?.orq_company_name || null
  const effectiveCompanyDomain = target?.companyDomain || identifiedRequest?.orq_company_domain || null
  // Web research works with a known org OR an unknown-owner property (it will
  // identify the owner from public records); Lusha always needs a real org.
  const canResearch = !!(effectiveCompanyName || (target?.ownerUnknown && target?.propertyId))

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon path="M11 4a7 7 0 105.2 11.7L21 20.5 M11 8v3l2 2" size={18} color={C.textSecondary} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>
            Property Owner Research
          </h3>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleRun('deep_research')}
            disabled={!!runningAction || loading || !canResearch}
            title="Staged AI research: identify the owner, verify the organization, find its decision makers, gather public contact info"
            style={{
              ...btnBase,
              background: runningAction === 'deep_research' ? '#f7f9fc' : C.emerald,
              color: runningAction === 'deep_research' ? C.textMuted : '#fff',
            }}>
            {runningAction === 'deep_research'
              ? (runStage ? `${runStage}…` : 'Starting research…')
              : 'Run Deep Research'}
          </button>
          <button
            onClick={() => handleRun('lusha_search')}
            disabled={!!runningAction || loading || !effectiveCompanyName}
            title={effectiveCompanyName
              ? 'Searches the Lusha contact database for people at this organization'
              : 'Lusha needs a known owner organization — run Web Research first to identify the owner'}
            style={{
              ...btnBase,
              background: runningAction === 'lusha_search' ? '#f7f9fc' : 'transparent',
              color: runningAction === 'lusha_search' ? C.textMuted : C.textPrimary,
              border: `1px solid ${C.borderDark || C.border}`,
            }}>
            {runningAction === 'lusha_search' ? 'Searching Lusha…' : 'Lusha Search'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: C.textSecondary, marginBottom: 14 }}>
        Finds decision makers — owners, executives, asset managers, facilities directors — for{' '}
        <span style={{ fontWeight: 600, color: C.textPrimary }}>
          {loading ? '…'
            : effectiveCompanyName ? effectiveCompanyName
            : target?.ownerUnknown && target?.propertyName ? `${target.propertyName} (owner organization not yet identified)`
            : 'this record (no owner organization resolved)'}
        </span>
        {effectiveCompanyDomain ? <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5 }}> · {effectiveCompanyDomain}</span> : null}
        .
        {identifiedRequest
          ? ` Identified by Web Research (${identifiedRequest.orq_record_number}) — the owner group on file is a placeholder.`
          : target?.ownerUnknown && target?.propertyName
            ? ' The owner group on file is a placeholder, so Web Research will work from public records (assessor, HUD, LIHTC) to identify who actually owns this property.'
            : ''}
      </div>

      {error && (
        <div style={{
          background: 'rgba(126,179,232,0.1)', border: `1px solid ${C.sky}`,
          color: C.textPrimary, borderRadius: 6, padding: '10px 12px', marginBottom: 14, fontSize: 13,
        }}>{error}</div>
      )}

      {/* Candidates */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={labelStyle}>
          Decision Maker Candidates{visibleCandidates.length ? ` (${visibleCandidates.length})` : ''}
        </span>
        {candidates.some(c => c.orc_status === 'Research Candidate Dismissed') && (
          <button
            onClick={() => setShowDismissed(s => !s)}
            style={{ ...btnBase, padding: '4px 8px', fontSize: 11, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}` }}>
            {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>
      ) : visibleCandidates.length === 0 ? (
        <div style={{ color: C.textMuted, fontSize: 13, padding: '8px 0' }}>
          No candidates yet.
          {lastRequest?.orq_status === 'Research Request No Results'
            ? ' The last run found nothing — try the other method or the manual search links below.'
            : ' Run Web Research to start.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleCandidates.map(cand => {
            const { emails, phones } = contactBits(cand)
            const dismissed = cand.orc_status === 'Research Candidate Dismissed'
            const promoted = cand.orc_status === 'Research Candidate Promoted to Contact'
            const canEnrich = cand.orc_source === 'Lusha' && !cand.orc_enriched_at && !promoted && !dismissed
            const busy = busyCandidateId === cand.id
            const sourceUrls = Array.isArray(cand.orc_source_urls) ? cand.orc_source_urls.filter(u => typeof u === 'string') : []
            return (
              <div key={cand.id} style={{
                background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6,
                padding: '12px 14px', opacity: dismissed ? 0.55 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: C.textPrimary }}>{cand.orc_full_name}</span>
                      <SourceBadge source={cand.orc_source} />
                      {promoted && (
                        <span style={{ ...labelStyle, color: C.emeraldMid || '#2aab72' }}>Contact created</span>
                      )}
                      {dismissed && <span style={{ ...labelStyle }}>Dismissed</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 3 }}>
                      {[cand.orc_job_title, cand.orc_company_name, cand.orc_location].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {(emails.length > 0 || phones.length > 0) && (
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: C.textPrimary, marginTop: 5 }}>
                        {[...emails, ...phones].join('  ·  ')}
                      </div>
                    )}
                    {emails.length === 0 && phones.length === 0 && cand.orc_source === 'Lusha' && (
                      <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 5 }}>
                        {cand.orc_has_emails ? 'Email on file' : 'No email on file'} · {cand.orc_has_phones ? 'phone on file' : 'no phone on file'} — reveal to view
                      </div>
                    )}
                    {cand.orc_notes && (
                      <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 5, fontStyle: 'italic' }}>{cand.orc_notes}</div>
                    )}
                    {(sourceUrls.length > 0 || cand.orc_linkedin_url) && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        {cand.orc_linkedin_url && (
                          <a href={cand.orc_linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.sky, textDecoration: 'none', fontWeight: 600 }}>
                            LinkedIn ↗
                          </a>
                        )}
                        {sourceUrls.slice(0, 4).map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.sky, textDecoration: 'none' }}>
                            Source {i + 1} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                  {!dismissed && !promoted && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canEnrich && (
                        <button onClick={() => handleEnrich(cand)} disabled={busy}
                          title="Reveals this person's email and phone from Lusha"
                          style={{ ...btnBase, padding: '6px 10px', fontSize: 11.5, background: 'transparent', color: C.sky, border: `1px solid ${C.sky}` }}>
                          {busy ? 'Working…' : 'Reveal Contact Info'}
                        </button>
                      )}
                      <button onClick={() => handlePromote(cand)} disabled={busy}
                        style={{ ...btnBase, padding: '6px 10px', fontSize: 11.5, background: C.emerald, color: '#fff' }}>
                        {busy ? 'Working…' : 'Promote to Contact'}
                      </button>
                      <button onClick={() => handleDismiss(cand)} disabled={busy}
                        style={{ ...btnBase, padding: '6px 10px', fontSize: 11.5, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}` }}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Manual search shortcuts */}
      {manualLinks.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Manual Search Shortcuts</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {manualLinks.map(link => (
              <a key={link.label} href={link.url} target="_blank" rel="noreferrer"
                style={{
                  fontSize: 12, color: C.textPrimary, textDecoration: 'none',
                  background: '#f7f9fc', border: `1px solid ${C.border}`, borderRadius: 6,
                  padding: '6px 10px', fontWeight: 600,
                }}>
                {link.label} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Run history */}
      {requests.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>Research Runs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {requests.slice(0, 5).map(r => (
              <div key={r.id} style={{ fontSize: 12, color: C.textSecondary, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: C.textMuted }}>{r.orq_record_number}</span>
                <span>{r.orq_research_method}</span>
                <span style={{ fontWeight: 600, color: r.orq_status === 'Research Request Failed' ? C.sky : C.textPrimary }}>{r.orq_status}</span>
                {r.orq_status === 'Research Request In Progress' && r.orq_stage && (
                  <span style={{ color: C.sky }}>{r.orq_stage}…</span>
                )}
                {typeof r.orq_total_results === 'number' && <span>{r.orq_total_results} found</span>}
                <span style={{ color: C.textMuted }}>{new Date(r.orq_created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
